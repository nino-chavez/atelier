// Streamable HTTP MCP transport endpoint — STATIC BEARER auth path.
// Per ARCH 7.9 + ADR-013 + ADR-040 + .atelier/config.yaml:agent_protocol.endpoint.
//
// This route accepts static `Authorization: Bearer ...` headers. It does
// NOT publish OAuth discovery — Claude Code's MCP SDK preferentially does
// OAuth flow when discovery is present and ignores static headers, so
// local-bootstrap composers using static bearers must hit a URL with no
// discovery probes available.
//
// For OAuth-flow clients (claude.ai Connectors, ChatGPT Connectors), use
// the parallel route at /oauth/api/mcp which DOES publish discovery at
// /.well-known/oauth-authorization-server/oauth/api/mcp.
//
// Both routes share singletons (one DB pool, one verifier, one committer,
// one embedder) via prototype/src/lib/atelier/mcp-deps.ts.
//
// Runtime: Node.js (default). Per ADR-029 we do NOT use the Edge runtime
// because the AtelierClient uses pg over TCP, which is not available in
// Edge.

import { handleMcpRequest } from '../../../../../scripts/endpoint/lib/transport.ts';
import { getMcpDeps, mcpMethodNotAllowedResponse } from '../../../lib/atelier/mcp-deps.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request, { deps: getMcpDeps() });
}

export async function GET(): Promise<Response> {
  return mcpMethodNotAllowedResponse();
}
