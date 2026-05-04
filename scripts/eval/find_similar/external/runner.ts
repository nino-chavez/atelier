#!/usr/bin/env tsx
//
// External-corpus eval runner (BRD-OPEN-QUESTIONS §26 wider eval).
//
// Embeds an external corpus dir (each .md file → one research_artifact row
// under a fixed project_id) and runs the merged seed set against it via
// the production findSimilar() code path. Outputs aggregate P/R per
// ADR-043 thresholds (advisory: P>=0.60 AND R>=0.60; blocking: P>=0.85
// AND R>=0.70).
//
// Differs from scripts/eval/find_similar/runner.ts in two ways:
//   1. Pre-embeds the external corpus before running seeds (the M5 runner
//      assumes the corpus is already embedded via embed-runner.ts; this
//      runner is self-contained for external corpora since their
//      extractor surface differs).
//   2. Compares against corpus-relative paths (just the .md filename) so
//      seed files don't need full repo-relative paths -- the source_ref
//      stored in pgvector matches the seed expected list directly.
//
// Run:
//   POSTGRES_URL=postgresql://... \
//   OPENAI_API_KEY=sk-... \
//     npx tsx scripts/eval/find_similar/external/runner.ts \
//       --corpus-dir atelier/eval/find_similar/external-corpora/claude-agent-sdk \
//       --project <uuid>
//
// Exit:
//   0 if both advisory thresholds clear (P>=0.60 AND R>=0.60)
//   1 otherwise

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Pool } from 'pg';
import { parse as parseYaml } from 'yaml';

import {
  findSimilar,
  type FindSimilarConfig,
  type FindSimilarResponse,
} from '../../../endpoint/lib/find-similar.ts';
import { loadFindSimilarConfig } from '../../../coordination/lib/embed-config.ts';
import { createOpenAICompatibleEmbeddingsService } from '../../../coordination/adapters/openai-compatible-embeddings.ts';
import type { EmbeddingService } from '../../../coordination/lib/embeddings.ts';
import { upsertEmbedding } from '../../../coordination/lib/embed-pipeline.ts';

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

function parseArg(name: string, fallback?: string): string {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx === -1) {
    if (fallback !== undefined) return fallback;
    throw new Error(`required flag --${name} missing`);
  }
  const value = process.argv[idx + 1];
  if (!value) throw new Error(`--${name} requires a value`);
  return value;
}

async function ensureProject(pool: Pool, projectId: string, label: string): Promise<void> {
  await pool.query(
    `INSERT INTO projects (id, name, repo_url, template_version)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [projectId, label, `external://${label}`, '1.0'],
  );
}

async function embedCorpus(
  pool: Pool,
  embedder: EmbeddingService,
  corpusDir: string,
  projectId: string,
): Promise<{ embedded: number; skipped: number }> {
  let embedded = 0;
  let skipped = 0;
  for (const entry of readdirSync(corpusDir)) {
    if (!entry.endsWith('.md')) continue;
    if (entry === 'CORPUS.md') continue; // index doc, not part of the corpus
    const fullPath = join(corpusDir, entry);
    const content = readFileSync(fullPath, 'utf8');
    if (content.trim().length === 0) {
      skipped += 1;
      continue;
    }
    const outcome = await upsertEmbedding(pool, embedder, {
      projectId,
      sourceKind: 'research_artifact',
      sourceRef: entry, // corpus-relative; matches seed expected paths
      contentText: content,
      traceIds: [],
    });
    if (outcome.action === 'skipped') skipped += 1;
    else if (outcome.action === 'failed') {
      console.error(`[embed] FAIL ${entry}: ${outcome.reason}`);
      skipped += 1;
    } else {
      embedded += 1;
    }
  }
  return { embedded, skipped };
}

async function main(): Promise<void> {
  const corpusDir = resolve(parseArg('corpus-dir'));
  const projectId = parseArg('project');
  const repoRoot = resolve(process.cwd());
  const datastoreUrl = process.env['POSTGRES_URL'];
  if (!datastoreUrl) {
    console.error('POSTGRES_URL is not set');
    process.exit(2);
  }
  if (!process.env['OPENAI_API_KEY']) {
    console.error('OPENAI_API_KEY is not set');
    process.exit(2);
  }
  if (!existsSync(corpusDir)) {
    console.error(`corpus-dir not found: ${corpusDir}`);
    process.exit(2);
  }
  const seedPath = join(corpusDir, 'seeds-merged.yaml');
  if (!existsSync(seedPath)) {
    console.error(`seeds-merged.yaml not found in ${corpusDir}; run merge-seeds.ts first`);
    process.exit(2);
  }

  const config = loadFindSimilarConfig(repoRoot);
  const seedFile = parseYaml(readFileSync(seedPath, 'utf8')) as SeedFile;
  console.log(`[eval] corpus=${corpusDir}`);
  console.log(`[eval] project=${projectId}`);
  console.log(`[eval] seeds=${seedFile.seeds.length}`);
  console.log(`[eval] thresholds: default=${config.thresholds.defaultThreshold} weak=${config.thresholds.weakSuggestionThreshold} top_k=${config.thresholds.topKPerBand}`);

  const embedder = createOpenAICompatibleEmbeddingsService({
    baseUrl: config.yaml.embeddings.base_url,
    modelName: config.yaml.embeddings.model_name,
    dimensions: config.yaml.embeddings.dimensions,
    apiKeyEnv: config.yaml.embeddings.api_key_env,
  });

  const pool = new Pool({ connectionString: datastoreUrl });
  try {
    await ensureProject(pool, projectId, 'eval-claude-agent-sdk');

    console.log(`\n[embed] embedding corpus...`);
    const t0 = Date.now();
    const { embedded, skipped } = await embedCorpus(pool, embedder, corpusDir, projectId);
    console.log(`[embed] ${embedded} embedded; ${skipped} skipped/unchanged in ${(Date.now() - t0) / 1000}s`);

    console.log(`\n[eval] running ${seedFile.seeds.length} seeds...`);
    const results: SeedResult[] = [];
    let totalTp = 0;
    let totalFp = 0;
    let totalFn = 0;

    const thresholds: FindSimilarConfig = config.thresholds;
    for (const seed of seedFile.seeds) {
      const response: FindSimilarResponse = await findSimilar(
        projectId,
        { description: seed.query },
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
      results.push({
        id: seed.id,
        query: seed.query,
        expected: seed.expected,
        primary_returned: response.primary_matches.map((m) => m.source_ref),
        weak_returned: response.weak_suggestions.map((m) => m.source_ref),
        degraded: response.degraded,
        tp,
        fp,
        fn,
        precision,
        recall,
      });
    }

    const aggregateP = totalTp + totalFp === 0 ? 0 : totalTp / (totalTp + totalFp);
    const aggregateR = totalTp + totalFn === 0 ? 0 : totalTp / (totalTp + totalFn);

    // ADR-043 tier checks
    const advisoryClear = aggregateP >= 0.6 && aggregateR >= 0.6;
    const blockingClear = aggregateP >= 0.85 && aggregateR >= 0.7;

    console.log(`\n=========================================`);
    console.log(`AGGREGATE  tp=${totalTp} fp=${totalFp} fn=${totalFn}`);
    console.log(`AGGREGATE  P=${aggregateP.toFixed(4)}  R=${aggregateR.toFixed(4)}`);
    console.log(`ADR-043 tier:`);
    console.log(`  advisory (P>=0.60 AND R>=0.60): ${advisoryClear ? 'CLEAR' : 'NOT CLEAR'}`);
    console.log(`  blocking (P>=0.85 AND R>=0.70): ${blockingClear ? 'CLEAR' : 'NOT CLEAR'}`);
    console.log(`=========================================`);

    const outPath = join(corpusDir, 'last-run.json');
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          ran_at: new Date().toISOString(),
          corpus_dir: corpusDir,
          project_id: projectId,
          seeds_total: seedFile.seeds.length,
          embedded_items: embedded,
          thresholds: {
            default: thresholds.defaultThreshold,
            weak: thresholds.weakSuggestionThreshold,
            topKPerBand: thresholds.topKPerBand,
          },
          aggregate: {
            tp: totalTp,
            fp: totalFp,
            fn: totalFn,
            precision: aggregateP,
            recall: aggregateR,
          },
          adr_043_tier: {
            advisory_clear: advisoryClear,
            blocking_clear: blockingClear,
          },
          per_seed: results,
        },
        null,
        2,
      ),
    );
    console.log(`[eval] last-run.json written to ${outPath}`);

    process.exit(advisoryClear ? 0 : 1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('external runner failed:', err instanceof Error ? err.message : err);
  process.exit(2);
});
