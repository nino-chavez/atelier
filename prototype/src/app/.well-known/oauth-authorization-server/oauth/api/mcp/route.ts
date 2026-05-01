// RFC 8414 OAuth 2.0 Authorization Server Metadata for the OAUTH-flow
// MCP route at /oauth/api/mcp.
//
// Per ARCH 7.9 discovery requirements + the path-2 split from
// substrate/oauth-discovery-split-urls.
//
// This metadata is published path-prefixed (per RFC 9728 + the empirical
// MCP-client probe pattern) so it is discovered ONLY by clients targeting
// the OAuth route. The static-bearer route at /api/mcp does NOT have
// discovery published — that prevents Claude Code's MCP SDK from
// preferentially attempting OAuth flow when a static bearer is supplied
// via headers.

import {
  oauthDiscoveryConfigFromEnv,
  oauthDiscoveryResponse,
} from '../../../../../../../../scripts/endpoint/lib/oauth-discovery.ts';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  return oauthDiscoveryResponse(oauthDiscoveryConfigFromEnv(process.env, req.url));
}
