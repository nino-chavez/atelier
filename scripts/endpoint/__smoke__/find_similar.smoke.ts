#!/usr/bin/env -S npx tsx
//
// find_similar smoke (M5 / ADR-006 / ADR-041).
//
// End-to-end exercise of the find_similar handler against a real Postgres
// (with migration 6 applied) and a stub embedder. The stub returns a
// deterministic embedding derived from the input text, so we can seed
// rows with known cosine relationships and assert ranking + banding +
// trace scoping + degraded fallback paths against the production code
// path -- not a fixture, not a mock partition function.
//
// What this catches that unit tests of partition logic cannot:
//   - pgvector cosine math against the HNSW index (migration 6 wiring).
//   - SQL parameter binding for trace-scope (text[] && operator) and
//     vector literal serialization.
//   - The keyword fallback path (FTS index in migration 6) when the
//     embedder fails.
//   - Project-scoped RLS bypass via service_role (canonical write path).
//
// Run against a fresh local Supabase (`supabase db reset --local` first):
//   DATABASE_URL=... npx tsx scripts/endpoint/__smoke__/find_similar.smoke.ts

import { Client } from 'pg';
import { AtelierClient } from '../../sync/lib/write.ts';
import { stubVerifier } from '../lib/auth.ts';
import { dispatch } from '../lib/dispatch.ts';
import {
  AdapterUnavailableError,
  formatModelVersion,
  type EmbedInput,
  type EmbedResult,
  type EmbeddingService,
} from '../../coordination/lib/embeddings.ts';
import { upsertEmbedding, contentHash } from '../../coordination/lib/embed-pipeline.ts';
import { expandTraceScope } from '../lib/find-similar.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DIM = 1536;

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

// ===========================================================================
// Stub embedder
// ===========================================================================
//
// Maps a small set of seed phrases to fixed unit vectors so we can engineer
// known cosine relationships:
//   - phrases sharing a "topic" map to vectors with the same active slot.
//   - same active slot -> cosine ~1.0; different slots -> cosine ~0.0.
//   - The 1536-dim output matches ADR-041's column dim exactly.

class StubEmbedder implements EmbeddingService {
  readonly dimensions = DIM;
  private readonly _modelVersion = formatModelVersion('stub', 'topic-slots-v1', DIM);
  failNext = false;

  modelVersion(): string {
    return this._modelVersion;
  }

  async embed(input: EmbedInput): Promise<EmbedResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new AdapterUnavailableError('stub embedder configured to fail this call');
    }
    const slot = topicSlot(input.text);
    const v = new Array(DIM).fill(0);
    v[slot] = 1;
    return { embedding: v, modelVersion: this._modelVersion };
  }
}

const TOPIC_KEYWORDS: Array<{ slot: number; tokens: string[] }> = [
  { slot: 0,  tokens: ['fencing', 'lock'] },
  { slot: 1,  tokens: ['embedding', 'similarity', 'find_similar'] },
  { slot: 2,  tokens: ['contribution', 'lifecycle', 'plan_review'] },
  { slot: 3,  tokens: ['vendor', 'gcp', 'portability'] },
  { slot: 4,  tokens: ['lens', 'review', 'routing'] },
];
function topicSlot(text: string): number {
  const lower = text.toLowerCase();
  let bestSlot = 100; // default: a slot far from any seeded slot
  let bestHits = -1;
  for (const t of TOPIC_KEYWORDS) {
    const hits = t.tokens.reduce((acc, token) => acc + (lower.includes(token) ? 1 : 0), 0);
    if (hits > bestHits) {
      bestHits = hits;
      bestSlot = t.slot;
    }
  }
  return bestSlot;
}

// ===========================================================================
// Main
// ===========================================================================

async function main(): Promise<void> {
  console.log('\n[1] expandTraceScope (ARCH 6.4.3)');
  check('US-1.3 expands to [US-1.3, BRD:Epic-1]', JSON.stringify(expandTraceScope('US-1.3')) === JSON.stringify(['US-1.3', 'BRD:Epic-1']));
  check('BRD:Epic-1 stays singleton', JSON.stringify(expandTraceScope('BRD:Epic-1')) === JSON.stringify(['BRD:Epic-1']));
  check('ADR-041 stays singleton', JSON.stringify(expandTraceScope('ADR-041')) === JSON.stringify(['ADR-041']));

  // ---------------------------------------------------------------------------
  // Seed fixtures
  // ---------------------------------------------------------------------------
  console.log('\n[2] seed projects + composer + corpus rows');
  const seed = new Client({ connectionString: DB_URL });
  await seed.connect();

  const projectId = 'aaaaaaaa-1111-1111-1111-111111111111';
  const composerId = 'aaaaaaaa-2222-2222-2222-222222222222';
  await seed.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
  await seed.query(
    `INSERT INTO projects (id, name, repo_url, template_version)
     VALUES ($1, 'find-similar-smoke', 'https://example.invalid/fs', '1.0')`,
    [projectId],
  );
  await seed.query(
    `INSERT INTO composers (id, project_id, email, display_name, discipline, identity_subject)
     VALUES ($1, $2, 'fs@smoke.invalid', 'FS Smoke', 'analyst', 'sub-fs-smoke')`,
    [composerId, projectId],
  );
  await seed.end();

  const client = new AtelierClient({ databaseUrl: DB_URL });
  const embedder = new StubEmbedder();
  const deps = { client, verifier: stubVerifier, embedder };
  const bearer = 'stub:sub-fs-smoke';

  try {
    // Insert corpus rows via the production embed pipeline (upsertEmbedding)
    // so RLS scoping + content_hash + dim assertion all run.
    const pool = (client as unknown as { pool: import('pg').Pool }).pool;
    const corpus: Array<{
      sourceKind: 'decision' | 'brd_section' | 'prd_section' | 'research_artifact' | 'contribution';
      sourceRef: string;
      contentText: string;
      traceIds: string[];
    }> = [
      {
        sourceKind: 'decision',
        sourceRef: 'docs/architecture/decisions/ADR-006-fit-check-ships-at-v1-with-eval-harness-and-ci-gate.md',
        contentText: 'find_similar embedding ships at v1 with precision recall similarity gate',
        traceIds: ['ADR-006', 'BRD:Epic-6'],
      },
      {
        sourceKind: 'decision',
        sourceRef: 'docs/architecture/decisions/ADR-041-embedding-model-default-openai-compatible-adapter.md',
        contentText: 'embedding model default OpenAI-compatible adapter find_similar similarity',
        traceIds: ['ADR-041', 'BRD:Epic-6'],
      },
      {
        sourceKind: 'decision',
        sourceRef: 'docs/architecture/decisions/ADR-004-fencing-tokens-mandatory-on-all-locks-from-v1.md',
        contentText: 'fencing tokens lock acquisition mandatory v1 stale token rejected',
        traceIds: ['ADR-004', 'BRD:Epic-7'],
      },
      {
        sourceKind: 'decision',
        sourceRef: 'docs/architecture/decisions/ADR-026-atelier-owns-the-lock-fencing-implementation-switchman-not-a.md',
        contentText: 'atelier owns lock fencing implementation switchman not adopted',
        traceIds: ['ADR-026', 'BRD:Epic-7'],
      },
      {
        sourceKind: 'decision',
        sourceRef: 'docs/architecture/decisions/ADR-029-reference-impl-preserves-gcp-portability-migration-mapping-d.md',
        contentText: 'reference implementation preserves gcp portability migration mapping vendor',
        traceIds: ['ADR-029', 'BRD:Epic-1'],
      },
    ];
    for (const row of corpus) {
      const outcome = await upsertEmbedding(pool, embedder, {
        projectId,
        sourceKind: row.sourceKind,
        sourceRef: row.sourceRef,
        contentText: row.contentText,
        traceIds: row.traceIds,
      });
      check(`upsert ${row.sourceRef}`, outcome.action === 'inserted', `action=${outcome.action}`);
    }

    // -------------------------------------------------------------
    // [3] Vector search returns expected primary matches above threshold
    // -------------------------------------------------------------
    console.log('\n[3] Vector kNN -- find_similar ranks by similarity');
    const findSimilarReq = {
      tool: 'find_similar',
      bearer,
      body: { description: 'embedding similarity find_similar' },
    };
    const result = await dispatch(findSimilarReq, deps);
    check('dispatch ok', result.ok === true);
    if (result.ok) {
      const data = result.data as {
        primary_matches: Array<{ source_ref: string; score: number }>;
        weak_suggestions: unknown[];
        degraded: boolean;
        thresholds_used: { default: number; weak: number };
      };
      check('not degraded', data.degraded === false);
      const refs = data.primary_matches.map((m) => m.source_ref);
      check(
        'ADR-041 in primary_matches',
        refs.some((r) => r.includes('ADR-041')),
      );
      check(
        'ADR-006 in primary_matches',
        refs.some((r) => r.includes('ADR-006')),
      );
      check(
        'lock ADRs not in primary (different topic slot, similarity ~0)',
        !refs.some((r) => r.includes('ADR-004') || r.includes('ADR-026')),
      );
      check(
        'all primary scores >= default_threshold',
        data.primary_matches.every((m) => m.score >= data.thresholds_used.default),
      );
    }

    // -------------------------------------------------------------
    // [4] Trace-scope filtering (ARCH 6.4.3)
    // -------------------------------------------------------------
    console.log('\n[4] Trace-scope filter -- BRD:Epic-7 limits to lock ADRs');
    const lockResult = await dispatch(
      { tool: 'find_similar', bearer, body: { description: 'fencing lock token', trace_id: 'BRD:Epic-7' } },
      deps,
    );
    check('lock-trace dispatch ok', lockResult.ok === true);
    if (lockResult.ok) {
      const data = lockResult.data as { primary_matches: Array<{ source_ref: string; trace_ids: string[] }> };
      check(
        'all primary results carry BRD:Epic-7 in trace_ids (per scope expansion)',
        data.primary_matches.length > 0
          && data.primary_matches.every((m) => m.trace_ids.includes('BRD:Epic-7')),
      );
    }

    // -------------------------------------------------------------
    // [5] Empty description rejected as BAD_REQUEST
    // -------------------------------------------------------------
    console.log('\n[5] Validation -- empty description BAD_REQUEST');
    const emptyResult = await dispatch(
      { tool: 'find_similar', bearer, body: { description: '   ' } },
      deps,
    );
    check(
      'empty description returns BAD_REQUEST',
      emptyResult.ok === false && (emptyResult as { ok: false; error: { code: string } }).error.code === 'BAD_REQUEST',
    );

    // -------------------------------------------------------------
    // [6] Adapter failure -> degraded keyword fallback
    // -------------------------------------------------------------
    console.log('\n[6] Adapter unavailable -> keyword FTS fallback (US-6.5)');
    embedder.failNext = true;
    const degradedResult = await dispatch(
      { tool: 'find_similar', bearer, body: { description: 'fencing token rejected' } },
      deps,
    );
    check('degraded dispatch ok', degradedResult.ok === true);
    if (degradedResult.ok) {
      const data = degradedResult.data as {
        primary_matches: Array<{ source_ref: string }>;
        degraded: boolean;
      };
      check('degraded=true on adapter failure', data.degraded === true);
      check(
        'FTS still surfaces the matching ADR-004',
        data.primary_matches.some((m) => m.source_ref.includes('ADR-004')),
      );
    }

    // -------------------------------------------------------------
    // [7] content_hash skip path -- second upsert is a no-op
    // -------------------------------------------------------------
    console.log('\n[7] content_hash skip path');
    const skipOutcome = await upsertEmbedding(pool, embedder, {
      projectId,
      sourceKind: 'decision',
      sourceRef: 'docs/architecture/decisions/ADR-006-fit-check-ships-at-v1-with-eval-harness-and-ci-gate.md',
      contentText: 'find_similar embedding ships at v1 with precision recall similarity gate',
      traceIds: ['ADR-006', 'BRD:Epic-6'],
    });
    check(
      'identical content + model -> skipped',
      skipOutcome.action === 'skipped',
      `action=${skipOutcome.action}`,
    );

    // -------------------------------------------------------------
    // [8] contentHash determinism
    // -------------------------------------------------------------
    console.log('\n[8] contentHash determinism');
    const h1 = contentHash('alpha beta gamma');
    const h2 = contentHash('alpha beta gamma');
    const h3 = contentHash('alpha beta gamma '); // trailing space
    check('same input -> same hash', h1 === h2);
    check('whitespace-different input -> different hash', h1 !== h3);
  } finally {
    await client.close();
  }

  if (failures > 0) {
    console.log(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
