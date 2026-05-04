// Lens-side dispatcher dependencies.
//
// The /atelier route fetches data via dispatch() in-process per the M3 brief
// (option a: server actions / server components call the dispatcher directly,
// avoiding an HTTP round trip to /api/mcp). This module owns the AtelierClient
// pool + bearer verifier singletons used by the lens path.
//
// The /api/mcp route (prototype/src/app/api/mcp/route.ts) keeps its own local
// singletons; intentionally not unified at M3 to keep the blast radius small
// (the route is M2-mid working code). If a future change needs both consumers
// to share state, factor the shared bits up here.

import { resolve as pathResolve } from 'node:path';

import { AtelierClient } from '../../../../scripts/sync/lib/write.ts';
import type { BearerVerifier } from '../../../../scripts/endpoint/lib/auth.ts';
import { stubVerifier } from '../../../../scripts/endpoint/lib/auth.ts';
import { jwksVerifierFromEnv } from '../../../../scripts/endpoint/lib/jwks-verifier.ts';
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

/**
 * Module-scoped singletons. Next.js reuses these across page renders within
 * a warm container (and across server-action invocations). Cold starts
 * recreate them; that is the expected pg pool lifecycle.
 */
let cachedClient: AtelierClient | null = null;
let cachedVerifier: BearerVerifier | null = null;
let cachedEmbedder: EmbeddingService | null = null;
let cachedFindSimilarConfig: FindSimilarConfig | null = null;

export interface LensDeps {
  client: AtelierClient;
  verifier: BearerVerifier;
  embedder: EmbeddingService;
  findSimilarConfig: FindSimilarConfig;
}

/**
 * Resolve the client + verifier the lens code uses for dispatch() calls.
 *
 * Verifier mode:
 *   - Production: a resolvable OIDC issuer + audience pair (canonical:
 *     NEXT_PUBLIC_SUPABASE_URL → derived `<url>/auth/v1` issuer + audience
 *     "authenticated"; legacy: ATELIER_OIDC_ISSUER + ATELIER_JWT_AUDIENCE
 *     overrides) → remote-JWKS verifier (real Supabase Auth or any OIDC
 *     provider).
 *   - Development: ATELIER_DEV_BEARER + ATELIER_ALLOW_DEV_BEARER=true →
 *     stub verifier accepts tokens shaped "stub:<sub>". The opt-in env gate
 *     prevents a stray dev var in a prod container from silently bypassing
 *     real auth. See `prototype/src/lib/atelier/session.ts:resolveBearer`
 *     for the cookie-vs-stub resolution order.
 */
export function getLensDeps(): LensDeps {
  if (!cachedClient) {
    const databaseUrl =
      process.env.POSTGRES_URL ??
      process.env.ATELIER_DATASTORE_URL ??
      process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        'POSTGRES_URL (or legacy ATELIER_DATASTORE_URL / DATABASE_URL) not set; the /atelier lens cannot connect to the coordination datastore (ARCH 9.3)',
      );
    }
    cachedClient = new AtelierClient({ databaseUrl });
  }
  if (!cachedVerifier) {
    cachedVerifier = resolveVerifier();
  }
  if (!cachedEmbedder || !cachedFindSimilarConfig) {
    const resolved = resolveEmbeddingDeps();
    cachedEmbedder = resolved.embedder;
    cachedFindSimilarConfig = resolved.config;
  }
  return {
    client: cachedClient,
    verifier: cachedVerifier,
    embedder: cachedEmbedder,
    findSimilarConfig: cachedFindSimilarConfig,
  };
}

/**
 * Resolve the EmbeddingService + thresholds from .atelier/config.yaml
 * (per ADR-041). When the configured API key is missing -- the dev path
 * where an adopter has not yet set OPENAI_API_KEY -- substitute Noop so
 * find_similar serves the keyword fallback with degraded=true rather
 * than crashing the whole lens path. Production deploys that omit the
 * key see the same degraded UI banner the rest of US-6.5 specifies.
 */
function resolveEmbeddingDeps(): { embedder: EmbeddingService; config: FindSimilarConfig } {
  const repoRoot = process.env.ATELIER_REPO_ROOT
    ? pathResolve(process.env.ATELIER_REPO_ROOT)
    : pathResolve(process.cwd());
  let config;
  try {
    config = loadFindSimilarConfig(repoRoot);
  } catch (err) {
    console.warn(
      `[lens-deps] find_similar config not loadable from ${repoRoot}; falling back to defaults: ${(err as Error).message}`,
    );
    return {
      embedder: new NoopEmbeddingService({ dimensions: 1536, modelVersion: 'noop@1536' }),
      config: DEFAULT_FIND_SIMILAR_CONFIG,
    };
  }
  let embedder: EmbeddingService;
  try {
    embedder = createOpenAICompatibleEmbeddingsService({
      baseUrl: config.yaml.embeddings.base_url,
      modelName: config.yaml.embeddings.model_name,
      dimensions: config.yaml.embeddings.dimensions,
      apiKeyEnv: config.yaml.embeddings.api_key_env,
    });
  } catch (err) {
    if (err instanceof AdapterUnavailableError) {
      console.warn(
        `[lens-deps] ${err.message} -- using NoopEmbeddingService (find_similar will return degraded=true; set ${config.yaml.embeddings.api_key_env} to enable real semantic search)`,
      );
      embedder = new NoopEmbeddingService({
        dimensions: config.yaml.embeddings.dimensions,
        modelVersion: `noop@${config.yaml.embeddings.dimensions}`,
      });
    } else {
      throw err;
    }
  }
  return { embedder, config: config.thresholds };
}

function resolveVerifier(): BearerVerifier {
  // Canonical: derive issuer from NEXT_PUBLIC_SUPABASE_URL (Supabase Auth lives
  // at <url>/auth/v1) and default audience to "authenticated" (Supabase default).
  // Legacy ATELIER_OIDC_ISSUER + ATELIER_JWT_AUDIENCE still override when set.
  // The actual jwksVerifierFromEnv() reads its config the same way (see
  // scripts/endpoint/lib/jwks-verifier.ts).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const oidcIssuer =
    process.env.ATELIER_OIDC_ISSUER ??
    (supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/auth/v1` : undefined);
  const oidcAudience = process.env.ATELIER_JWT_AUDIENCE ?? (oidcIssuer ? 'authenticated' : undefined);
  if (oidcIssuer && oidcAudience) {
    return jwksVerifierFromEnv();
  }
  if (process.env.ATELIER_DEV_BEARER) {
    return stubVerifier;
  }
  throw new Error(
    'No bearer verifier configured. Set NEXT_PUBLIC_SUPABASE_URL (canonical; audience defaults to "authenticated") or ATELIER_OIDC_ISSUER + ATELIER_JWT_AUDIENCE (legacy override) for production, or ATELIER_DEV_BEARER for development.',
  );
}
