// Lens-side viewer + session resolution (post canonical-rebuild).
//
// The canonical Supabase pattern: createServerSupabaseClient(cookies) →
// PostgREST forwards the user's JWT → SECURITY DEFINER RPC reads
// auth.jwt() and resolves the composer. No pg.Pool, no JWKS verifier
// invocation in the lens path.
//
// Two RPCs do the work:
//   atelier_resolve_viewer()           → composer + project info, used by
//                                        callers that need just the viewer
//                                        without the full lens VM.
//   atelier_ensure_dashboard_session() → returns session_id (find-or-create
//                                        with 5-minute heartbeat reuse).
//
// Auth surface for legacy server actions:
//   The dispatch() path (find-similar lens action) still needs a bearer
//   to hand to the MCP-side AtelierClient. resolveBearer() reads the
//   same Supabase Auth cookie via @supabase/ssr and returns the JWT
//   string. The MCP route's JWKS verifier validates it identically.

import { cookies as nextCookies } from 'next/headers';

import {
  createServerSupabaseClient,
  readSupabaseAccessToken,
  type ServerSupabaseClient,
  type SsrCookieStore,
} from './adapters/supabase-ssr.ts';
import { nextCookieAdapter } from './adapters/next-cookies.ts';

export class LensAuthError extends Error {
  override readonly name = 'LensAuthError';
  constructor(
    readonly kind: 'no_bearer' | 'invalid_bearer' | 'no_composer',
    message: string,
  ) {
    super(message);
  }
}

export interface ResolveBearerOptions {
  /**
   * Cookie store, request-scoped. In Next.js this is the result of
   * `cookies()` from `next/headers`. The adapter never imports
   * `next/headers` directly so the lens code stays unit-testable and
   * GCP-portable per ADR-029.
   */
  cookies: SsrCookieStore | null;
}

/**
 * Resolve the bearer token for the current request.
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
export async function resolveBearer(
  _request: Request,
  opts: ResolveBearerOptions,
): Promise<string | null> {
  if (opts.cookies) {
    try {
      const token = await readSupabaseAccessToken({ cookies: opts.cookies });
      if (token) return token;
    } catch (err) {
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

export interface LensViewerContext {
  composerId: string;
  composerName: string;
  composerEmail: string;
  discipline: string | null;
  accessLevel: string | null;
  projectId: string;
  projectName: string;
  identitySubject: string;
  sessionId: string;
}

interface ViewerRow {
  composer_id: string;
  project_id: string;
  display_name: string;
  email: string;
  discipline: string | null;
  access_level: string | null;
  identity_subject: string;
}

/**
 * Construct a Supabase client tied to the Next.js request scope.
 *
 * Routes that already have a request-scoped cookie store from `cookies()`
 * pass it via `cookieStore`; thin shims (server actions inside `'use server'`
 * functions) call `getRequestSupabaseClient()` which does the cookies()
 * + nextCookieAdapter() wiring inline.
 */
export async function getRequestSupabaseClient(): Promise<ServerSupabaseClient> {
  const cookieStore = await nextCookies();
  return createServerSupabaseClient({ cookies: nextCookieAdapter(cookieStore) });
}

/**
 * Resolve the lens viewer end-to-end through the canonical RPC path.
 * Returns composer + project + dashboard session_id for the caller.
 */
export async function resolveLensViewer(
  client?: ServerSupabaseClient,
): Promise<LensViewerContext> {
  const supabase = client ?? (await getRequestSupabaseClient());

  const { data: viewerRows, error: viewerErr } = await supabase.rpc<
    Record<string, never>,
    ViewerRow[]
  >('atelier_resolve_viewer');
  if (viewerErr) {
    throw new LensAuthError(
      'invalid_bearer',
      `atelier_resolve_viewer failed: ${viewerErr.message}`,
    );
  }
  const viewer = viewerRows?.[0];
  if (!viewer) {
    throw new LensAuthError(
      'no_composer',
      'No active composer for the current Auth session. Ask your admin to invite you.',
    );
  }

  const { data: sessionId, error: sessionErr } = await supabase.rpc<
    Record<string, never>,
    string
  >('atelier_ensure_dashboard_session');
  if (sessionErr || typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new LensAuthError(
      'invalid_bearer',
      `atelier_ensure_dashboard_session failed: ${sessionErr?.message ?? 'no session id returned'}`,
    );
  }

  // Resolve project name in a single PostgREST call. The RPC returns the
  // project_id; the project name is needed for the lens header.
  const { data: projectRows, error: projectErr } = await supabase
    .from('projects')
    .select('name')
    .eq('id', viewer.project_id);
  if (projectErr) {
    throw new LensAuthError(
      'invalid_bearer',
      `projects lookup failed: ${projectErr.message}`,
    );
  }
  const projectName = (projectRows?.[0] as { name?: string } | undefined)?.name ?? 'Atelier';

  return {
    composerId: viewer.composer_id,
    composerName: viewer.display_name,
    composerEmail: viewer.email,
    discipline: viewer.discipline,
    accessLevel: viewer.access_level,
    projectId: viewer.project_id,
    projectName,
    identitySubject: viewer.identity_subject,
    sessionId,
  };
}
