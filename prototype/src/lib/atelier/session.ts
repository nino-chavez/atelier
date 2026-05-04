// Lens-side bearer + session resolution.
//
// The lens path needs:
//   1. A bearer token to identify the viewing composer.
//   2. An Atelier session_id (from sessions table) to feed get_context.
//
// Bearer resolution:
//   - Production: read Supabase Auth cookie via @supabase/ssr (per ADR-028).
//     The browser client sets the cookie on sign-in; the server reads it
//     with the SSR helper and passes session.access_token as the bearer.
//     The Supabase-specific implementation is wrapped in a named adapter
//     (./adapters/supabase-ssr.ts) per ADR-029. The same JWT then validates
//     through the JWKS verifier path the /api/mcp endpoint already uses --
//     verified end-to-end against real Supabase Auth by
//     scripts/endpoint/__smoke__/real-client.smoke.ts.
//   - Development: ATELIER_DEV_BEARER env (e.g. "stub:sub-dev") routed
//     through stubVerifier in deps.ts. Explicitly env-guarded -- not a
//     silent fallback. Set ATELIER_ALLOW_DEV_BEARER=true alongside the
//     bearer to opt-in; otherwise the dev path is skipped even when
//     ATELIER_DEV_BEARER is present.
//
// Session resolution:
//   The dashboard runs server-side and would otherwise create a fresh
//   sessions row on every page render. Instead we reuse an active
//   web-surface session keyed on (composer_id, agent_client='atelier-
//   dashboard') with a 5-minute heartbeat window. Concurrent renders
//   race-tolerantly (UNIQUE not enforced; reaper sweeps duplicates).

import { Pool } from 'pg';
import {
  authenticate,
  type AuthContext,
} from '../../../../scripts/endpoint/lib/auth.ts';
import { AtelierClient, AtelierError } from '../../../../scripts/sync/lib/write.ts';
import type { LensDeps } from './deps.ts';
import {
  readSupabaseAccessToken,
  type SsrCookieStore,
} from './adapters/supabase-ssr.ts';

const DASHBOARD_AGENT_CLIENT = 'atelier-dashboard';
const DASHBOARD_HEARTBEAT_WINDOW_MINUTES = 5;

export class LensAuthError extends Error {
  override readonly name = 'LensAuthError';
  constructor(
    readonly kind: 'no_bearer' | 'invalid_bearer' | 'no_composer',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Resolve the bearer token for the current request. Returns null if no
 * session is present (anonymous request); the caller renders an
 * unauthorized state.
 *
 * Resolution order:
 *   1. Supabase Auth cookie via @supabase/ssr (production + non-test
 *      deployments). Wraps the Supabase-specific bits in a named adapter
 *      per ADR-029.
 *   2. ATELIER_DEV_BEARER env, but only when ATELIER_ALLOW_DEV_BEARER=true
 *      is also set. The opt-in gate prevents a stray env var in a prod
 *      container from silently bypassing real auth.
 *
 * Callers in code that does not run under Next.js (smoke tests, internal
 * tooling) pass `cookies: null` to skip the SSR cookie path.
 */
export interface ResolveBearerOptions {
  /**
   * Cookie store, request-scoped. In Next.js this is the result of
   * `cookies()` from `next/headers`. The adapter never imports
   * `next/headers` directly so the lens code stays unit-testable and
   * GCP-portable per ADR-029.
   */
  cookies: SsrCookieStore | null;
}

export async function resolveBearer(
  _request: Request,
  opts: ResolveBearerOptions,
): Promise<string | null> {
  if (opts.cookies) {
    try {
      const token = await readSupabaseAccessToken({ cookies: opts.cookies });
      if (token) return token;
    } catch (err) {
      // Misconfigured Supabase env -> fall through to dev path or null.
      // Do NOT swallow silently in production: the dev gate below requires
      // an explicit opt-in env var, so the caller will still see a clean
      // unauthorized error if no fallback is enabled.
      console.warn('[lens] Supabase SSR cookie read failed:', (err as Error).message);
    }
  }
  if (
    process.env.ATELIER_ALLOW_DEV_BEARER === 'true' &&
    process.env.ATELIER_DEV_BEARER &&
    process.env.ATELIER_DEV_BEARER.length > 0
  ) {
    return process.env.ATELIER_DEV_BEARER;
  }
  return null;
}

/**
 * Find or create a dashboard session for the authenticated composer.
 *
 * Reuses an active web-surface session with agent_client='atelier-dashboard'
 * within the heartbeat window; otherwise inserts a fresh row. Heartbeats
 * the session on reuse so the reaper does not sweep an in-flight render.
 *
 * The implicit web surface here is the dashboard itself. agent_client is
 * fixed to DASHBOARD_AGENT_CLIENT so dashboard-driven sessions are easily
 * distinguishable from agent-driven (claude.ai, claude-code, cursor) ones
 * in the sessions table.
 */
export async function ensureDashboardSession(
  client: AtelierClient,
  auth: AuthContext,
): Promise<string> {
  const pool = (client as unknown as { pool: Pool }).pool;
  const reuse = await pool.query<{ id: string }>(
    `SELECT id FROM sessions
      WHERE composer_id = $1
        AND project_id = $2
        AND surface = 'web'
        AND agent_client = $3
        AND status = 'active'
        AND heartbeat_at > now() - ($4 || ' minutes')::interval
      ORDER BY heartbeat_at DESC
      LIMIT 1`,
    [auth.composerId, auth.projectId, DASHBOARD_AGENT_CLIENT, DASHBOARD_HEARTBEAT_WINDOW_MINUTES],
  );
  const existing = reuse.rows[0]?.id;
  if (existing) {
    await pool.query(
      `UPDATE sessions SET heartbeat_at = now(), status = 'active' WHERE id = $1`,
      [existing],
    );
    return existing;
  }
  const insert = await pool.query<{ id: string }>(
    `INSERT INTO sessions (project_id, composer_id, surface, agent_client)
     VALUES ($1, $2, 'web', $3) RETURNING id`,
    [auth.projectId, auth.composerId, DASHBOARD_AGENT_CLIENT],
  );
  const id = insert.rows[0]?.id;
  if (!id) throw new AtelierError('INTERNAL', 'dashboard session insert returned no row');
  return id;
}

/**
 * Resolve the lens viewer end-to-end: bearer → AuthContext → dashboard
 * session_id. Throws LensAuthError on any failure path so the page can
 * render a clean unauthorized state.
 */
export async function resolveLensViewer(
  request: Request,
  deps: LensDeps,
  opts: ResolveBearerOptions,
): Promise<{ auth: AuthContext; sessionId: string; bearer: string }> {
  const bearer = await resolveBearer(request, opts);
  if (!bearer) {
    throw new LensAuthError(
      'no_bearer',
      'No bearer token. Sign in to view the coordination dashboard.',
    );
  }
  let auth: AuthContext;
  try {
    const pool = (deps.client as unknown as { pool: Pool }).pool;
    auth = await authenticate(bearer, deps.verifier, pool);
  } catch (err) {
    if (err instanceof AtelierError && err.code === 'FORBIDDEN') {
      // The auth.ts FORBIDDEN path covers two distinct failures:
      //   1. JWT invalid (bad signature, wrong audience/issuer, expired)
      //   2. JWT valid but no composer row matches identity_subject
      // Differentiate so adopters who magic-link-sign-in without an
      // invitation see "ask your admin to invite you" instead of a
      // generic "bearer rejected" diagnostic. The string match is
      // load-bearing -- auth.ts emits exactly "no active composer
      // for identity_subject <sub>" for case 2.
      const kind = err.message.includes('no active composer') ? 'no_composer' : 'invalid_bearer';
      throw new LensAuthError(kind, err.message);
    }
    throw new LensAuthError(
      'invalid_bearer',
      `Bearer validation failed: ${(err as Error).message}`,
    );
  }
  const sessionId = await ensureDashboardSession(deps.client, auth);
  return { auth, sessionId, bearer };
}
