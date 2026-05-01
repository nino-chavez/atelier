// Streamable HTTP MCP transport endpoint — OAUTH FLOW path.
//
// This route is the OAuth-flow surface for remote MCP clients
// (claude.ai Connectors, ChatGPT Connectors, custom OAuth-only MCP
// clients). RFC 8414 + 7591 discovery is published at
// /.well-known/oauth-authorization-server/oauth/api/mcp pointing at the
// configured identity provider (Supabase Auth by default per ADR-028).
//
// For static-bearer clients (Claude Code CLI's local-bootstrap config),
// use the sibling route at /api/mcp which does NOT publish discovery —
// that prevents Claude Code's MCP SDK from preferentially attempting
// OAuth flow when a static bearer is supplied via headers.
//
// Both routes share singletons via prototype/src/lib/atelier/mcp-deps.ts;
// they differ only in (a) URL path and (b) discovery publishing surface.

import { handleMcpRequest } from '../../../../../../scripts/endpoint/lib/transport.ts';
import { getMcpDeps, mcpMethodNotAllowedResponse } from '../../../../lib/atelier/mcp-deps.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request, { deps: getMcpDeps() });
}

export async function GET(): Promise<Response> {
  return mcpMethodNotAllowedResponse();
}
