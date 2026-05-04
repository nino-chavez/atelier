// Production BearerVerifier backed by remote JWKS (per ARCH 7.9 + ADR-028).
//
// Replaces the dispatcher's stubVerifier in production. Per the canonical
// rebuild (BRD-OPEN-QUESTIONS section 31), configuration derives from the
// canonical Supabase env vars:
//   - issuer    = `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1`
//   - audience  = "authenticated" (Supabase Auth default)
//
// Adopters running on a non-Supabase IdP override the issuer + audience
// via `.atelier/config.yaml: identity.oidc_issuer + jwt_audience` (loaded
// elsewhere); this env path is the Supabase-default fast path.
//
// Per ARCH 7.9 "Two paths, one scheme": both dynamic-OAuth-issued tokens
// and static API tokens are JWTs from the same identity provider; the
// validation path here is identical regardless of how the client obtained
// the token.

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { BearerClaims, BearerVerifier } from './auth.ts';

export interface JwksVerifierConfig {
  /** OIDC issuer URL. JWKS is fetched from `<issuer>/.well-known/jwks.json` unless `jwksUri` overrides. */
  issuer: string;
  /** Expected audience (`aud`) claim. */
  audience: string;
  /** Optional override for JWKS endpoint; defaults to issuer-derived. */
  jwksUri?: string;
  /** Optional clock-skew tolerance in seconds (default 5). */
  clockTolerance?: number;
}

/**
 * Build a BearerVerifier that validates JWTs against a remote JWKS.
 *
 * Caches JWKS in-process per `createRemoteJWKSet` defaults (max-age driven
 * from response Cache-Control; cooldown to limit refetch storms).
 */
export function createJwksVerifier(config: JwksVerifierConfig): BearerVerifier {
  if (!config.issuer) throw new Error('createJwksVerifier: issuer required');
  if (!config.audience) throw new Error('createJwksVerifier: audience required');

  const jwksUrl = config.jwksUri ?? deriveJwksUri(config.issuer);
  const jwks: JWTVerifyGetKey = createRemoteJWKSet(new URL(jwksUrl));
  const clockTolerance = config.clockTolerance ?? 5;

  return async function verify(token: string): Promise<BearerClaims> {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.audience,
      clockTolerance,
    });

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new Error('JWT missing required "sub" claim');
    }

    return {
      sub: payload.sub,
      ...(typeof payload.iss === 'string' ? { iss: payload.iss } : {}),
      ...(typeof payload.aud === 'string' ? { aud: payload.aud } : {}),
      ...(typeof payload.exp === 'number' ? { exp: payload.exp } : {}),
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
    };
  };
}

function deriveJwksUri(issuer: string): string {
  const trimmed = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
  return `${trimmed}/.well-known/jwks.json`;
}

/**
 * Default Supabase Auth audience claim. Supabase issues `aud: "authenticated"`
 * for all signed-in users by default. Adopters with a custom audience claim
 * override via `.atelier/config.yaml: identity.jwt_audience`.
 */
export const SUPABASE_DEFAULT_JWT_AUDIENCE = 'authenticated';

/**
 * Derive the OIDC issuer URL from the canonical Supabase env. Returns
 * `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1` (with trailing-slash trimming).
 * Throws when NEXT_PUBLIC_SUPABASE_URL is unset — the endpoint must fail
 * closed when auth is misconfigured per ARCH 7.9 failure boundaries.
 */
export function deriveSupabaseOidcIssuer(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL not set; the MCP endpoint cannot derive the OIDC issuer for bearer-token validation. Install the Vercel-Supabase Marketplace integration or set NEXT_PUBLIC_SUPABASE_URL manually.',
    );
  }
  const trimmed = url.endsWith('/') ? url.slice(0, -1) : url;
  return `${trimmed}/auth/v1`;
}

/**
 * Resolve verifier configuration from the canonical Supabase env. Issuer
 * derives from NEXT_PUBLIC_SUPABASE_URL; audience defaults to Supabase's
 * "authenticated".
 */
export function jwksVerifierFromEnv(env: NodeJS.ProcessEnv = process.env): BearerVerifier {
  const issuer = deriveSupabaseOidcIssuer(env);
  const audience = SUPABASE_DEFAULT_JWT_AUDIENCE;
  return createJwksVerifier({ issuer, audience });
}
