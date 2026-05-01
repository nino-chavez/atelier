// Embed pipeline (ARCH 6.4.2).
//
// The substrate the find_similar handler reads from. Three responsibilities:
//   1. upsertEmbedding(): given a corpus item, embed it (if content hash
//      changed) and write the row.
//   2. removeEmbedding(): delete a row when its source is removed.
//   3. assertVectorDimMatchesAdapter(): guard against deploy-time
//      misconfiguration where the configured pgvector column dim and the
//      adapter's reported dim diverge -- a 768-dim model behind a 1536-dim
//      column inserts cleanly but every query returns zero matches.
//
// What this module does NOT do (deliberately):
//   - Walk the filesystem to discover what to embed. That is corpus-
//     extractors.ts, which produces ExtractedItem[].
//   - Schedule the work. The webhook → queue → worker flow per ARCH 6.4.2
//     is wired by the embed-runner CLI at M5; M7 polishes it. This module
//     is the one-shot embed-and-upsert API the runner calls in a loop.
//   - Inline-merge integration. The contribution-merge inline path (ARCH
//     6.4.2 "When a contribution transitions to state=merged, the endpoint
//     embeds inline") wires through write.ts at the merge transition; that
//     hook lands alongside this file but is invoked from there, not here.
//
// Why upsert (not insert + skip-if-exists): re-embedding the same content
// is wasteful and the adapter rate-limits matter. We compute SHA-256 of
// content_text; if the hash matches the existing row's content_hash, we
// skip the embed call entirely and only touch updated_at. Re-embedding
// happens when content changes OR when embedding_model_version changes
// (the model-swap rebuild path per ARCH 6.4.2).

import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  AdapterUnavailableError,
  type EmbeddingService,
} from './embeddings.ts';
import { embeddingToVectorLiteral } from '../../endpoint/lib/find-similar.ts';

// ===========================================================================
// Types
// ===========================================================================

export type EmbeddingSourceKind =
  | 'decision'
  | 'contribution'
  | 'brd_section'
  | 'prd_section'
  | 'research_artifact';

export interface UpsertEmbeddingInput {
  projectId: string;
  sourceKind: EmbeddingSourceKind;
  sourceRef: string;
  contentText: string;
  traceIds: string[];
}

export type UpsertOutcome =
  | { action: 'inserted'; sourceKind: EmbeddingSourceKind; sourceRef: string }
  | { action: 'updated'; sourceKind: EmbeddingSourceKind; sourceRef: string }
  | { action: 'skipped'; reason: 'unchanged'; sourceKind: EmbeddingSourceKind; sourceRef: string }
  | { action: 'failed'; reason: string; sourceKind: EmbeddingSourceKind; sourceRef: string };

// ===========================================================================
// Hashing
// ===========================================================================

export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ===========================================================================
// Dim assertion
// ===========================================================================

/**
 * Assert that the configured pgvector column dimension matches the
 * adapter's reported dim. Run once at startup. ADR-041 commits to
 * vector(1536) at v1; an adopter who swapped to a 768-dim model and
 * forgot to migrate the column would otherwise produce silent zero-match
 * queries forever.
 *
 * Reads the column's declared dimension from information_schema; throws
 * a descriptive error on mismatch.
 */
export async function assertVectorDimMatchesAdapter(
  pool: Pool,
  embedder: EmbeddingService,
): Promise<void> {
  const { rows } = await pool.query<{ dim: number | null }>(
    `SELECT
       (regexp_match(udt_name || COALESCE('(' || character_maximum_length || ')', ''), '\\(([0-9]+)\\)'))[1]::int AS dim
     FROM information_schema.columns
     WHERE table_name = 'embeddings' AND column_name = 'embedding'`,
  );
  // pgvector's column type appears as `vector` in udt_name with the dim
  // tucked into atttypmod (not exposed via information_schema). Pull
  // directly from pg_attribute as the authoritative path.
  const { rows: pgRows } = await pool.query<{ atttypmod: number }>(
    `SELECT a.atttypmod
       FROM pg_attribute a
       JOIN pg_class c ON a.attrelid = c.oid
      WHERE c.relname = 'embeddings' AND a.attname = 'embedding'`,
  );
  const typmod = pgRows[0]?.atttypmod ?? -1;
  // pgvector encodes the dimension as atttypmod directly (no offset like the
  // varchar(N) family that subtracts VARHDRSZ). For an unknown future encoding
  // we fall back to the regexp result if non-null.
  const declaredDim = typmod > 0 ? typmod : rows[0]?.dim ?? null;
  if (declaredDim === null) {
    throw new Error(
      'Could not determine embeddings.embedding column dimension; check that migration 6 ran and the pgvector extension is installed.',
    );
  }
  if (declaredDim !== embedder.dimensions) {
    throw new Error(
      `Embedding dimension mismatch: pgvector column is vector(${declaredDim}) but adapter reports ${embedder.dimensions} (model ${embedder.modelVersion()}). Either run a cross-dim migration (BRD-OPEN-QUESTIONS section 25) or revert the adapter config in .atelier/config.yaml.`,
    );
  }
}

// ===========================================================================
// Upsert
// ===========================================================================

interface ExistingRow {
  content_hash: string;
  embedding_model_version: string;
}

/**
 * Embed `input.contentText` and upsert into the embeddings table. Skips
 * the embed call entirely when the content hash + model version match the
 * existing row.
 *
 * Returns an UpsertOutcome describing what happened. Never throws on
 * adapter unavailability -- returns { action: 'failed', reason } so the
 * caller (embed-runner CLI) can summarize aggregates without unwinding
 * the entire batch.
 */
export async function upsertEmbedding(
  pool: Pool,
  embedder: EmbeddingService,
  input: UpsertEmbeddingInput,
): Promise<UpsertOutcome> {
  if (!input.contentText || input.contentText.trim().length === 0) {
    return { action: 'failed', reason: 'empty content', sourceKind: input.sourceKind, sourceRef: input.sourceRef };
  }
  const hash = contentHash(input.contentText);
  const expectedModel = embedder.modelVersion();

  const { rows: existingRows } = await pool.query<ExistingRow>(
    `SELECT content_hash, embedding_model_version
       FROM embeddings
      WHERE project_id = $1 AND source_kind = $2 AND source_ref = $3`,
    [input.projectId, input.sourceKind, input.sourceRef],
  );
  const existing = existingRows[0];
  if (existing && existing.content_hash === hash && existing.embedding_model_version === expectedModel) {
    return { action: 'skipped', reason: 'unchanged', sourceKind: input.sourceKind, sourceRef: input.sourceRef };
  }

  let embedding: number[];
  try {
    const result = await embedder.embed({ text: input.contentText });
    embedding = result.embedding;
  } catch (err) {
    const reason =
      err instanceof AdapterUnavailableError
        ? `adapter unavailable: ${err.message}`
        : `embed error: ${(err as Error).message ?? String(err)}`;
    return { action: 'failed', reason, sourceKind: input.sourceKind, sourceRef: input.sourceRef };
  }

  const vectorLiteral = embeddingToVectorLiteral(embedding);

  if (existing) {
    await pool.query(
      `UPDATE embeddings
          SET content_text = $4,
              content_hash = $5,
              embedding = $6::vector,
              embedding_model_version = $7,
              trace_ids = $8::text[]
        WHERE project_id = $1 AND source_kind = $2 AND source_ref = $3`,
      [
        input.projectId,
        input.sourceKind,
        input.sourceRef,
        input.contentText,
        hash,
        vectorLiteral,
        expectedModel,
        input.traceIds,
      ],
    );
    return { action: 'updated', sourceKind: input.sourceKind, sourceRef: input.sourceRef };
  }

  await pool.query(
    `INSERT INTO embeddings (
       project_id, source_kind, source_ref, content_text, content_hash,
       embedding, embedding_model_version, trace_ids
     )
     VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8::text[])`,
    [
      input.projectId,
      input.sourceKind,
      input.sourceRef,
      input.contentText,
      hash,
      vectorLiteral,
      expectedModel,
      input.traceIds,
    ],
  );
  return { action: 'inserted', sourceKind: input.sourceKind, sourceRef: input.sourceRef };
}

// ===========================================================================
// Remove
// ===========================================================================

/**
 * Remove an embeddings row when its source is deleted (research artifact
 * git rm, contribution rejected, BRD section removed). Idempotent --
 * removing a non-existent row succeeds with rowCount=0.
 *
 * Caller decides whether to use this or to mark for soft-delete (project
 * archival per ARCH 6.4.2). At v1 there is no soft-delete; archival is
 * the only soft path and is handled outside this module.
 */
export async function removeEmbedding(
  pool: Pool | PoolClient,
  projectId: string,
  sourceKind: EmbeddingSourceKind,
  sourceRef: string,
): Promise<{ removed: boolean }> {
  const result = await pool.query(
    `DELETE FROM embeddings
       WHERE project_id = $1 AND source_kind = $2 AND source_ref = $3`,
    [projectId, sourceKind, sourceRef],
  );
  return { removed: (result.rowCount ?? 0) > 0 };
}
