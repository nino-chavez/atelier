// EmbeddingService interface (ARCH 6.4 / ADR-029 / ADR-041).
//
// Mirrors the BroadcastService pattern from broadcast.ts: vendor-neutral
// interface + Noop fallback in this file; concrete adapters under
// `../adapters/` per ADR-029. This module does NOT import any provider
// SDK and does NOT issue HTTP requests.
//
// Architecture per ARCH 6.4 + 6.4.2 + ADR-041:
//   - One named adapter at v1: OpenAI-compatible (covers OpenAI itself
//     plus vLLM, Ollama, LM Studio, LocalAI, Voyage's compat endpoint).
//   - The interface is intentionally minimal -- a single embed(text) call
//     returning number[]. Batching, retries, and rate limiting are adapter
//     concerns; the embed pipeline (ARCH 6.4.2) calls this from worker
//     code that can sequence work across many sources.
//   - embedding_model_version is a flat string "<provider>/<model>@<dim>"
//     written into every embeddings row at insert time per ARCH 6.4.2's
//     swappability mechanic. modelVersion() lets callers stamp it without
//     duplicating the format.
//
// Failure mode (per ADR-041 + US-6.5): when the configured adapter cannot
// reach its provider, the embed pipeline marks the row as un-embedded and
// the find_similar handler degrades to keyword fallback with degraded=true.
// The interface itself does not encode "degraded" state -- that is a
// caller decision based on whether embed() throws.

// ===========================================================================
// Service contract
// ===========================================================================

export interface EmbedInput {
  /**
   * The text to embed. Single-call shape per ARCH 6.4.2 description-input
   * format: free-form, markdown allowed but not interpreted, hard cap 8000
   * chars enforced by the find_similar handler before reaching this layer.
   * Adapters do not re-validate length -- that is a handler concern.
   */
  text: string;
}

export interface EmbedResult {
  /** 1536-dim at v1 per ADR-041; adapters return whatever their model produces. */
  embedding: number[];
  /**
   * Stable model identifier in `<provider>/<model>@<dim>` form, e.g.
   * `openai/text-embedding-3-small@1536`. Written verbatim into
   * embeddings.embedding_model_version per ARCH 6.4.2.
   */
  modelVersion: string;
}

/**
 * EmbeddingService -- the vendor-neutral embedding contract every adapter
 * must implement. Reference impl is the OpenAI-compatible adapter under
 * `../adapters/openai-compatible-embeddings.ts` per ADR-041.
 *
 * Required behavior:
 *   - embed(text): generate an embedding for `text`. May throw on
 *     unrecoverable adapter failures (missing API key, invalid model name,
 *     network error). Callers (the embed pipeline) catch + handle these.
 *   - dimensions: returns the dimension count this adapter produces. Used
 *     by the embed pipeline to assert the configured pgvector column
 *     dimension matches before inserting -- mismatch is a deploy-time
 *     misconfiguration that should fail closed rather than silently
 *     produce queries that always return zero matches.
 *   - modelVersion(): formatted "<provider>/<model>@<dim>" string. Stable
 *     across calls; only changes when the adapter is reconstructed with
 *     different config (i.e., when an adopter swaps providers).
 *   - close(): optional cleanup hook for adapters that hold pooled
 *     connections. The OpenAI-compatible adapter holds none and returns
 *     immediately; future adapters that wrap a local model worker may use it.
 */
export interface EmbeddingService {
  embed(input: EmbedInput): Promise<EmbedResult>;
  /** Dim count this adapter produces. v1 default is 1536 per ADR-041. */
  readonly dimensions: number;
  /** "<provider>/<model>@<dim>"; written into embeddings.embedding_model_version. */
  modelVersion(): string;
  close?(): Promise<void>;
}

// ===========================================================================
// Model-version helper
// ===========================================================================

/**
 * Format the canonical model-version string used in
 * embeddings.embedding_model_version. Adapters call this with their own
 * provider tag so the format stays in one place.
 *
 * Why this format: the swap procedure in ARCH 6.4.2 uses
 * embedding_model_version to scope rebuilds -- "all rows whose version is
 * not the current default get re-embedded." Including dim explicitly makes
 * cross-dimension swaps (BRD-OPEN-QUESTIONS section 25) detectable without
 * a separate column.
 */
export function formatModelVersion(provider: string, model: string, dimensions: number): string {
  if (!provider || provider.includes('/') || provider.includes('@')) {
    throw new Error(`formatModelVersion: provider must be non-empty and not contain "/" or "@": ${provider}`);
  }
  if (!model || model.includes('@')) {
    throw new Error(`formatModelVersion: model must be non-empty and not contain "@": ${model}`);
  }
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`formatModelVersion: dimensions must be positive integer: ${dimensions}`);
  }
  return `${provider}/${model}@${dimensions}`;
}

// ===========================================================================
// No-op service (degraded / disabled / dev-without-key fallback)
// ===========================================================================

/**
 * No-op EmbeddingService. Used when:
 *   - The find_similar substrate is intentionally disabled (single-process
 *     tooling that never queries semantic search).
 *   - The configured provider has no API key set (dev-without-cost path;
 *     the embed pipeline records the failure and the handler degrades).
 *   - Smoke tests that exercise the surface shape without a live provider.
 *
 * embed() throws AdapterUnavailableError; dimensions / modelVersion return
 * the configured-but-unreachable values so the surface stays consistent
 * with the "real" adapter and the find_similar handler's degraded path
 * receives a coherent response.
 */
export class AdapterUnavailableError extends Error {
  override readonly name = 'AdapterUnavailableError';
  constructor(message: string) {
    super(message);
  }
}

export class NoopEmbeddingService implements EmbeddingService {
  readonly dimensions: number;
  private readonly _modelVersion: string;

  constructor(opts: { dimensions: number; modelVersion: string }) {
    this.dimensions = opts.dimensions;
    this._modelVersion = opts.modelVersion;
  }

  async embed(_input: EmbedInput): Promise<EmbedResult> {
    throw new AdapterUnavailableError(
      'NoopEmbeddingService.embed() called; configure a real EmbeddingService (see ADR-041 / .atelier/config.yaml find_similar.embeddings).',
    );
  }

  modelVersion(): string {
    return this._modelVersion;
  }

  async close(): Promise<void> {
    // Intentionally empty.
  }
}
