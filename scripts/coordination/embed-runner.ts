#!/usr/bin/env tsx
// Embed-runner CLI (ARCH 6.4.2 bootstrap + atelier eval find_similar
// --rebuild-index raw form per BUILD-SEQUENCE M5).
//
// Walks the corpus, embeds each item via the configured adapter, upserts
// into the embeddings table. Per ADR-006 + the M5 brief this is the
// substrate the eval harness queries against and the substrate the
// find_similar handler reads from at runtime.
//
// Usage:
//   tsx scripts/coordination/embed-runner.ts --project <id> [--source-kind <kind>] [--rebuild]
//
// Required env (per ADR-027 + ADR-041):
//   ATELIER_DATASTORE_URL  (Postgres connection string)
//   OPENAI_API_KEY         (or whatever .atelier/config.yaml find_similar.embeddings.api_key_env names)
//
// Behavior:
//   - Reads .atelier/config.yaml find_similar.embeddings to construct adapter.
//   - Walks the file-resident corpus (decisions / brd / prd / research).
//   - For each item, upsertEmbedding() skips when content unchanged; else
//     re-embeds via the adapter.
//   - --rebuild forces every row to be re-embedded (use after model swap
//     per ARCH 6.4.2; clears content_hash so the upsert path always fires).
//   - --source-kind narrows to a single kind for ad-hoc rebuilds.
//
// Why a CLI script (not a polished `atelier eval find_similar --rebuild-index`):
//   per BUILD-SEQUENCE.md section 9, M5 lands the raw form; the wrapped
//   command lands at M7. Direct invocation via tsx is the M5 contract.

import { Pool } from 'pg';

import { loadFindSimilarConfig } from './lib/embed-config.ts';
import { extractFullCorpus } from './lib/corpus-extractors.ts';
import {
  upsertEmbedding,
  assertVectorDimMatchesAdapter,
  contentHash,
  type UpsertOutcome,
  type EmbeddingSourceKind,
} from './lib/embed-pipeline.ts';
import { createOpenAICompatibleEmbeddingsService } from './adapters/openai-compatible-embeddings.ts';
import type { EmbeddingService } from './lib/embeddings.ts';

interface CliArgs {
  projectId: string | null;
  sourceKind: EmbeddingSourceKind | null;
  rebuild: boolean;
  repoRoot: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    projectId: null,
    sourceKind: null,
    rebuild: false,
    repoRoot: process.cwd(),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--project':
        args.projectId = argv[++i] ?? null;
        break;
      case '--source-kind':
        args.sourceKind = argv[++i] as EmbeddingSourceKind;
        break;
      case '--rebuild':
        args.rebuild = true;
        break;
      case '--repo-root':
        args.repoRoot = argv[++i] ?? process.cwd();
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
embed-runner — populate the embeddings table from the file-resident corpus

Usage:
  tsx scripts/coordination/embed-runner.ts --project <id> [options]

Options:
  --project <id>          Required. Atelier project UUID.
  --source-kind <kind>    Restrict to one kind: decision | brd_section |
                          prd_section | research_artifact.
  --rebuild               Force re-embed of every row (post-model-swap).
  --repo-root <path>      Defaults to cwd.

Env:
  ATELIER_DATASTORE_URL   Postgres connection string (required).
  OPENAI_API_KEY          Or whatever .atelier/config.yaml find_similar.
                          embeddings.api_key_env names.
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId) {
    // eslint-disable-next-line no-console
    console.error('--project is required; see --help');
    process.exit(2);
  }

  const datastoreUrl = process.env['ATELIER_DATASTORE_URL'];
  if (!datastoreUrl) {
    // eslint-disable-next-line no-console
    console.error('ATELIER_DATASTORE_URL is not set');
    process.exit(2);
  }

  const config = loadFindSimilarConfig(args.repoRoot);
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
    console.error(`embed-runner: adapter construction failed: ${(err as Error).message}`);
    process.exit(2);
  }

  const pool = new Pool({ connectionString: datastoreUrl });

  try {
    await assertVectorDimMatchesAdapter(pool, embedder);

    let items = extractFullCorpus(args.repoRoot);
    if (args.sourceKind) {
      items = items.filter((it) => it.sourceKind === args.sourceKind);
    }

    if (args.rebuild) {
      // Clearing content_hash forces upsertEmbedding's hash-equality skip
      // to miss; the next upsert re-embeds. Scoped to the same project +
      // optional source_kind narrowing.
      const params: unknown[] = [args.projectId];
      let sql = `UPDATE embeddings SET content_hash = '' WHERE project_id = $1`;
      if (args.sourceKind) {
        sql += ` AND source_kind = $2`;
        params.push(args.sourceKind);
      }
      const result = await pool.query(sql, params);
      // eslint-disable-next-line no-console
      console.log(`[embed-runner] --rebuild cleared ${result.rowCount ?? 0} rows; re-embedding now`);
    }

    const counts: Record<UpsertOutcome['action'], number> = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };
    const failures: UpsertOutcome[] = [];

    for (const item of items) {
      const outcome = await upsertEmbedding(pool, embedder, {
        projectId: args.projectId,
        sourceKind: item.sourceKind as EmbeddingSourceKind,
        sourceRef: item.sourceRef,
        contentText: item.contentText,
        traceIds: item.traceIds,
      });
      counts[outcome.action] += 1;
      if (outcome.action === 'failed') failures.push(outcome);
      // eslint-disable-next-line no-console
      console.log(
        `[embed-runner] ${outcome.action.padEnd(8)} ${item.sourceKind.padEnd(18)} ${item.sourceRef}` +
          (outcome.action === 'failed' ? ` -- ${outcome.reason}` : ''),
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      `\n[embed-runner] summary: inserted=${counts.inserted} updated=${counts.updated} skipped=${counts.skipped} failed=${counts.failed} (total=${items.length})`,
    );
    if (counts.failed > 0) {
      process.exit(1);
    }
  } finally {
    await pool.end();
    if (embedder.close) await embedder.close();
  }
}

// Re-export contentHash for callers that want to compute their own
// without re-importing the pipeline file directly.
export { contentHash };

// CLI shim. tsx invocations land here; library imports skip the conditional.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

