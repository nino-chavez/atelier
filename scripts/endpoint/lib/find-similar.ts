// find_similar implementation (ARCH 6.4 / 6.4.1 / 6.4.3 + ADR-006 + ADR-041).
//
// The handler in handlers.ts is a thin shim around this module. Logic lives
// here so the eval harness can call findSimilar() directly against the
// same code path the endpoint uses, without re-implementing the kNN +
// banding + fallback flow in the harness.
//
// Flow per ARCH 6.4:
//   1. Validate description (non-empty, ≤ 8000 chars per ARCH 6.4.2).
//   2. Generate embedding via the configured EmbeddingService (ADR-041).
//      On adapter failure, fall through to keyword fallback per US-6.5.
//   3. kNN against pgvector with project_id RLS scoping. Optional trace_id
//      scope per ARCH 6.4.3 expands to {trace_id, epic_siblings} via array
//      overlap on the denormalized trace_ids column.
//   4. Partition results into primary_matches (score ≥ default_threshold)
//      and weak_suggestions (weak_threshold ≤ score < default_threshold)
//      per ARCH 6.4.1; cap each band at top_k_per_band.
//   5. Return the wire shape from ARCH 6.4.1.
//
// Score semantics: pgvector cosine distance is in [0, 2] where 0 is
// identical. We convert to similarity = 1 - distance, mapping into [-1, 1]
// (or [0, 1] for normalized embeddings). The threshold values in
// .atelier/config.yaml are similarity-shaped (0.80 / 0.65), matching how
// ADR-006 and the documentation phrase the gate. The conversion happens in
// SQL so the threshold parameter binds to the SQL expression directly.

import type { Pool } from 'pg';

import { AtelierError } from '../../sync/lib/write.ts';
import {
  AdapterUnavailableError,
  type EmbeddingService,
} from '../../coordination/lib/embeddings.ts';

// ===========================================================================
// Configuration
// ===========================================================================

export interface FindSimilarConfig {
  /** ARCH 6.4.1: default similarity threshold. */
  defaultThreshold: number;
  /** ARCH 6.4.1: weak-band lower bound. */
  weakSuggestionThreshold: number;
  /** ARCH 6.4.1: per-band cap; default 5. */
  topKPerBand: number;
  /**
   * Retrieval strategy (ADR-042). 'vector' is the original M5-entry default;
   * 'hybrid' fuses vector kNN + BM25 keyword search via Reciprocal Rank
   * Fusion (RRF). Calibrated thresholds differ between the two strategies
   * because hybrid scores are RRF rank-fusion values, not cosine similarities.
   */
  strategy: 'vector' | 'hybrid';
  /**
   * RRF fusion constant k (Cormack et al. 2009). 60 is the canonical value;
   * larger k softens the reciprocal-rank curve. Only consulted when strategy='hybrid'.
   */
  rrfK: number;
}

export const DEFAULT_FIND_SIMILAR_CONFIG: FindSimilarConfig = {
  // Calibrated against atelier/eval/find_similar/seeds.yaml + M5-AUDIT.md
  // per ADR-042. RRF-scale thresholds; not directly comparable to the
  // original ADR-006 cosine values (0.80/0.65). See .atelier/config.yaml
  // for the canonical values + commentary.
  defaultThreshold: 0.032,
  weakSuggestionThreshold: 0.030,
  topKPerBand: 5,
  strategy: 'hybrid',
  rrfK: 60,
};

// ===========================================================================
// Wire shape (ARCH 6.4.1)
// ===========================================================================

export type FindSimilarSourceKind =
  | 'decision'
  | 'contribution'
  | 'brd_section'
  | 'prd_section'
  | 'research_artifact';

export interface FindSimilarMatch {
  source_kind: FindSimilarSourceKind;
  source_ref: string;
  score: number;
  trace_ids: string[];
  /** First 240 chars of content_text for inline rendering; full text via source_ref. */
  excerpt: string;
}

export interface FindSimilarResponse {
  primary_matches: FindSimilarMatch[];
  weak_suggestions: FindSimilarMatch[];
  /** ARCH 6.4: true when the keyword fallback served the response. */
  degraded: boolean;
  thresholds_used: { default: number; weak: number };
}

export interface FindSimilarRequest {
  /** Free-form text per ARCH 6.4.2. */
  description: string;
  /** Optional trace scope per ARCH 6.4.3. */
  trace_id?: string;
}

// ===========================================================================
// Constants from ARCH 6.4.2
// ===========================================================================

/** Hard cap on description length per ARCH 6.4.2 description-input format. */
export const MAX_DESCRIPTION_CHARS = 8000;

const EXCERPT_CHAR_CAP = 240;

// ===========================================================================
// Trace-scope expansion (ARCH 6.4.3)
// ===========================================================================

/**
 * Expand a single trace_id into the trace scope per ARCH 6.4.3.
 *
 * Semantics:
 *   - `US-1.3`         expands to ['US-1.3', 'BRD:Epic-1']
 *   - `BRD:Epic-1`     expands to ['BRD:Epic-1'] (no further parent)
 *   - `ADR-041`        expands to ['ADR-041']
 *   - `D24`            expands to ['D24']
 *   - `NF-3`           expands to ['NF-3']
 *
 * Anything else stays as-is. The returned array is then matched against
 * the embeddings.trace_ids column via && (array overlap). Epic siblings
 * (other US-1.X stories) ride in via the BRD:Epic-1 entry being denormalized
 * onto contribution rows that explicitly carry it.
 *
 * Per the ARCH 6.4.3 note: trace IDs are flat (US-X.Y), not a tree, so
 * "subtree" was a stale framing -- this is the explicit overlap definition.
 */
export function expandTraceScope(traceId: string): string[] {
  const trimmed = traceId.trim();
  if (trimmed.length === 0) return [];
  const usMatch = trimmed.match(/^US-(\d+)\.\d+$/);
  if (usMatch) return [trimmed, `BRD:Epic-${usMatch[1]}`];
  return [trimmed];
}

// ===========================================================================
// Main entry point
// ===========================================================================

export interface FindSimilarDeps {
  pool: Pool;
  embedder: EmbeddingService;
  config: FindSimilarConfig;
}

/**
 * Find similar corpus items for a free-form description, scoped to the
 * given project + optional trace scope.
 *
 * Throws AtelierError with BAD_REQUEST on input validation failures.
 * Never throws on adapter unavailability -- falls back to keyword search
 * with degraded=true per US-6.5.
 *
 * Returns the wire shape from ARCH 6.4.1.
 */
export async function findSimilar(
  projectId: string,
  request: FindSimilarRequest,
  deps: FindSimilarDeps,
): Promise<FindSimilarResponse> {
  const description = request.description;
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw new AtelierError('BAD_REQUEST', 'description must be a non-empty string');
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    throw new AtelierError(
      'BAD_REQUEST',
      `description exceeds ARCH 6.4.2 cap of ${MAX_DESCRIPTION_CHARS} characters`,
      { length: description.length, cap: MAX_DESCRIPTION_CHARS },
    );
  }

  const traceScope = request.trace_id ? expandTraceScope(request.trace_id) : null;

  // Try the vector path first; fall through to keyword on adapter failure
  // (per US-6.5 the fallback is required, not optional).
  let embedding: number[] | null = null;
  try {
    const result = await deps.embedder.embed({ text: description });
    embedding = result.embedding;
  } catch (err) {
    if (err instanceof AdapterUnavailableError) {
      // eslint-disable-next-line no-console
      console.warn(`[find_similar] embedder unavailable; falling back to keyword: ${err.message}`);
    } else {
      // Unknown error: still degrade rather than 500. The handler-level
      // contract is "find_similar always returns a response shape; degraded
      // signals the difference."
      // eslint-disable-next-line no-console
      console.error(`[find_similar] unexpected embedder error; falling back to keyword:`, err);
    }
  }

  if (embedding === null) {
    return runKeywordFallback(projectId, description, traceScope, deps);
  }

  if (deps.config.strategy === 'hybrid') {
    return runHybridSearch(projectId, description, embedding, traceScope, deps);
  }
  return runVectorSearch(projectId, embedding, traceScope, deps);
}

// ===========================================================================
// Vector path
// ===========================================================================

interface VectorMatchRow {
  source_kind: FindSimilarSourceKind;
  source_ref: string;
  trace_ids: string[];
  content_text: string;
  similarity: string; // numeric -- pg returns as string
}

async function runVectorSearch(
  projectId: string,
  embedding: number[],
  traceScope: string[] | null,
  deps: FindSimilarDeps,
): Promise<FindSimilarResponse> {
  const cfg = deps.config;
  const limit = cfg.topKPerBand * 2; // pull primary + weak in one pass; partition in JS

  // pgvector accepts vectors as a `[a,b,c]`-formatted text literal cast
  // to vector. Bind as text + cast to keep query plans cacheable across
  // calls (parameter shape stays stable; the dimension is encoded in the
  // schema, not the parameter type).
  const embeddingText = embeddingToVectorLiteral(embedding);

  // Cosine distance via <=> operator. similarity = 1 - distance.
  // Filter at SQL level by similarity ≥ weak threshold so the top-N has
  // enough candidates to populate both bands; banding happens in JS.
  const traceFilter = traceScope ? 'AND trace_ids && $4::text[]' : '';

  const sql = `
    SELECT
      source_kind,
      source_ref,
      trace_ids,
      content_text,
      (1 - (embedding <=> $1::vector))::float8 AS similarity
    FROM embeddings
    WHERE project_id = $2
      ${traceFilter}
      AND (1 - (embedding <=> $1::vector)) >= $3
    ORDER BY embedding <=> $1::vector ASC
    LIMIT ${limit}
  `;

  const params: unknown[] = [embeddingText, projectId, cfg.weakSuggestionThreshold];
  if (traceScope) params.push(traceScope);

  let rows: VectorMatchRow[];
  try {
    const result = await deps.pool.query<VectorMatchRow>(sql, params);
    rows = result.rows;
  } catch (err) {
    // Index unavailable / pgvector extension missing / DB down -- all map
    // to "vector path failed; serve keyword." Surface a degraded response
    // rather than a 500.
    // eslint-disable-next-line no-console
    console.error('[find_similar] vector query failed; falling back to keyword:', err);
    return runKeywordFallback(
      projectId,
      // We do not have the original description here (it was already
      // embedded). Synthesize a fallback query from the trace scope; if no
      // scope is set, return an empty degraded response. The keyword
      // fallback only fires when the vector path unexpectedly fails AFTER
      // embed succeeded -- a rare path -- and an empty result is the
      // safest behavior.
      traceScope ? traceScope.join(' ') : '',
      traceScope,
      deps,
    );
  }

  return partitionRowsToResponse(rows, cfg, /* degraded */ false);
}

function partitionRowsToResponse(
  rows: VectorMatchRow[],
  cfg: FindSimilarConfig,
  degraded: boolean,
): FindSimilarResponse {
  const primary: FindSimilarMatch[] = [];
  const weak: FindSimilarMatch[] = [];

  for (const row of rows) {
    const score = parseFloat(row.similarity);
    const match: FindSimilarMatch = {
      source_kind: row.source_kind,
      source_ref: row.source_ref,
      score: Number.isFinite(score) ? Math.round(score * 1e6) / 1e6 : 0,
      trace_ids: row.trace_ids,
      excerpt: truncateExcerpt(row.content_text),
    };
    if (score >= cfg.defaultThreshold) {
      if (primary.length < cfg.topKPerBand) primary.push(match);
    } else if (score >= cfg.weakSuggestionThreshold) {
      if (weak.length < cfg.topKPerBand) weak.push(match);
    }
  }

  return {
    primary_matches: primary,
    weak_suggestions: weak,
    degraded,
    thresholds_used: { default: cfg.defaultThreshold, weak: cfg.weakSuggestionThreshold },
  };
}

function truncateExcerpt(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= EXCERPT_CHAR_CAP) return trimmed;
  return `${trimmed.slice(0, EXCERPT_CHAR_CAP).trimEnd()}...`;
}

/**
 * Format a number[] embedding as the pgvector text literal `[a,b,c]`.
 * Exported for the embed pipeline + smoke tests.
 */
export function embeddingToVectorLiteral(embedding: number[]): string {
  return `[${embedding.map(stringifyFiniteNumber).join(',')}]`;
}

function stringifyFiniteNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`embedding contains non-finite value: ${n}`);
  }
  return n.toString();
}

// ===========================================================================
// FTS query construction
// ===========================================================================
//
// plainto_tsquery and websearch_to_tsquery both AND query terms, which
// returns zero rows for natural-language descriptions of three or more
// content words. The hybrid path needs OR semantics so BM25 can find
// "documents containing ANY of these keywords" -- which is the standard
// IR / BM25 behavior. We tokenize, sanitize to alphanumeric, drop short
// tokens, and join with `|`.
//
// Sanitization is the load-bearing safety: to_tsquery raises syntax errors
// on special characters, so we strip everything that isn't [A-Za-z0-9].
// Empty input after filtering returns null; callers fall back to "no FTS
// candidates" rather than executing an invalid query.

const FTS_MIN_TOKEN_LEN = 3;

/**
 * Build an OR-joined to_tsquery argument from free-form text. Returns null
 * when no usable token survives sanitization (e.g., query is "?" or
 * "test 1"); callers omit the FTS step in that case.
 */
export function buildOrTsQuery(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length >= FTS_MIN_TOKEN_LEN);
  if (tokens.length === 0) return null;
  // De-dup so to_tsquery doesn't choke on repeated alternatives
  // (e.g. "find_similar find_similar"); set preserves insertion order.
  const unique = Array.from(new Set(tokens));
  return unique.join(' | ');
}

// ===========================================================================
// Hybrid retrieval: vector kNN + BM25 fused via Reciprocal Rank Fusion (RRF)
// (ADR-042 + ADR-041 reverse condition + ARCH 6.4.1 default-threshold tuning)
// ===========================================================================
//
// RRF (Cormack, Clarke, Buettcher 2009) is the canonical hybrid-retrieval
// fusion approach: each ranker contributes 1 / (k + rank) per result, summed
// across rankers. Items ranked highly by EITHER vector or BM25 surface; items
// ranked highly by BOTH dominate. The k constant (60 by convention) tempers
// rank-1's contribution; without it, rank-1 in either ranker would always
// outweigh consensus rankings.
//
// Why not late fusion of similarity + BM25 scores directly: cosine similarity
// (0..1) and ts_rank_cd output (unbounded) are not directly comparable. RRF
// dodges the calibration question entirely by working only on RANK position,
// which is dimensionless. ADR-042 records this rationale.
//
// Why not query-time decision (vector-when-confident, BM25-when-not): adds
// substantial complexity for minimal gain at this corpus size. RRF as the
// default keeps the path uniform; the eval gate measures whether it works.
//
// The candidate pool is (vector top-N) UNION (BM25 top-N). The fused score
// is RRF-shaped; thresholds in DEFAULT_FIND_SIMILAR_CONFIG are calibrated for
// RRF score scale (which differs from cosine scale -- see ADR-042).

interface HybridCandidate {
  source_kind: FindSimilarSourceKind;
  source_ref: string;
  trace_ids: string[];
  content_text: string;
  /** Final RRF-fused score (sum of reciprocal ranks across rankers). */
  fused: number;
}

const HYBRID_CANDIDATE_POOL = 30;

async function runHybridSearch(
  projectId: string,
  description: string,
  embedding: number[],
  traceScope: string[] | null,
  deps: FindSimilarDeps,
): Promise<FindSimilarResponse> {
  const cfg = deps.config;
  const embeddingText = embeddingToVectorLiteral(embedding);
  const traceFilter = traceScope ? 'AND trace_ids && $3::text[]' : '';

  // Vector kNN: top HYBRID_CANDIDATE_POOL by cosine. No threshold filter
  // here -- RRF cares about rank position, not absolute score, so cutting
  // off below a similarity floor would silently drop items that BM25
  // legitimately likes.
  const vectorSql = `
    SELECT source_kind, source_ref, trace_ids, content_text,
           (1 - (embedding <=> $1::vector))::float8 AS similarity
      FROM embeddings
     WHERE project_id = $2
       ${traceFilter}
     ORDER BY embedding <=> $1::vector ASC
     LIMIT ${HYBRID_CANDIDATE_POOL}
  `;
  const vectorParams: unknown[] = [embeddingText, projectId];
  if (traceScope) vectorParams.push(traceScope);

  // BM25 path: tokenize + OR-join into to_tsquery. plainto_tsquery /
  // websearch_to_tsquery have AND semantics that return zero rows for
  // natural-language queries against this corpus density (verified
  // empirically during M5 calibration). OR semantics + ts_rank_cd give
  // standard BM25-like behavior: rank by density of matching keywords.
  const orTsQuery = buildOrTsQuery(description);
  let ftsRows: KeywordMatchRow[] = [];
  let vectorRows: VectorMatchRow[];
  try {
    const vectorPromise = deps.pool.query<VectorMatchRow>(vectorSql, vectorParams);
    let ftsPromise: Promise<{ rows: KeywordMatchRow[] }> = Promise.resolve({ rows: [] });
    if (orTsQuery !== null) {
      const ftsTraceFilter = traceScope ? 'AND trace_ids && $3::text[]' : '';
      const ftsSql = `
        SELECT source_kind, source_ref, trace_ids, content_text,
               ts_rank_cd(to_tsvector('english', content_text),
                          to_tsquery('english', $1))::float8 AS rank
          FROM embeddings
         WHERE project_id = $2
           ${ftsTraceFilter}
           AND to_tsvector('english', content_text) @@ to_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT ${HYBRID_CANDIDATE_POOL}
      `;
      const ftsParams: unknown[] = [orTsQuery, projectId];
      if (traceScope) ftsParams.push(traceScope);
      ftsPromise = deps.pool.query<KeywordMatchRow>(ftsSql, ftsParams);
    }
    const [v, f] = await Promise.all([vectorPromise, ftsPromise]);
    vectorRows = v.rows;
    ftsRows = f.rows;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[find_similar] hybrid query failed; falling back to keyword-only:', err);
    return runKeywordFallback(projectId, description, traceScope, deps);
  }

  // RRF fusion. rank starts at 1 (not 0) so the formula 1/(k+rank) is
  // well-defined for rank=1 and the 1st-place reward is bounded.
  const k = cfg.rrfK;
  const fused = new Map<string, HybridCandidate>();

  vectorRows.forEach((row, idx) => {
    const rrfContribution = 1 / (k + (idx + 1));
    const existing = fused.get(row.source_ref);
    if (existing) {
      existing.fused += rrfContribution;
    } else {
      fused.set(row.source_ref, {
        source_kind: row.source_kind,
        source_ref: row.source_ref,
        trace_ids: row.trace_ids,
        content_text: row.content_text,
        fused: rrfContribution,
      });
    }
  });
  ftsRows.forEach((row, idx) => {
    const rrfContribution = 1 / (k + (idx + 1));
    const existing = fused.get(row.source_ref);
    if (existing) {
      existing.fused += rrfContribution;
    } else {
      fused.set(row.source_ref, {
        source_kind: row.source_kind,
        source_ref: row.source_ref,
        trace_ids: row.trace_ids,
        content_text: row.content_text,
        fused: rrfContribution,
      });
    }
  });

  const ordered = Array.from(fused.values()).sort((a, b) => b.fused - a.fused);

  // Convert HybridCandidate -> VectorMatchRow shape for partitionRowsToResponse.
  // The "similarity" field is the fused score; thresholds in cfg are calibrated
  // against this scale per ADR-042.
  const synthesized: VectorMatchRow[] = ordered.map((c) => ({
    source_kind: c.source_kind,
    source_ref: c.source_ref,
    trace_ids: c.trace_ids,
    content_text: c.content_text,
    similarity: c.fused.toString(),
  }));

  return partitionRowsToResponse(synthesized, cfg, /* degraded */ false);
}

// ===========================================================================
// Keyword fallback (ARCH 6.4 + US-6.5)
// ===========================================================================
//
// BM25-shaped via Postgres full-text search:
//   - to_tsvector('english', content_text) is indexed (migration 6).
//   - plainto_tsquery('english', $description) builds the query.
//   - ts_rank_cd produces a relevance score; we normalize into [0, 1] by
//     clamping at a configured ceiling (ts_rank_cd is unbounded but
//     practical values rarely exceed 1.0 for the corpus sizes Atelier
//     produces). The normalized score is used purely for ordering --
//     callers see degraded=true so they know not to compare it against the
//     vector-path threshold values directly.
//
// Why we still partition into bands: the wire shape is constant whether
// vector or keyword served the response. UI can still render
// primary_matches prominently; the degraded banner cues the user that
// scores are not vector-similarity-shaped.

interface KeywordMatchRow {
  source_kind: FindSimilarSourceKind;
  source_ref: string;
  trace_ids: string[];
  content_text: string;
  rank: string; // numeric
}

async function runKeywordFallback(
  projectId: string,
  description: string,
  traceScope: string[] | null,
  deps: FindSimilarDeps,
): Promise<FindSimilarResponse> {
  const cfg = deps.config;
  const limit = cfg.topKPerBand * 2;

  // Empty description after fall-through: nothing to search; return
  // empty degraded response.
  if (description.trim().length === 0) {
    return {
      primary_matches: [],
      weak_suggestions: [],
      degraded: true,
      thresholds_used: { default: cfg.defaultThreshold, weak: cfg.weakSuggestionThreshold },
    };
  }

  const orTsQuery = buildOrTsQuery(description);
  if (orTsQuery === null) {
    return {
      primary_matches: [],
      weak_suggestions: [],
      degraded: true,
      thresholds_used: { default: cfg.defaultThreshold, weak: cfg.weakSuggestionThreshold },
    };
  }

  const traceFilter = traceScope ? 'AND trace_ids && $3::text[]' : '';
  const sql = `
    SELECT
      source_kind,
      source_ref,
      trace_ids,
      content_text,
      ts_rank_cd(
        to_tsvector('english', content_text),
        to_tsquery('english', $1)
      )::float8 AS rank
    FROM embeddings
    WHERE project_id = $2
      ${traceFilter}
      AND to_tsvector('english', content_text) @@ to_tsquery('english', $1)
    ORDER BY rank DESC
    LIMIT ${limit}
  `;

  const params: unknown[] = [orTsQuery, projectId];
  if (traceScope) params.push(traceScope);

  let rows: KeywordMatchRow[];
  try {
    const result = await deps.pool.query<KeywordMatchRow>(sql, params);
    rows = result.rows;
  } catch (err) {
    // FTS query failed: most likely no embeddings rows yet. Return empty
    // degraded -- UI banner already communicates the gap.
    // eslint-disable-next-line no-console
    console.error('[find_similar] keyword fallback failed:', err);
    return {
      primary_matches: [],
      weak_suggestions: [],
      degraded: true,
      thresholds_used: { default: cfg.defaultThreshold, weak: cfg.weakSuggestionThreshold },
    };
  }

  // Map keyword ranks to band assignment via a normalization. Documentation
  // is explicit: degraded=true tells callers the scores are not directly
  // comparable to vector-path thresholds. Band assignment here is purely
  // about UI prominence ordering; the top half of the result set is
  // "primary" and the rest is "weak".
  const synthesized: VectorMatchRow[] = rows.map((row, idx) => ({
    source_kind: row.source_kind,
    source_ref: row.source_ref,
    trace_ids: row.trace_ids,
    content_text: row.content_text,
    similarity: idx < cfg.topKPerBand
      ? cfg.defaultThreshold.toString()
      : cfg.weakSuggestionThreshold.toString(),
  }));

  return partitionRowsToResponse(synthesized, cfg, /* degraded */ true);
}
