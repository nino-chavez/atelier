// Production BearerVerifier backed by remote JWKS (per ARCH 7.9 + ADR-028).
//
// Replaces the dispatcher's stubVerifier in production. Configuration is
// resolved from .atelier/config.yaml (identity.oidc_issuer + jwt_audience)
// or env (ATELIER_OIDC_ISSUER + ATELIER_JWT_AUDIENCE).
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
 * Resolve verifier configuration from env. Throws with a concrete error
 * if either value is missing -- the endpoint must fail closed when auth
 * is misconfigured per ARCH 7.9 failure boundaries.
 */
export function jwksVerifierFromEnv(env: NodeJS.ProcessEnv = process.env): BearerVerifier {
  const issuer = env.ATELIER_OIDC_ISSUER;
  const audience = env.ATELIER_JWT_AUDIENCE;
  if (!issuer) {
    throw new Error('ATELIER_OIDC_ISSUER not set; endpoint cannot validate bearer tokens (ARCH 7.9)');
  }
  if (!audience) {
    throw new Error('ATELIER_JWT_AUDIENCE not set; endpoint cannot validate bearer tokens (ARCH 7.9)');
  }
  return createJwksVerifier({ issuer, audience });
}
