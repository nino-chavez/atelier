// Lens-side service dependencies (post canonical-rebuild).
//
// The lens path no longer holds a pg.Pool. Database access goes through
// `createServerSupabaseClient(cookies)` in adapters/supabase-ssr.ts, which
// returns a request-scoped Supabase JS client. That client carries the
// caller's Auth cookie / JWT, so SECURITY DEFINER RPC functions in
// supabase/migrations/20260504000011_atelier_rpc_functions.sql can resolve
// the viewer via auth.jwt() and run authorized queries server-side.
//
// What this module retains:
//   - Embedder + find-similar config singletons (the find_similar lens
//     server action still embeds the user query in Node.js before handing
//     the vector to the dispatcher / atelier_find_similar RPC).
//
// What this module no longer holds:
//   - AtelierClient (pg.Pool wrapper) — gone from lens code.
//   - JWKS verifier — the lens never validates JWTs itself; the Supabase
//     JS client carries the cookie, PostgREST validates the JWT, the RPC
//     reads auth.jwt(). The JWKS path remains for the MCP route which
//     authenticates Authorization: Bearer headers directly.
//
// The /api/mcp endpoint (out of scope for the canonical-rebuild brief)
// continues to use mcp-deps.ts which holds its own AtelierClient + JWKS
// verifier singletons. Two factories, two responsibility scopes.

import { resolve as pathResolve } from 'node:path';

import {
  AdapterUnavailableError,
  NoopEmbeddingService,
  type EmbeddingService,
} from '../../../../scripts/coordination/lib/embeddings.ts';
import { createOpenAICompatibleEmbeddingsService } from '../../../../scripts/coordination/adapters/openai-compatible-embeddings.ts';
import { loadFindSimilarConfig } from '../../../../scripts/coordination/lib/embed-config.ts';
import {
  DEFAULT_FIND_SIMILAR_CONFIG,
  type FindSimilarConfig,
} from '../../../../scripts/endpoint/lib/find-similar.ts';

let cachedEmbedder: EmbeddingService | null = null;
let cachedFindSimilarConfig: FindSimilarConfig | null = null;

export interface LensServices {
  embedder: EmbeddingService;
  findSimilarConfig: FindSimilarConfig;
}

/**
 * Resolve the lens-side embedding service + thresholds. Module-scoped
 * memoization survives across page renders within a warm container.
 *
 * On missing OPENAI_API_KEY (the dev path where an adopter has not yet set
 * the embeddings provider key) substitute Noop so find_similar serves the
 * keyword fallback with degraded=true rather than crashing the lens.
 */
export function getLensServices(): LensServices {
  if (cachedEmbedder && cachedFindSimilarConfig) {
    return { embedder: cachedEmbedder, findSimilarConfig: cachedFindSimilarConfig };
  }
  const repoRoot = process.env.ATELIER_REPO_ROOT
    ? pathResolve(process.env.ATELIER_REPO_ROOT)
    : pathResolve(process.cwd());
  let config;
  try {
    config = loadFindSimilarConfig(repoRoot);
  } catch (err) {
    console.warn(
      `[lens-services] find_similar config not loadable from ${repoRoot}; falling back to defaults: ${(err as Error).message}`,
    );
    cachedEmbedder = new NoopEmbeddingService({ dimensions: 1536, modelVersion: 'noop@1536' });
    cachedFindSimilarConfig = DEFAULT_FIND_SIMILAR_CONFIG;
    return { embedder: cachedEmbedder, findSimilarConfig: cachedFindSimilarConfig };
  }
  try {
    cachedEmbedder = createOpenAICompatibleEmbeddingsService({
      baseUrl: config.yaml.embeddings.base_url,
      modelName: config.yaml.embeddings.model_name,
      dimensions: config.yaml.embeddings.dimensions,
      apiKeyEnv: config.yaml.embeddings.api_key_env,
    });
  } catch (err) {
    if (err instanceof AdapterUnavailableError) {
      console.warn(
        `[lens-services] ${err.message} -- using NoopEmbeddingService (find_similar will return degraded=true; set ${config.yaml.embeddings.api_key_env} to enable real semantic search)`,
      );
      cachedEmbedder = new NoopEmbeddingService({
        dimensions: config.yaml.embeddings.dimensions,
        modelVersion: `noop@${config.yaml.embeddings.dimensions}`,
      });
    } else {
      throw err;
    }
  }
  cachedFindSimilarConfig = config.thresholds;
  return { embedder: cachedEmbedder!, findSimilarConfig: cachedFindSimilarConfig };
}
