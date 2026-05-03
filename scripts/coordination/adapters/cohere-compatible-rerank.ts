// Cohere-compatible RerankerService adapter (C3 — ADR-047).
//
// Implements the RerankerService interface against any provider that
// exposes Cohere's /v1/rerank wire shape. At v1 this covers:
//
//   - Cohere itself (https://api.cohere.ai/v1)
//     - Models: rerank-english-v3.0, rerank-multilingual-v3.0, etc.
//
//   - Voyage AI (https://api.voyageai.com/v1)
//     - Models: rerank-2, rerank-2-lite
//     - Wire shape: identical to Cohere's
//
//   - Self-hosted servers exposing the shape (e.g., a vLLM deployment
//     serving a cross-encoder via a Cohere-compatible proxy)
//
// Per ADR-029 the GCP-portability discipline keeps provider-specific
// dependencies in NAMED ADAPTER MODULES. This adapter uses node:fetch
// (standard) and stays portable. Adopters using Anthropic / OpenAI
// (which lack a /rerank endpoint at v1) write a sibling adapter that
// translates to those providers' rerank-shaped surfaces (e.g., GPT-4
// + structured-output as a poor-man's reranker for low-volume use).

import type {
  RerankRequest,
  RerankResult,
  RerankerService,
} from '../lib/reranker.ts';
import { RerankerUnavailableError } from '../lib/reranker.ts';

export interface CohereCompatibleRerankOptions {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  timeoutMs?: number;
  fetchImpl?: typeof globalThis.fetch;
}

interface CohereRerankResponseItem {
  index: number;
  relevance_score: number;
}

interface CohereRerankResponse {
  results: CohereRerankResponseItem[];
  /** Some providers include this; we don't depend on it. */
  meta?: { billed_units?: { rerank_units?: number } };
}

export function createCohereCompatibleRerankService(opts: CohereCompatibleRerankOptions): RerankerService {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const url = `${baseUrl}/rerank`;

  return {
    name: 'cohere-compatible',

    async rerank(req: RerankRequest): Promise<RerankResult[]> {
      if (req.documents.length === 0) return [];

      const body = {
        model: opts.modelName,
        query: req.query,
        documents: req.documents.map((d) => d.text),
        ...(req.topK !== undefined ? { top_n: req.topK } : {}),
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new RerankerUnavailableError(
          `cohere-compatible rerank: transport failure: ${msg}`,
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new RerankerUnavailableError(
          `cohere-compatible rerank: ${response.status} ${response.statusText}: ${detail.slice(0, 300)}`,
        );
      }

      let parsed: CohereRerankResponse;
      try {
        parsed = (await response.json()) as CohereRerankResponse;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new RerankerUnavailableError(
          `cohere-compatible rerank: response parse failed: ${msg}`,
        );
      }

      if (!Array.isArray(parsed.results)) {
        throw new RerankerUnavailableError(
          'cohere-compatible rerank: response missing results[] array',
        );
      }

      // Map provider-side index back to caller's document IDs + priorScores.
      // The provider returns results sorted by descending relevance_score.
      return parsed.results.map((r) => {
        const inputDoc = req.documents[r.index];
        if (!inputDoc) {
          throw new RerankerUnavailableError(
            `cohere-compatible rerank: provider returned out-of-range index ${r.index} for ${req.documents.length} input documents`,
          );
        }
        return {
          id: inputDoc.id,
          score: r.relevance_score,
          ...(inputDoc.priorScore !== undefined ? { priorScore: inputDoc.priorScore } : {}),
        };
      });
    },

    async close(): Promise<void> {
      // node:fetch has no per-instance pool to close.
    },
  };
}

/**
 * Factory that reads adapter options from RerankerConfig + env. Mirrors
 * the openAICompatibleChatOptionsFromConfig pattern from
 * `openai-compatible-chat.ts`. Throws RerankerUnavailableError when the
 * key env var is unset; callers handle the fallback decision.
 */
export function cohereCompatibleRerankOptionsFromConfig(
  config: {
    baseUrl: string;
    modelName: string;
    apiKeyEnv: string;
    timeoutMs?: number;
    fetchImpl?: typeof globalThis.fetch;
  },
  env: NodeJS.ProcessEnv = process.env,
): CohereCompatibleRerankOptions {
  if (!config.baseUrl || !/^https?:\/\//.test(config.baseUrl)) {
    throw new Error(
      `cohereCompatibleRerankOptionsFromConfig: baseUrl must be an http(s) URL: ${config.baseUrl}`,
    );
  }
  if (!config.modelName) {
    throw new Error('cohereCompatibleRerankOptionsFromConfig: modelName is required');
  }
  if (!config.apiKeyEnv) {
    throw new Error('cohereCompatibleRerankOptionsFromConfig: apiKeyEnv is required');
  }
  const apiKey = env[config.apiKeyEnv];
  if (!apiKey) {
    throw new RerankerUnavailableError(
      `${config.apiKeyEnv} not set; cohere-compatible rerank adapter requires an API key. Set ${config.apiKeyEnv}=<key> in the deploy env.`,
    );
  }
  return {
    baseUrl: config.baseUrl,
    apiKey,
    modelName: config.modelName,
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    ...(config.fetchImpl !== undefined ? { fetchImpl: config.fetchImpl } : {}),
  };
}

export function createCohereCompatibleRerankServiceFromConfig(
  config: {
    baseUrl: string;
    modelName: string;
    apiKeyEnv: string;
    timeoutMs?: number;
    fetchImpl?: typeof globalThis.fetch;
  },
  env: NodeJS.ProcessEnv = process.env,
): RerankerService {
  const opts = cohereCompatibleRerankOptionsFromConfig(config, env);
  return createCohereCompatibleRerankService(opts);
}
