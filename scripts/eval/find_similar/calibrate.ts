#!/usr/bin/env tsx
// Threshold calibration sweep (M5 entry helper, one-shot).
//
// ARCH 6.4.1 explicitly anticipates this moment: "The chosen default value
// (0.80 at present) is a starting point. The actually-correct value is
// data-dependent and is tuned against the labeled seed eval set when M5
// ships." This script runs the eval at every threshold pair in a coarse
// grid + reports the (default, weak) pair that maximizes recall subject to
// precision >= ci_precision_gate.
//
// Usage:
//   ATELIER_DATASTORE_URL=... OPENAI_API_KEY=... \
//     npx tsx scripts/eval/find_similar/calibrate.ts --project <uuid>
//
// Output is a precision/recall table across the grid + a recommended
// (default, weak) pair. The recommended value is the one to write into
// .atelier/config.yaml find_similar.{default_threshold, weak_suggestion_threshold}.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Pool } from 'pg';
import { parse as parseYaml } from 'yaml';

import { findSimilar } from '../../endpoint/lib/find-similar.ts';
import { loadFindSimilarConfig } from '../../coordination/lib/embed-config.ts';
import { createOpenAICompatibleEmbeddingsService } from '../../coordination/adapters/openai-compatible-embeddings.ts';

interface Seed {
  id: string;
  query: string;
  trace_id?: string;
  expected: string[];
}

const REPO_ROOT = process.cwd();

async function main(): Promise<void> {
  const projectId = process.argv[process.argv.indexOf('--project') + 1];
  if (!projectId) {
    console.error('--project <uuid> required');
    process.exit(2);
  }
  const datastoreUrl = process.env['ATELIER_DATASTORE_URL'];
  if (!datastoreUrl) {
    console.error('ATELIER_DATASTORE_URL not set');
    process.exit(2);
  }

  const config = loadFindSimilarConfig(REPO_ROOT);
  const seedFilePath = resolve(REPO_ROOT, config.evalSetPath, 'seeds.yaml');
  if (!existsSync(seedFilePath)) {
    console.error(`Seed file not found: ${seedFilePath}`);
    process.exit(2);
  }
  const seeds = (parseYaml(readFileSync(seedFilePath, 'utf8')) as { seeds: Seed[] }).seeds;

  const embedder = createOpenAICompatibleEmbeddingsService({
    baseUrl: config.yaml.embeddings.base_url,
    modelName: config.yaml.embeddings.model_name,
    dimensions: config.yaml.embeddings.dimensions,
    apiKeyEnv: config.yaml.embeddings.api_key_env,
  });

  const pool = new Pool({ connectionString: datastoreUrl });

  // Collect raw scores for every (seed, candidate) pair once. Then we sweep
  // thresholds in JS without re-querying. We do this by running findSimilar
  // at threshold=0.0 (so EVERY candidate is returned) and recording the
  // scores. The per-band partition logic at non-zero thresholds is then
  // pure JS arithmetic against these scores.

  console.log(`[calibrate] embedding ${seeds.length} queries + collecting raw scores`);
  const perSeedScores: Array<{
    seed: Seed;
    candidates: Array<{ source_ref: string; score: number }>;
  }> = [];

  for (const seed of seeds) {
    const response = await findSimilar(
      projectId,
      { description: seed.query, ...(seed.trace_id ? { trace_id: seed.trace_id } : {}) },
      {
        pool,
        embedder,
        // Calibration sweeps the threshold post-hoc; we collect ALL candidates
        // at threshold=0 and partition in JS. Strategy must match what the
        // calibration is calibrating: pass it through the runtime config block.
        config: {
          defaultThreshold: 0,
          weakSuggestionThreshold: 0,
          topKPerBand: 50,
          strategy: config.thresholds.strategy,
          rrfK: config.thresholds.rrfK,
        },
      },
    );
    // primary_matches at threshold=0 includes everything that scored >= 0
    // (which for cosine on normalized embeddings is essentially every row).
    perSeedScores.push({
      seed,
      candidates: response.primary_matches.map((m) => ({
        source_ref: m.source_ref,
        score: m.score,
      })),
    });
  }

  // Sweep grid is strategy-dependent. Cosine (vector-only) similarities
  // sit in [0, 1] with practical matches in [0.30, 0.55] for this corpus.
  // RRF (hybrid) scores sum 1/(k+rank) contributions, sitting in
  // [~0.008, ~0.033] for k=60 + dual-ranker top-3.
  const isHybrid = config.thresholds.strategy === 'hybrid';
  const defaultGrid: number[] = [];
  let weakOffsets: number[];
  if (isHybrid) {
    for (let d = 0.008; d <= 0.034 + 1e-9; d += 0.002) defaultGrid.push(round(d, 4));
    weakOffsets = [0.002, 0.004, 0.006, 0.008];
  } else {
    for (let d = 0.3; d <= 0.5 + 1e-9; d += 0.025) defaultGrid.push(round(d, 3));
    weakOffsets = [0.05, 0.075, 0.1, 0.125, 0.15];
  }

  interface GridRow {
    defaultT: number;
    weakT: number;
    tp: number;
    fp: number;
    fn: number;
    precision: number;
    recall: number;
    passes: boolean;
  }
  const grid: GridRow[] = [];
  const topK = config.thresholds.topKPerBand;

  for (const defaultT of defaultGrid) {
    for (const offset of weakOffsets) {
      const weakT = round(defaultT - offset, 4);
      let tp = 0;
      let fp = 0;
      let fn = 0;
      for (const { seed, candidates } of perSeedScores) {
        const ranked = [...candidates].sort((a, b) => b.score - a.score);
        const primary = ranked.filter((c) => c.score >= defaultT).slice(0, topK);
        const expectedSet = new Set(seed.expected);
        const primarySet = new Set(primary.map((c) => c.source_ref));
        for (const ref of primarySet) {
          if (expectedSet.has(ref)) tp += 1;
          else fp += 1;
        }
        for (const ref of expectedSet) {
          if (!primarySet.has(ref)) fn += 1;
        }
      }
      const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
      const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
      const passes = precision >= config.ciPrecisionGate && recall >= config.ciRecallGate;
      grid.push({ defaultT, weakT, tp, fp, fn, precision, recall, passes });
    }
  }

  await pool.end();
  if (embedder.close) await embedder.close();

  // Sort: passing rows first (highest recall, then highest precision); then
  // failing rows (closest to passing first).
  grid.sort((a, b) => {
    if (a.passes !== b.passes) return a.passes ? -1 : 1;
    if (a.passes) {
      if (a.recall !== b.recall) return b.recall - a.recall;
      return b.precision - a.precision;
    }
    // For failing rows, sort by precision desc then recall desc (closer to passing).
    if (a.precision !== b.precision) return b.precision - a.precision;
    return b.recall - a.recall;
  });

  const decimals = isHybrid ? 4 : 3;
  console.log(
    `\n[calibrate] strategy=${config.thresholds.strategy} gate: precision >= ${config.ciPrecisionGate} AND recall >= ${config.ciRecallGate}\n`,
  );
  console.log('default  | weak    | tp  | fp  | fn  | precision | recall | passes');
  console.log('---------|---------|-----|-----|-----|-----------|--------|-------');
  for (const row of grid) {
    console.log(
      `${row.defaultT.toFixed(decimals).padStart(7)}  | ` +
        `${row.weakT.toFixed(decimals).padStart(7)} | ` +
        `${String(row.tp).padStart(3)} | ` +
        `${String(row.fp).padStart(3)} | ` +
        `${String(row.fn).padStart(3)} | ` +
        `${row.precision.toFixed(3).padStart(9)} | ` +
        `${row.recall.toFixed(3).padStart(6)} | ` +
        `${row.passes ? 'YES' : 'no'}`,
    );
  }

  const passing = grid.filter((r) => r.passes);
  if (passing.length > 0) {
    // Best = highest recall among passing rows; tie-break on precision.
    const best = passing[0]!;
    console.log(
      `\n[calibrate] RECOMMENDED: default_threshold=${best.defaultT.toFixed(decimals)} weak_suggestion_threshold=${best.weakT.toFixed(decimals)} ` +
        `(precision=${best.precision.toFixed(3)}, recall=${best.recall.toFixed(3)})`,
    );
  } else {
    const closest = grid[0]!;
    console.log(
      `\n[calibrate] NO PAIR PASSES the gate. Closest: default=${closest.defaultT.toFixed(decimals)} weak=${closest.weakT.toFixed(decimals)} ` +
        `(precision=${closest.precision.toFixed(3)}, recall=${closest.recall.toFixed(3)}). ` +
        (isHybrid
          ? 'Hybrid is exhausted; the next move is to reconsider the eval set or the corpus density.'
          : 'Hybrid retrieval is the next move per ADR-041 reverse conditions.'),
    );
  }
}

function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
