// RFC 8414 OAuth 2.0 Authorization Server Metadata for the MCP endpoint
// (per ARCH 7.9 discovery requirements).
//
// MCP clients that support OAuth-protected servers (claude.ai Connectors,
// ChatGPT Connectors, Cursor, Claude Code, etc.) auto-discover the
// authorization server by GETting /.well-known/oauth-authorization-server
// on the resource. This endpoint returns metadata pointing at the configured
// identity provider.
//
// Atelier is a resource server, not an authorization server. The metadata
// here mirrors the configured identity provider's own AS metadata so MCP
// clients can drive the auth-code flow against it directly. Per ADR-028
// the default IdP is Supabase Auth; BYO via `.atelier/config.yaml:
// identity.provider`.
//
// ---------------------------------------------------------------------------
// Why we always emit registration_endpoint
// ---------------------------------------------------------------------------
//
// Atelier does NOT support RFC 7591 Dynamic Client Registration. Per ADR-028
// adopters provision long-lived bearer tokens out-of-band (Supabase Auth
// password grant for local-bootstrap, OAuth code-flow for cloud, BYO for
// custom IdPs) and supply them as static `Authorization: Bearer ...` headers.
//
// However, several MCP clients (notably Claude Code's MCP SDK) probe the
// authorization server's `registration_endpoint` during OAuth discovery as
// part of their own auto-config flow. When the field is absent these clients
// interpret the server as "incompatible" and bail at /mcp — even though the
// caller has supplied a perfectly valid static bearer in headers. The
// empirical probe sequence is documented in the substrate PR that landed
// this stub.
//
// The fix: always emit `registration_endpoint` pointing at a same-origin URL
// (default `/oauth/register`). The route at that URL returns 405 (Method Not
// Allowed) with a documented error body via `oauthRegistrationStubResponse`
// below, telling clients that DCR is not supported and to use static bearer
// auth. Clients that handle this gracefully (which Claude Code does) fall
// back to the bearer in headers and proceed; clients that hard-require DCR
// were never going to work with Atelier anyway.
//
// Adopters who DO support DCR — e.g., a custom auth provider with its own
// /oauth/register endpoint — override the default via
// `ATELIER_OAUTH_REGISTRATION_ENDPOINT` in the deploy env.

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
  /**
   * Same-origin URL (or relative path) for the registration stub. When
   * unset, defaults to `/oauth/register` — a relative URL per RFC 8414
   * §3, resolved by the client against the resource-server origin.
   */
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
 *
 * `registration_endpoint` is always emitted (defaulting to `/oauth/register`)
 * so MCP clients that probe it during discovery don't bail. See file header
 * for the rationale.
 */
export function buildOAuthMetadata(config: OAuthDiscoveryConfig): Record<string, unknown> {
  if (!config.issuer) throw new Error('buildOAuthMetadata: issuer required');
  // Trim whitespace + trailing slashes. Empirically env vars set via
  // `echo "$VAL" | vercel env add` (and similar piped flows) carry a
  // trailing newline; the issuer is concatenated to form authorization /
  // token / jwks URLs, so the newline propagates and breaks every URL
  // downstream. Defensive trim covers that class of operator slip-up.
  const issuer = config.issuer.trim().replace(/\/+$/, '');

  return {
    issuer,
    authorization_endpoint: config.authorizationEndpoint ?? `${issuer}/authorize`,
    token_endpoint: config.tokenEndpoint ?? `${issuer}/token`,
    jwks_uri: config.jwksUri ?? `${issuer}/.well-known/jwks.json`,
    registration_endpoint: config.registrationEndpoint ?? '/oauth/register',
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

/**
 * Web-standard Response for the OAuth registration stub. See file header for
 * why this exists. Atelier does NOT implement RFC 7591 DCR; this 405 with a
 * documented error body lets MCP clients that probe `registration_endpoint`
 * fall back to the static bearer in headers per ADR-028.
 *
 * Used by both the Next.js route at prototype/src/app/oauth/register/route.ts
 * and the smoke-server stand-ups in scripts/endpoint/__smoke__/.
 */
export function oauthRegistrationStubResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'registration_not_supported',
      hint: 'Use static bearer auth via headers.Authorization per ADR-028; or have your auth provider issue a long-lived token.',
    }),
    {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        // No methods are accepted; an empty Allow header is the RFC 7231 §6.5.5
        // signal that the resource itself exists but accepts nothing here.
        Allow: '',
      },
    },
  );
}

/**
 * Resolve discovery config from env.
 *
 * Registration endpoint resolution order:
 *   1. ATELIER_OAUTH_REGISTRATION_ENDPOINT — explicit override (adopters
 *      with a real DCR endpoint at their auth provider point at it here).
 *   2. ATELIER_ENDPOINT_URL — derive `<endpoint-base>/oauth/register`
 *      so the metadata carries an absolute URL when the deploy URL is known.
 *   3. Derived from `requestUrl` when supplied — the route knows its own
 *      request origin and constructs the absolute URL there. This is the
 *      runtime fallback for local-bootstrap where neither env var is set.
 *   4. Last-resort relative `/oauth/register` — RFC 8414 §3 permits this,
 *      but real-world MCP SDK validators (Claude Code, Cursor) reject
 *      relative URLs with Zod-style `.url()` strictness. Use only for
 *      contexts where no request URL is available (rare; mostly tests).
 *
 * The empirical tail of resolution order #4 was added 2026-05-01 as a
 * hotfix to PR #11: the original fix emitted a relative URL by default,
 * which was spec-compliant but failed Claude Code's MCP SDK schema
 * validation (`registration_endpoint` validates as `.url()` requiring
 * absolute). Wild-validator strictness > RFC permissiveness.
 */
export function oauthDiscoveryConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  requestUrl?: string,
): OAuthDiscoveryConfig {
  const issuer = env.ATELIER_OIDC_ISSUER;
  if (!issuer) {
    throw new Error('ATELIER_OIDC_ISSUER not set; cannot serve /.well-known/oauth-authorization-server (ARCH 7.9)');
  }
  return {
    issuer,
    registrationEndpoint: resolveRegistrationEndpoint(env, requestUrl),
  };
}

function resolveRegistrationEndpoint(env: NodeJS.ProcessEnv, requestUrl?: string): string {
  if (env.ATELIER_OAUTH_REGISTRATION_ENDPOINT) {
    return env.ATELIER_OAUTH_REGISTRATION_ENDPOINT;
  }
  if (env.ATELIER_ENDPOINT_URL) {
    const base = env.ATELIER_ENDPOINT_URL.replace(/\/+$/, '');
    return `${base}/oauth/register`;
  }
  if (requestUrl) {
    // Construct absolute URL from request origin. URL constructor handles
    // the resolution against the request's authority + scheme.
    return new URL('/oauth/register', requestUrl).toString();
  }
  return '/oauth/register';
}
