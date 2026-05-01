// Lens-side dispatcher dependencies.
//
// The /atelier route fetches data via dispatch() in-process per the M3 brief
// (option a: server actions / server components call the dispatcher directly,
// avoiding an HTTP round trip to /api/mcp). This module owns the AtelierClient
// pool + bearer verifier singletons used by the lens path.
//
// The /api/mcp route (prototype/src/app/api/mcp/route.ts) keeps its own local
// singletons; intentionally not unified at M3 to keep the blast radius small
// (the route is M2-mid working code). If a future change needs both consumers
// to share state, factor the shared bits up here.

import { AtelierClient } from '../../../../scripts/sync/lib/write.ts';
import type { BearerVerifier } from '../../../../scripts/endpoint/lib/auth.ts';
import { stubVerifier } from '../../../../scripts/endpoint/lib/auth.ts';
import { jwksVerifierFromEnv } from '../../../../scripts/endpoint/lib/jwks-verifier.ts';

/**
 * Module-scoped singletons. Next.js reuses these across page renders within
 * a warm container (and across server-action invocations). Cold starts
 * recreate them; that is the expected pg pool lifecycle.
 */
let cachedClient: AtelierClient | null = null;
let cachedVerifier: BearerVerifier | null = null;

export interface LensDeps {
  client: AtelierClient;
  verifier: BearerVerifier;
}

/**
 * Resolve the client + verifier the lens code uses for dispatch() calls.
 *
 * Verifier mode:
 *   - Production: ATELIER_OIDC_ISSUER + ATELIER_JWT_AUDIENCE present →
 *     remote-JWKS verifier (real Supabase Auth or any OIDC provider).
 *   - Development: ATELIER_DEV_BEARER + ATELIER_ALLOW_DEV_BEARER=true →
 *     stub verifier accepts tokens shaped "stub:<sub>". The opt-in env gate
 *     prevents a stray dev var in a prod container from silently bypassing
 *     real auth. See `prototype/src/lib/atelier/session.ts:resolveBearer`
 *     for the cookie-vs-stub resolution order.
 */
export function getLensDeps(): LensDeps {
  if (cachedClient && cachedVerifier) {
    return { client: cachedClient, verifier: cachedVerifier };
  }
  if (!cachedClient) {
    const databaseUrl = process.env.ATELIER_DATASTORE_URL ?? process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        'ATELIER_DATASTORE_URL (or DATABASE_URL) not set; the /atelier lens cannot connect to the coordination datastore (ARCH 9.3)',
      );
    }
    cachedClient = new AtelierClient({ databaseUrl });
  }
  if (!cachedVerifier) {
    cachedVerifier = resolveVerifier();
  }
  return { client: cachedClient, verifier: cachedVerifier };
}

function resolveVerifier(): BearerVerifier {
  const oidcIssuer = process.env.ATELIER_OIDC_ISSUER;
  const oidcAudience = process.env.ATELIER_JWT_AUDIENCE;
  if (oidcIssuer && oidcAudience) {
    return jwksVerifierFromEnv();
  }
  if (process.env.ATELIER_DEV_BEARER) {
    return stubVerifier;
  }
  throw new Error(
    'No bearer verifier configured. Set ATELIER_OIDC_ISSUER + ATELIER_JWT_AUDIENCE (production) or ATELIER_DEV_BEARER (development).',
  );
}
