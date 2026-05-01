// RFC 8414 OAuth 2.0 Authorization Server Metadata for the MCP endpoint.
// Per ARCH 7.9 discovery requirements.
//
// MCP clients GET this path to discover the authorization server backing
// the resource. The metadata document points at the configured identity
// provider (Supabase Auth by default per ADR-028; BYO via
// .atelier/config.yaml: identity.provider).

import {
  oauthDiscoveryConfigFromEnv,
  oauthDiscoveryResponse,
} from '../../../../../scripts/endpoint/lib/oauth-discovery.ts';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  // Pass req.url so the lib can construct an absolute registration_endpoint
  // URL from the request origin when ATELIER_ENDPOINT_URL is not set.
  // Real-world MCP SDK validators (Claude Code, Cursor) reject relative
  // URLs even though RFC 8414 §3 permits them.
  return oauthDiscoveryResponse(oauthDiscoveryConfigFromEnv(process.env, req.url));
}
