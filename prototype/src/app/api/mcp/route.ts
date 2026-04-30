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

import { AtelierClient } from '../../../../../scripts/sync/lib/write.ts';
import { jwksVerifierFromEnv } from '../../../../../scripts/endpoint/lib/jwks-verifier.ts';
import { handleMcpRequest } from '../../../../../scripts/endpoint/lib/transport.ts';

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

export async function POST(request: Request): Promise<Response> {
  // decisionCommit is omitted at M2-mid per .atelier/checkpoints/SESSION.md
  // section "M2 follow-ups not blocking exit" item 1: the per-project git
  // committer (ARCH 7.8 / ADR-023) lands later in M2-mid. Until then,
  // log_decision returns INTERNAL with the documented marker so callers
  // observe the gap explicitly.
  return handleMcpRequest(request, {
    deps: {
      client: getClient(),
      verifier: getVerifier(),
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
