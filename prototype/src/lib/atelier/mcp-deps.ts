// Shared dependency-singletons for the MCP HTTP routes.
//
// Atelier publishes the MCP transport at TWO URLs (per the path-2 split
// from substrate/oauth-discovery-split-urls):
//
//   /api/mcp        — static-bearer auth path (no OAuth discovery published)
//   /oauth/api/mcp  — OAuth-flow path (RFC 8414 + 7591 discovery published
//                      at /.well-known/oauth-authorization-server/oauth/api/mcp)
//
// Both URLs share one MCP handler, one bearer verifier, one DB pool, one
// git committer, one embedder. This module owns the lazy module-scoped
// singletons; both routes import getMcpDeps() and pass the result to
// handleMcpRequest.
//
// Why split? Claude Code's MCP SDK preferentially does OAuth flow when
// discovery is published, ignoring static bearer in headers. Since
// Atelier doesn't support RFC 7591 DCR (per ADR-028), local Claude Code
// CLI sessions need a URL where discovery is NOT published so they fall
// back to static bearer. Remote OAuth clients (claude.ai Connectors) need
// a URL where discovery IS published. Same backend, different surface.

import { resolve as pathResolve } from 'node:path';

import { AtelierClient } from '../../../../scripts/sync/lib/write.ts';
import { gitCommitterFromEnv, type AdrCommitter } from '../../../../scripts/endpoint/lib/committer.ts';
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

let cachedClient: AtelierClient | null = null;
function getClient(): AtelierClient {
  if (cachedClient) return cachedClient;
  // Canonical POSTGRES_URL (Vercel-provisioned by the native Supabase
  // integration); legacy ATELIER_DATASTORE_URL kept for backward compat.
  const databaseUrl =
    process.env.POSTGRES_URL ??
    process.env.ATELIER_DATASTORE_URL ??
    process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'POSTGRES_URL (or legacy ATELIER_DATASTORE_URL / DATABASE_URL) not set; the MCP endpoint cannot connect to the coordination datastore (ARCH 9.3)',
    );
  }
  cachedClient = new AtelierClient({ databaseUrl });
  return cachedClient;
}

let cachedVerifier: ReturnType<typeof jwksVerifierFromEnv> | null = null;
function getVerifier() {
  if (cachedVerifier) return cachedVerifier;
  cachedVerifier = jwksVerifierFromEnv();
  return cachedVerifier;
}

let cachedCommitter: ReturnType<typeof gitCommitterFromEnv> | null = null;
function getCommitter() {
  if (cachedCommitter !== null) return cachedCommitter;
  cachedCommitter = gitCommitterFromEnv();
  return cachedCommitter;
}

let cachedEmbedder: EmbeddingService | null = null;
let cachedFindSimilarConfig: FindSimilarConfig | null = null;
function getEmbeddingDeps(): { embedder: EmbeddingService; config: FindSimilarConfig } {
  if (cachedEmbedder && cachedFindSimilarConfig) {
    return { embedder: cachedEmbedder, config: cachedFindSimilarConfig };
  }
  const repoRoot = process.env.ATELIER_REPO_ROOT
    ? pathResolve(process.env.ATELIER_REPO_ROOT)
    : pathResolve(process.cwd());
  let config;
  try {
    config = loadFindSimilarConfig(repoRoot);
  } catch (err) {
    console.warn(
      `[mcp-route] find_similar config not loadable; using defaults + Noop embedder: ${(err as Error).message}`,
    );
    cachedEmbedder = new NoopEmbeddingService({ dimensions: 1536, modelVersion: 'noop@1536' });
    cachedFindSimilarConfig = DEFAULT_FIND_SIMILAR_CONFIG;
    return { embedder: cachedEmbedder, config: cachedFindSimilarConfig };
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
        `[mcp-route] ${err.message} -- find_similar will return degraded=true (set ${config.yaml.embeddings.api_key_env} to enable)`,
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
  return { embedder: cachedEmbedder, config: cachedFindSimilarConfig };
}

export interface McpDeps {
  client: AtelierClient;
  verifier: ReturnType<typeof jwksVerifierFromEnv>;
  decisionCommit?: AdrCommitter;
  embedder: EmbeddingService;
  findSimilarConfig: FindSimilarConfig;
}

export function getMcpDeps(): McpDeps {
  const committer = getCommitter();
  const embedding = getEmbeddingDeps();
  const deps: McpDeps = {
    client: getClient(),
    verifier: getVerifier(),
    embedder: embedding.embedder,
    findSimilarConfig: embedding.config,
  };
  if (committer !== null) deps.decisionCommit = committer;
  return deps;
}

export function mcpMethodNotAllowedResponse(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32601,
        message: 'GET on /mcp (SSE upgrade) not implemented at M2-mid; POST tools/call works today',
      },
    }),
    {
      status: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'POST' },
    },
  );
}
