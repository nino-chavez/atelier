#!/usr/bin/env tsx
// find_similar eval runner (ADR-006 + BRD Epic-6 + BUILD-SEQUENCE M5).
//
// Reads atelier/eval/find_similar/seeds.yaml, calls the production
// findSimilar() code path against a live datastore for each seed,
// computes precision + recall, and gates on the thresholds from
// .atelier/config.yaml.
//
// Usage:
//   npm run eval:find_similar -- --project <uuid>
//
// Env (per ADR-027 + ADR-041):
//   POSTGRES_URL  Postgres connection string (required).
//   OPENAI_API_KEY         Or whichever .atelier/config.yaml find_similar.
//                          embeddings.api_key_env names.
//
// Output:
//   - Per-seed log line (TP / FP / FN counts, precision, recall).
//   - Aggregate micro-averaged precision + recall.
//   - JSON metrics dump at --json-out path (default:
//     atelier/eval/find_similar/last-run.json) so CI can consume.
//   - Exit 0 if both gates clear; exit 1 otherwise. CI fails closed on the
//     non-zero exit per ADR-006's "CI gate is mandatory on main."
//
// Why we hit the live DB rather than a fixture: the eval validates the
// production code path (handler + SQL + adapter) end-to-end. A fixture-
// only mode would test the partition logic in isolation but miss
// regressions in pgvector indexing, cosine math, RLS scoping, or trace
// scope expansion. The CI design notes (in the M5 brief + below) describe
// the seed-corpus-as-fixture optimization for cost; that lands as a
// follow-up if the live-DB CI cost becomes a problem.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Pool } from 'pg';
import { parse as parseYaml } from 'yaml';

import {
  findSimilar,
  type FindSimilarConfig,
  type FindSimilarResponse,
} from '../../endpoint/lib/find-similar.ts';
import { loadFindSimilarConfig } from '../../coordination/lib/embed-config.ts';
import { createOpenAICompatibleEmbeddingsService } from '../../coordination/adapters/openai-compatible-embeddings.ts';
import type { EmbeddingService } from '../../coordination/lib/embeddings.ts';

// ===========================================================================
// Seed shape
// ===========================================================================

interface Seed {
  id: string;
  description?: string;
  query: string;
  trace_id?: string;
  expected: string[];
}

interface SeedFile {
  seeds: Seed[];
}

interface SeedResult {
  id: string;
  query: string;
  trace_id: string | null;
  expected: string[];
  primary_returned: string[];
  weak_returned: string[];
  degraded: boolean;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
}

interface RunReport {
  ran_at: string;
  project_id: string;
  seeds_total: number;
  thresholds: { default: number; weak: number; topKPerBand: number };
  ci_gates: { precision: number; recall: number };
  aggregate: { tp: number; fp: number; fn: number; precision: number; recall: number };
  passed: boolean;
  per_seed: SeedResult[];
}

// ===========================================================================
// CLI
// ===========================================================================

interface CliArgs {
  projectId: string | null;
  repoRoot: string;
  jsonOut: string;
  seedFile: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    projectId: null,
    repoRoot: process.cwd(),
    jsonOut: '',
    seedFile: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--project':
        args.projectId = argv[++i] ?? null;
        break;
      case '--repo-root':
        args.repoRoot = argv[++i] ?? process.cwd();
        break;
      case '--json-out':
        args.jsonOut = argv[++i] ?? '';
        break;
      case '--seed-file':
        args.seedFile = argv[++i] ?? '';
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
    }
  }
  return args;
}

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.log(`
eval:find_similar -- run the M5 eval gate per ADR-006

Usage:
  npm run eval:find_similar -- --project <uuid> [options]

Options:
  --project <uuid>     Required. Atelier project UUID.
  --repo-root <path>   Defaults to cwd.
  --seed-file <path>   Override seed file location. Defaults to
                       <repo-root>/atelier/eval/find_similar/seeds.yaml
                       (or whatever .atelier/config.yaml find_similar.eval_set_path
                       names).
  --json-out <path>    Write metrics JSON. Defaults to
                       <repo-root>/atelier/eval/find_similar/last-run.json.
                       Omit by passing the empty string.

Exit:
  0 if precision >= ci_precision_gate AND recall >= ci_recall_gate.
  1 otherwise. CI gates fail closed.

Env:
  POSTGRES_URL  Postgres connection string.
  OPENAI_API_KEY         Or whichever apiKeyEnv config names.
`);
}

// ===========================================================================
// Run
// ===========================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId) {
    // eslint-disable-next-line no-console
    console.error('--project is required; see --help');
    process.exit(2);
  }

  const datastoreUrl = process.env['POSTGRES_URL'];
  if (!datastoreUrl) {
    // eslint-disable-next-line no-console
    console.error('POSTGRES_URL is not set');
    process.exit(2);
  }

  const config = loadFindSimilarConfig(args.repoRoot);
  const seedFilePath =
    args.seedFile || resolve(args.repoRoot, config.evalSetPath, config.evalSeedFile);
  if (!existsSync(seedFilePath)) {
    // eslint-disable-next-line no-console
    console.error(`Seed file not found: ${seedFilePath}`);
    process.exit(2);
  }
  const seedFile = parseYaml(readFileSync(seedFilePath, 'utf8')) as SeedFile;
  if (!seedFile?.seeds || !Array.isArray(seedFile.seeds) || seedFile.seeds.length === 0) {
    // eslint-disable-next-line no-console
    console.error(`Seed file ${seedFilePath} has no seeds`);
    process.exit(2);
  }

  let embedder: EmbeddingService;
  try {
    embedder = createOpenAICompatibleEmbeddingsService({
      baseUrl: config.yaml.embeddings.base_url,
      modelName: config.yaml.embeddings.model_name,
      dimensions: config.yaml.embeddings.dimensions,
      apiKeyEnv: config.yaml.embeddings.api_key_env,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`eval-runner: adapter construction failed: ${(err as Error).message}`);
    process.exit(2);
  }

  const pool = new Pool({ connectionString: datastoreUrl });
  const thresholds: FindSimilarConfig = config.thresholds;

  const results: SeedResult[] = [];
  let totalTp = 0;
  let totalFp = 0;
  let totalFn = 0;

  try {
    // eslint-disable-next-line no-console
    console.log(
      `[eval:find_similar] running ${seedFile.seeds.length} seeds against project ${args.projectId} ` +
        `(thresholds default=${thresholds.defaultThreshold} weak=${thresholds.weakSuggestionThreshold} top_k=${thresholds.topKPerBand})`,
    );
    for (const seed of seedFile.seeds) {
      const response: FindSimilarResponse = await findSimilar(
        args.projectId,
        { description: seed.query, ...(seed.trace_id ? { trace_id: seed.trace_id } : {}) },
        { pool, embedder, config: thresholds },
      );
      const primarySet = new Set(response.primary_matches.map((m) => m.source_ref));
      const expectedSet = new Set(seed.expected);
      let tp = 0;
      let fp = 0;
      let fn = 0;
      for (const ref of primarySet) {
        if (expectedSet.has(ref)) tp += 1;
        else fp += 1;
      }
      for (const ref of expectedSet) {
        if (!primarySet.has(ref)) fn += 1;
      }
      const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
      const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
      totalTp += tp;
      totalFp += fp;
      totalFn += fn;
      const result: SeedResult = {
        id: seed.id,
        query: seed.query,
        trace_id: seed.trace_id ?? null,
        expected: seed.expected,
        primary_returned: response.primary_matches.map((m) => m.source_ref),
        weak_returned: response.weak_suggestions.map((m) => m.source_ref),
        degraded: response.degraded,
        tp,
        fp,
        fn,
        precision,
        recall,
      };
      results.push(result);
      // eslint-disable-next-line no-console
      console.log(
        `  ${seed.id.padEnd(28)} tp=${tp} fp=${fp} fn=${fn} ` +
          `P=${precision.toFixed(2)} R=${recall.toFixed(2)}` +
          (response.degraded ? ' [DEGRADED]' : ''),
      );
    }
  } finally {
    await pool.end();
    if (embedder.close) await embedder.close();
  }

  const aggregatePrecision = totalTp + totalFp === 0 ? 0 : totalTp / (totalTp + totalFp);
  const aggregateRecall = totalTp + totalFn === 0 ? 0 : totalTp / (totalTp + totalFn);
  const passed =
    aggregatePrecision >= config.ciPrecisionGate && aggregateRecall >= config.ciRecallGate;

  const report: RunReport = {
    ran_at: new Date().toISOString(),
    project_id: args.projectId,
    seeds_total: seedFile.seeds.length,
    thresholds: {
      default: thresholds.defaultThreshold,
      weak: thresholds.weakSuggestionThreshold,
      topKPerBand: thresholds.topKPerBand,
    },
    ci_gates: { precision: config.ciPrecisionGate, recall: config.ciRecallGate },
    aggregate: {
      tp: totalTp,
      fp: totalFp,
      fn: totalFn,
      precision: aggregatePrecision,
      recall: aggregateRecall,
    },
    passed,
    per_seed: results,
  };

  // eslint-disable-next-line no-console
  console.log(
    `\n[eval:find_similar] AGGREGATE  tp=${totalTp} fp=${totalFp} fn=${totalFn}  ` +
      `precision=${aggregatePrecision.toFixed(3)} recall=${aggregateRecall.toFixed(3)}  ` +
      `gate=${config.gateTier} (>=${config.ciPrecisionGate}/>=${config.ciRecallGate})  ` +
      `${passed ? 'PASS' : 'FAIL'}`,
  );

  if (args.jsonOut !== '') {
    const out =
      args.jsonOut || join(args.repoRoot, config.evalSetPath, 'last-run.json');
    writeFileSync(out, JSON.stringify(report, null, 2));
    // eslint-disable-next-line no-console
    console.log(`[eval:find_similar] wrote ${out}`);
  }

  process.exit(passed ? 0 : 1);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
