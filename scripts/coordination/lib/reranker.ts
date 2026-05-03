// RerankerService interface (C3 — ADR-047 cross-encoder reranker for find_similar).
//
// Per ADR-047 the find_similar blocking tier is a v1.x opt-in gated on
// a cross-encoder reranker. The reranker takes the top-K results from
// the v1 hybrid retrieval (vector + BM25 + RRF per ADR-042) and re-scores
// them with a query-document relevance model. The re-ranked list is then
// gated against the higher precision/recall thresholds.
//
// This file defines the vendor-neutral interface every implementation
// must satisfy. Concrete adapters live under `../adapters/` per the
// ADR-029 GCP-portability discipline -- this file does NOT import any
// provider SDK.
//
// Activation criteria per ADR-047:
//   - Adopter measures find_similar advisory tier on their corpus
//   - Both precision AND recall fall within 15pp of blocking thresholds
//     (P >= 0.70 AND R >= 0.55, where blocking is P >= 0.85 AND R >= 0.70)
//   - Reranker measurably lifts results (e.g., P + 0.10, R + 0.05)
//   - Added latency stays <200ms p95 against the corpus
//
// Below those criteria, advisory-tier (no reranker) is the right shape;
// the reranker doesn't help when the underlying retrieval is too weak.
//
// Reference adapter: scripts/coordination/adapters/cohere-compatible-rerank.ts
// (works with Cohere /v1/rerank, Voyage AI /v1/rerank, and self-hosted
// services that expose the same Cohere-compatible shape).

// ===========================================================================
// Public types
// ===========================================================================

export interface RerankRequest {
  /** The query string the user / system asked for. */
  query: string;
  /** Documents to be re-ranked. Order in the input does NOT determine output. */
  documents: RerankDocument[];
  /**
   * Optional ceiling on returned results. The adapter MAY return fewer
   * (e.g., when the underlying model has its own per-call budget).
   * Default: same as documents.length (return all, re-ranked).
   */
  topK?: number;
}

export interface RerankDocument {
  /** Stable identifier the caller uses to correlate results back. */
  id: string;
  /** Document text the model scores against the query. */
  text: string;
  /**
   * Optional score from the prior retrieval step (RRF score from ADR-042).
   * The reranker MAY use this for hybrid scoring (e.g.,
   * `0.7 * rerank_score + 0.3 * prior_score`); v1 implementations that
   * don't use it can ignore.
   */
  priorScore?: number;
}

export interface RerankResult {
  /** Echo of the input document's id. */
  id: string;
  /**
   * Reranker-assigned relevance score; conventionally 0..1 where 1 = most
   * relevant. Different providers normalize differently; consumers should
   * treat this as ORDINAL (sort by it) not as an absolute calibrated value
   * (don't compare across queries without per-query normalization).
   */
  score: number;
  /** Original priorScore (echoed back), so callers can compute hybrid scores. */
  priorScore?: number;
}

export interface RerankerService {
  /** Adapter identifier for logging / config matching ("cohere", "voyage", etc.). */
  readonly name: string;

  /**
   * Re-rank the supplied documents against the query.
   *
   * Output is ORDERED: results[0] is the most relevant. When `topK` is
   * supplied, results[].length <= topK.
   *
   * Throws on transport / API errors. Callers decide whether to fall back
   * to the prior ranking (recommended for advisory tier) or fail (more
   * appropriate for blocking tier where the reranker is part of the gate).
   */
  rerank(req: RerankRequest): Promise<RerankResult[]>;

  /** Releases connection-pool / file-handle resources. */
  close(): Promise<void>;
}

// ===========================================================================
// Configuration shape (mirrors find_similar.embeddings per ADR-041 pattern)
// ===========================================================================

export interface RerankerConfig {
  /**
   * Whether to invoke the reranker post-retrieval. Default false at v1; opt-in.
   * When false, no reranker dependency is required at runtime.
   */
  enabled: boolean;

  /**
   * Adapter selection. v1 supports `cohere-compatible` (Cohere/Voyage/self-
   * hosted with Cohere shape). New adapters add new values + sibling files
   * under `../adapters/`.
   */
  adapter: 'cohere-compatible';

  /**
   * Provider base URL (no trailing slash; no `/rerank` suffix). Examples:
   *   "https://api.cohere.ai/v1"           -- Cohere
   *   "https://api.voyageai.com/v1"        -- Voyage AI
   *   "http://localhost:8000/v1"           -- self-hosted with OpenAI-shape proxy
   */
  baseUrl: string;

  /** Model identifier per provider's docs (e.g., "rerank-english-v3.0"). */
  modelName: string;

  /** Env var name holding the bearer token. */
  apiKeyEnv: string;

  /**
   * Per-call timeout (ms). Default 5s; reranker should be fast or the
   * find_similar p95 budget breaks.
   */
  timeoutMs?: number;

  /**
   * Top-K to keep after reranking. Default unbounded (return everything
   * the input had, re-ranked). Setting this < input length lets callers
   * trim the tail to the most relevant N.
   */
  topK?: number;
}

export const DEFAULT_RERANKER_CONFIG: RerankerConfig = {
  enabled: false,
  adapter: 'cohere-compatible',
  baseUrl: 'https://api.cohere.ai/v1',
  modelName: 'rerank-english-v3.0',
  apiKeyEnv: 'COHERE_API_KEY',
  timeoutMs: 5_000,
};

/**
 * Sentinel error thrown when the configured adapter cannot reach its
 * provider (missing key, network, etc.). Callers in the find_similar
 * advisory tier should catch and fall back to the un-reranked order;
 * callers in blocking tier should treat as failure.
 *
 * Mirrors `AdapterUnavailableError` from `embeddings.ts` for consistency
 * with the find_similar embedding adapter.
 */
export class RerankerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RerankerUnavailableError';
  }
}
