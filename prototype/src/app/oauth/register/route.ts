// OAuth registration stub (RFC 7591 Dynamic Client Registration).
//
// Atelier does NOT support DCR; per ADR-028 adopters provision long-lived
// bearer tokens out-of-band and supply them as static
// `Authorization: Bearer ...` headers. This route exists solely so MCP
// clients that probe `registration_endpoint` during OAuth discovery (notably
// Claude Code's MCP SDK) don't interpret the server as "incompatible" and
// bail at /mcp — they instead receive a 405 with a documented error body
// telling them to use the static bearer in headers, and fall through.
//
// See scripts/endpoint/lib/oauth-discovery.ts for the full rationale and the
// shared response builder.

import { oauthRegistrationStubResponse } from '../../../../../scripts/endpoint/lib/oauth-discovery.ts';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return oauthRegistrationStubResponse();
}

export async function POST(): Promise<Response> {
  return oauthRegistrationStubResponse();
}
