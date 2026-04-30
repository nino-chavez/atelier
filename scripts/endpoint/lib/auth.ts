// OAuth 2.1 bearer-token validation per ARCH 7.9.
//
// The endpoint validates every MCP HTTP request against the configured
// identity provider's JWKS and resolves the JWT `sub` claim to a
// composer.id via composers.identity_subject (added at M2 per audit
// finding H1).
//
// The verification function is pluggable so tests can inject a stub
// verifier without standing up a real identity provider. In production
// the BearerVerifier wraps a JWKS fetcher + signature verifier.

import { Pool } from 'pg';
import { AtelierError } from '../../sync/lib/write.ts';

export interface BearerClaims {
  sub: string;          // identity_subject in the composer table
  iss?: string;         // configured identity provider issuer
  aud?: string;         // configured audience
  exp?: number;         // expiration epoch seconds
  email?: string;
}

export type BearerVerifier = (token: string) => Promise<BearerClaims>;

export interface AuthContext {
  composerId: string;
  projectId: string;
  discipline: string | null;
  identitySubject: string;
}

/**
 * Validate a bearer token and resolve it to an AuthContext (composer +
 * project). Throws AtelierError on validation failure.
 *
 * Per ARCH 7.9: Two paths, one scheme. Both dynamic OAuth and static API
 * tokens produce JWTs from the configured identity provider; the
 * validation path is identical regardless of how the client obtained the
 * token. The endpoint accepts any valid bearer.
 */
export async function authenticate(
  token: string,
  verifier: BearerVerifier,
  pool: Pool,
): Promise<AuthContext> {
  if (!token || token.trim().length === 0) {
    throw new AtelierError('FORBIDDEN', 'missing bearer token');
  }
  let claims: BearerClaims;
  try {
    claims = await verifier(token);
  } catch (err) {
    throw new AtelierError('FORBIDDEN', `bearer validation failed: ${(err as Error).message}`);
  }
  if (claims.exp !== undefined && claims.exp * 1000 < Date.now()) {
    throw new AtelierError('FORBIDDEN', 'bearer token expired');
  }
  // Resolve the sub claim to a composer row. UNIQUE(project_id, identity_subject)
  // means a single sub may match multiple rows (one per project the composer
  // is in); the smoke / register flow specifies project_id explicitly so the
  // ambiguity is resolved at register-time. For other tools the session_id
  // already binds the composer to a project; validation follows that bind.
  const { rows } = await pool.query<{
    id: string;
    project_id: string;
    discipline: string | null;
  }>(
    `SELECT id, project_id, discipline::text AS discipline
       FROM composers
      WHERE identity_subject = $1
        AND status = 'active'
      LIMIT 1`,
    [claims.sub],
  );
  const row = rows[0];
  if (!row) {
    throw new AtelierError('FORBIDDEN', `no active composer for identity_subject ${claims.sub}`);
  }
  return {
    composerId: row.id,
    projectId: row.project_id,
    discipline: row.discipline,
    identitySubject: claims.sub,
  };
}

/**
 * Test-only: a deterministic verifier that accepts tokens shaped as
 * "stub:<sub>" and returns the claim. Production code should NEVER use
 * this; the smoke suite uses it to exercise the auth path without a
 * real identity provider.
 */
export const stubVerifier: BearerVerifier = async (token) => {
  const m = token.match(/^stub:([^:]+)$/);
  if (!m) throw new Error('not a stub token');
  return { sub: m[1]!, exp: Math.floor(Date.now() / 1000) + 3600 };
};
