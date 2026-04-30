// RFC 8414 OAuth 2.0 Authorization Server Metadata for the MCP endpoint
// (per ARCH 7.9 discovery requirements).
//
// MCP clients that support OAuth-protected servers (claude.ai Connectors,
// ChatGPT Connectors, Cursor, etc.) auto-discover the authorization server
// by GETting /.well-known/oauth-authorization-server on the resource. This
// endpoint returns metadata pointing at the configured identity provider.
//
// Atelier is a resource server, not an authorization server. The metadata
// here mirrors the configured identity provider's own AS metadata so MCP
// clients can drive the auth-code flow against it directly. Per ADR-028
// the default IdP is Supabase Auth; BYO via `.atelier/config.yaml:
// identity.provider`.

export interface OAuthDiscoveryConfig {
  /** Configured OIDC issuer; e.g. https://<project>.supabase.co/auth/v1 */
  issuer: string;
  /**
   * Optional override of the metadata. When unset, the response is a
   * thin pointer-shape (issuer + RFC 8414 endpoint URLs derived from
   * issuer). MCP clients that need richer metadata follow the issuer
   * to its own /.well-known/oauth-authorization-server.
   */
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  registrationEndpoint?: string;
  jwksUri?: string;
  scopesSupported?: string[];
  responseTypesSupported?: string[];
  grantTypesSupported?: string[];
  codeChallengeMethodsSupported?: string[];
}

/**
 * Build the JSON body for /.well-known/oauth-authorization-server.
 * Pure function -- transport wrappers (Next.js route, smoke server) call
 * this and serialise the result with the appropriate Cache-Control.
 */
export function buildOAuthMetadata(config: OAuthDiscoveryConfig): Record<string, unknown> {
  if (!config.issuer) throw new Error('buildOAuthMetadata: issuer required');
  const issuer = config.issuer.endsWith('/') ? config.issuer.slice(0, -1) : config.issuer;

  return {
    issuer,
    authorization_endpoint: config.authorizationEndpoint ?? `${issuer}/authorize`,
    token_endpoint: config.tokenEndpoint ?? `${issuer}/token`,
    jwks_uri: config.jwksUri ?? `${issuer}/.well-known/jwks.json`,
    ...(config.registrationEndpoint !== undefined ? { registration_endpoint: config.registrationEndpoint } : {}),
    response_types_supported: config.responseTypesSupported ?? ['code'],
    grant_types_supported: config.grantTypesSupported ?? ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: config.codeChallengeMethodsSupported ?? ['S256'],
    scopes_supported: config.scopesSupported ?? ['openid', 'profile', 'email'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  };
}

/**
 * Web-standard Response builder for the discovery endpoint. Wrapped by
 * Next.js route at prototype/src/app/.well-known/oauth-authorization-server/route.ts.
 */
export function oauthDiscoveryResponse(config: OAuthDiscoveryConfig): Response {
  const body = buildOAuthMetadata(config);
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // RFC 8414 §3 recommends caching the metadata document.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

/** Resolve discovery config from env. */
export function oauthDiscoveryConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OAuthDiscoveryConfig {
  const issuer = env.ATELIER_OIDC_ISSUER;
  if (!issuer) {
    throw new Error('ATELIER_OIDC_ISSUER not set; cannot serve /.well-known/oauth-authorization-server (ARCH 7.9)');
  }
  return { issuer };
}
