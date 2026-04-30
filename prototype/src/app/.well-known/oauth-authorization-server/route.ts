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

export async function GET(): Promise<Response> {
  return oauthDiscoveryResponse(oauthDiscoveryConfigFromEnv());
}
