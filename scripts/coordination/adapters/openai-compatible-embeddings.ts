// OpenAI-compatible embeddings adapter for the EmbeddingService interface
// (ADR-029 + ADR-041).
//
// Per ADR-029 the reference impl preserves GCP-portability and provider-
// specific code stays in NAMED ADAPTER MODULES. This file is the only place
// in the find_similar substrate that issues HTTP against an embedding
// provider. Swapping to a different provider (Voyage native, Cohere) means
// writing a sibling adapter, not editing embeddings.ts.
//
// Per ADR-041 a single OpenAI-compatible adapter covers the realistic v1
// surface: OpenAI itself, Voyage (compat endpoint), vLLM, Ollama,
// LM Studio, LocalAI -- they all speak the same `/v1/embeddings` shape.
// Adopters who need a non-compat provider write a new adapter file; this
// one stays untouched.
//
// Implementation notes:
//   - Uses the platform fetch (Node 20+ ships it natively per package.json
//     engines) rather than pulling in the `openai` SDK. The wire shape is
//     three fields (input, model, encoding_format=optional) and OpenAI's
//     SDK adds layers (retries, exponential backoff, telemetry) that this
//     adapter does not need at v1 -- the embed pipeline (ARCH 6.4.2) sits
//     above us and owns retry/queueing semantics.
//   - Fail-closed on missing API key. ADR-041 commits to "set OPENAI_API_KEY
//     in the deploy env" as the v1 setup floor; a NoopEmbeddingService is
//     the right substitute for unset-key, not a silent zero-vector or
//     empty-array return that would corrupt the index.
//   - No request batching at v1. The ARCH 6.4.2 embed cadence is per-source
//     async work; per-call overhead is fine. Batching would be a perf
//     optimization at M7 hardening, behind a measurable trigger.

import {
  AdapterUnavailableError,
  formatModelVersion,
  type EmbedInput,
  type EmbedResult,
  type EmbeddingService,
} from '../lib/embeddings.ts';

// ===========================================================================
// Configuration
// ===========================================================================

export interface OpenAICompatibleEmbeddingsOptions {
  /**
   * Base URL for the provider's `/v1/embeddings` endpoint, WITHOUT the
   * `/embeddings` suffix. Per .atelier/config.yaml:
   *   "https://api.openai.com/v1"  (default)
   *   "http://localhost:11434/v1"  (Ollama)
   *   "http://localhost:1234/v1"   (LM Studio)
   *   "https://api.voyageai.com/v1" (Voyage compat endpoint)
   */
  baseUrl: string;
  /**
   * Bearer token for the provider. For self-hosted providers (Ollama,
   * vLLM, LocalAI) this can be a placeholder like "ollama"; the wire
   * format requires the header even when the server ignores it.
   */
  apiKey: string;
  /** e.g. "text-embedding-3-small" (OpenAI), "nomic-embed-text" (Ollama). */
  modelName: string;
  /**
   * Vector dimension this adapter produces. Used to stamp
   * embedding_model_version + asserted by the embed pipeline against the
   * pgvector column dim before insert.
   */
  dimensions: number;
  /**
   * Provider tag for embedding_model_version. e.g. "openai", "voyage",
   * "ollama". Adopters configure this alongside base_url so cross-provider
   * model name collisions (two providers calling their model
   * "text-embedding-3") stay distinguishable in the index.
   */
  provider: string;
  /**
   * Optional fetch override; defaults to globalThis.fetch. Smoke tests
   * inject a stub here. Adapters that wrap their own HTTP layer at v1.x
   * (e.g., one that adds a circuit breaker) compose via this hook rather
   * than monkey-patching global fetch.
   */
  fetchImpl?: typeof globalThis.fetch;
  /**
   * Optional request timeout in ms. Default 30000. The embed pipeline
   * already wraps embed() in a worker that handles timeout/retry, but a
   * per-call ceiling prevents hung requests from holding worker slots.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Resolve adapter config from .atelier/config.yaml + process.env. Throws
 * AdapterUnavailableError on missing API key (the configured-but-unreachable
 * case the find_similar handler degrades around) and Error on outright
 * misconfiguration (e.g. impossible dimensions).
 *
 * Pattern-parity with supabaseRealtimeOptionsFromEnv from the M4 broadcast
 * adapter: throw at construction, fail closed, never silently produce a
 * misconfigured client.
 */
export function openAICompatibleOptionsFromConfig(config: {
  baseUrl: string;
  modelName: string;
  dimensions: number;
  apiKeyEnv: string;
  provider?: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}, env: NodeJS.ProcessEnv = process.env): OpenAICompatibleEmbeddingsOptions {
  if (!config.baseUrl || !/^https?:\/\//.test(config.baseUrl)) {
    throw new Error(
      `openAICompatibleOptionsFromConfig: baseUrl must be an http(s) URL: ${config.baseUrl}`,
    );
  }
  if (!config.modelName) {
    throw new Error('openAICompatibleOptionsFromConfig: modelName is required');
  }
  if (!Number.isInteger(config.dimensions) || config.dimensions <= 0) {
    throw new Error(
      `openAICompatibleOptionsFromConfig: dimensions must be positive integer: ${config.dimensions}`,
    );
  }
  if (!config.apiKeyEnv) {
    throw new Error('openAICompatibleOptionsFromConfig: apiKeyEnv is required');
  }
  const apiKey = env[config.apiKeyEnv];
  if (!apiKey) {
    throw new AdapterUnavailableError(
      `${config.apiKeyEnv} not set; OpenAI-compatible embedding adapter requires an API key (ADR-041). Set ${config.apiKeyEnv}=<key> in the deploy env, or fall back to NoopEmbeddingService.`,
    );
  }
  return {
    baseUrl: config.baseUrl.replace(/\/+$/, ''),
    apiKey,
    modelName: config.modelName,
    dimensions: config.dimensions,
    provider: config.provider ?? inferProviderFromBaseUrl(config.baseUrl),
    ...(config.fetchImpl !== undefined ? { fetchImpl: config.fetchImpl } : {}),
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
  };
}

function inferProviderFromBaseUrl(baseUrl: string): string {
  const lower = baseUrl.toLowerCase();
  if (lower.includes('api.openai.com')) return 'openai';
  if (lower.includes('voyageai')) return 'voyage';
  if (lower.includes('localhost:11434')) return 'ollama';
  if (lower.includes('localhost:1234')) return 'lmstudio';
  if (lower.includes('localhost') || lower.includes('127.0.0.1')) return 'self-hosted';
  return 'openai-compatible';
}

// ===========================================================================
// Adapter
// ===========================================================================

interface OpenAIEmbeddingsResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage?: { prompt_tokens: number; total_tokens: number };
}

/**
 * OpenAICompatibleEmbeddingsService -- concrete EmbeddingService backed by
 * the OpenAI `/v1/embeddings` API contract.
 *
 * Lifecycle:
 *   - Construct once per process (the find_similar handler + embed pipeline
 *     share a single instance via a module-level singleton in the
 *     dispatcher; smoke tests construct directly).
 *   - close() is a no-op for this adapter; no pooled connections to drain.
 */
export class OpenAICompatibleEmbeddingsService implements EmbeddingService {
  readonly dimensions: number;
  private readonly _modelVersion: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAICompatibleEmbeddingsOptions) {
    this.dimensions = options.dimensions;
    this._modelVersion = formatModelVersion(options.provider, options.modelName, options.dimensions);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  modelVersion(): string {
    return this._modelVersion;
  }

  async embed(input: EmbedInput): Promise<EmbedResult> {
    if (!input.text || input.text.trim().length === 0) {
      throw new Error('OpenAICompatibleEmbeddingsService.embed: text must be non-empty');
    }

    const url = `${this.options.baseUrl}/embeddings`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          input: input.text,
          model: this.options.modelName,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new AdapterUnavailableError(
        `OpenAI-compatible embeddings request failed (${this.options.provider} @ ${url}): ${reason}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await safeReadBody(response);
      throw new AdapterUnavailableError(
        `OpenAI-compatible embeddings returned ${response.status} ${response.statusText} from ${url}: ${body}`,
      );
    }

    let payload: OpenAIEmbeddingsResponse;
    try {
      payload = (await response.json()) as OpenAIEmbeddingsResponse;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new AdapterUnavailableError(
        `OpenAI-compatible embeddings returned non-JSON body from ${url}: ${reason}`,
      );
    }

    const first = payload.data?.[0];
    if (!first || !Array.isArray(first.embedding)) {
      throw new AdapterUnavailableError(
        `OpenAI-compatible embeddings response missing data[0].embedding from ${url}`,
      );
    }
    if (first.embedding.length !== this.dimensions) {
      throw new Error(
        `OpenAI-compatible embeddings dimension mismatch: expected ${this.dimensions}, got ${first.embedding.length}. Check model_name + dimensions in .atelier/config.yaml.`,
      );
    }

    return { embedding: first.embedding, modelVersion: this._modelVersion };
  }

  async close(): Promise<void> {
    // Intentionally empty; no pooled state.
  }
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  } catch {
    return '<unreadable body>';
  }
}

/**
 * Convenience factory: construct from the .atelier/config.yaml find_similar
 * block + process.env. Returns NoopEmbeddingService when the API key is
 * missing so callers can choose their degradation policy uniformly. Used
 * by the dispatcher wiring + smoke tests.
 */
export function createOpenAICompatibleEmbeddingsService(config: {
  baseUrl: string;
  modelName: string;
  dimensions: number;
  apiKeyEnv: string;
  provider?: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}, env: NodeJS.ProcessEnv = process.env): EmbeddingService {
  try {
    const opts = openAICompatibleOptionsFromConfig(config, env);
    return new OpenAICompatibleEmbeddingsService(opts);
  } catch (err) {
    if (err instanceof AdapterUnavailableError) {
      // Caller chose factory-style construction; bubble the unavailability
      // rather than silently substituting Noop. The dispatcher decides
      // whether to wrap with Noop or fail startup based on its own policy.
      throw err;
    }
    throw err;
  }
}
