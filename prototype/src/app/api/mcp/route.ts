// Streamable HTTP MCP transport endpoint.
// Per ARCH 7.9 + ADR-013 + ADR-040 + .atelier/config.yaml:agent_protocol.endpoint.
//
// This file is a thin Next.js App Router wrapper around the framework-
// agnostic transport handler in scripts/endpoint/lib/transport.ts. The
// substrate (auth + dispatcher + handlers) lives in scripts/endpoint/lib/;
// the prototype only mounts it at the HTTP wire.
//
// Runtime: Node.js (default). Per ADR-029 we do NOT use the Edge runtime
// because the AtelierClient uses pg over TCP, which is not available in
// Edge.

import { resolve as pathResolve } from 'node:path';

import { AtelierClient } from '../../../../../scripts/sync/lib/write.ts';
import { gitCommitterFromEnv } from '../../../../../scripts/endpoint/lib/committer.ts';
import { jwksVerifierFromEnv } from '../../../../../scripts/endpoint/lib/jwks-verifier.ts';
import { handleMcpRequest } from '../../../../../scripts/endpoint/lib/transport.ts';
import {
  AdapterUnavailableError,
  NoopEmbeddingService,
  type EmbeddingService,
} from '../../../../../scripts/coordination/lib/embeddings.ts';
import { createOpenAICompatibleEmbeddingsService } from '../../../../../scripts/coordination/adapters/openai-compatible-embeddings.ts';
import { loadFindSimilarConfig } from '../../../../../scripts/coordination/lib/embed-config.ts';
import {
  DEFAULT_FIND_SIMILAR_CONFIG,
  type FindSimilarConfig,
} from '../../../../../scripts/endpoint/lib/find-similar.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lazy singletons -- the AtelierClient holds a pg connection pool which
// must persist across function invocations within a single warm
// container. Declared at module scope so Next.js's per-request handler
// reuses the pool.
let cachedClient: AtelierClient | null = null;
function getClient(): AtelierClient {
  if (cachedClient) return cachedClient;
  const databaseUrl = process.env.ATELIER_DATASTORE_URL;
  if (!databaseUrl) {
    throw new Error(
      'ATELIER_DATASTORE_URL not set; the MCP endpoint cannot connect to the coordination datastore (ARCH 9.3)',
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

export async function POST(request: Request): Promise<Response> {
  // ARCH 7.8 / ADR-023: per-project git committer wires into the
  // dispatcher's `decisionCommit` slot. Configured via env vars consumed by
  // gitCommitterFromEnv(); when unset (e.g., during local dev without a
  // working clone) committer is null and log_decision returns INTERNAL with
  // the documented marker so callers observe the gap explicitly.
  const committer = getCommitter();
  const embedding = getEmbeddingDeps();
  return handleMcpRequest(request, {
    deps: {
      client: getClient(),
      verifier: getVerifier(),
      ...(committer !== null ? { decisionCommit: committer } : {}),
      embedder: embedding.embedder,
      findSimilarConfig: embedding.config,
    },
  });
}

// Per ARCH 7.9: GET on /mcp is reserved for the SSE upgrade path
// (server-initiated messages). The minimum-viable transport at M2-mid
// returns a 405 to make the limitation explicit; clients that POST work
// today, and the GET hook is reserved for streaming progress events when
// the first long-running tool surface lands.
export async function GET(): Promise<Response> {
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
