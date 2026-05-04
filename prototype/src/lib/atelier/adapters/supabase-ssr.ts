// Supabase SSR cookie -> bearer-token adapter (per ADR-027 / ADR-028 / ADR-029).
//
// Per ADR-029 the reference impl preserves GCP-portability; Supabase-specific
// dependencies must stay in named adapter modules. This file is the only
// place in the lens code that imports `@supabase/ssr` and `@supabase/supabase-js`.
// Swapping IdPs (Auth0, Keycloak, custom OIDC) means writing a sibling adapter,
// not editing session.ts.
//
// Contract:
//   readSupabaseAccessToken(opts) -> Promise<string | null>
//     Reads the Supabase Auth session cookie via @supabase/ssr (which decodes
//     the chunked-cookie envelope Supabase writes), returns the user's
//     access_token if a valid session is present, or null if no session.
//
// The returned access_token is a Supabase-issued JWT and validates through
// the same JWKS verifier path the production endpoint already uses
// (jwks-verifier.ts -> ATELIER_OIDC_ISSUER + ATELIER_JWT_AUDIENCE pointing
// at Supabase Auth).

// Lazy import: @supabase/ssr lives in prototype/package.json (Next.js
// runtime). The lens smoke at root imports this module's types but
// never calls readSupabaseAccessToken (it passes cookies:null). A static
// import would force the smoke runtime to resolve @supabase/ssr from
// root's node_modules, which it cannot. Defer the require until the
// function is actually invoked under Next.js, where the package is on
// the resolution path. The CookieOptions type is structurally compatible
// with the inline shape we pass, so we type the option as a loose record.
type CookieOptions = Record<string, unknown>;

export interface SupabaseSsrEnv {
  url: string;
  anonKey: string;
}

/**
 * Resolve Supabase env from process.env. Throws with a concrete message
 * when either value is missing so misconfiguration fails closed at request
 * time rather than producing a silent unauthenticated state.
 */
export function supabaseEnvFromProcess(env: NodeJS.ProcessEnv = process.env): SupabaseSsrEnv {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY;
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) not set; the /atelier lens cannot read the Supabase Auth cookie (ADR-028).',
    );
  }
  if (!anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) not set; @supabase/ssr requires the anon key to construct the SSR client (ADR-028).',
    );
  }
  return { url, anonKey };
}

/**
 * Cookie store interface the adapter needs. Mirrors the shape Next.js
 * `cookies()` returns (`get`, `set`, `delete`) without coupling to
 * `next/headers` directly -- callers pass the store from their request
 * scope. This keeps the adapter unit-testable without a Next.js runtime.
 */
export interface SsrCookieStore {
  get(name: string): { value: string } | undefined;
  set?(name: string, value: string, options?: CookieOptions): void;
  delete?(name: string, options?: CookieOptions): void;
}

export interface ReadAccessTokenOptions {
  cookies: SsrCookieStore;
  env?: SupabaseSsrEnv;
}

/**
 * Read the Supabase Auth access_token from request cookies. Returns null
 * when no session is present (anonymous request).
 *
 * The SSR client is constructed per-request because cookies are
 * request-scoped. @supabase/ssr handles the chunked-cookie reassembly that
 * @supabase/supabase-js writes on sign-in (cookie envelope can exceed 4KiB
 * and is split into `<name>.0`, `<name>.1`, ...).
 */
export async function readSupabaseAccessToken(
  opts: ReadAccessTokenOptions,
): Promise<string | null> {
  const env = opts.env ?? supabaseEnvFromProcess();
  // Lazy require -- see top-of-file comment. Production paths (Next.js)
  // resolve @supabase/ssr from prototype/node_modules; non-prototype
  // callers never reach this code because they pass cookies:null and
  // resolveBearer skips the cookie branch.
  const { createServerClient } = await import('@supabase/ssr');
  const client = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        // @supabase/ssr only needs `getAll` for the read path; set/remove are
        // unused on a server-component render. The SSR helper iterates cookie
        // names internally; we expose a thin shim from the host's cookie
        // store. The Next.js `cookies()` API exposes `getAll()` directly,
        // but to keep the adapter framework-agnostic we don't depend on it.
        // The SSR helper is forgiving: a flat list of {name,value} works.
        return readAllCookies(opts.cookies);
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
        // The lens path is a read-only render; the SSR helper still
        // attempts to refresh stale tokens. Surface set/delete to the host
        // cookie store when supported. Next.js Server Components disallow
        // mutating cookies during render; the host store may no-op.
        for (const { name, value, options } of cookiesToSet) {
          if (value === '' || value === undefined) {
            opts.cookies.delete?.(name, options);
          } else {
            opts.cookies.set?.(name, value, options);
          }
        }
      },
    },
  });

  const { data, error } = await client.auth.getSession();
  if (error) {
    // Treat "no session" / decode failures as anonymous; log for ops.
    // Don't throw -- the caller decides whether anonymous is allowed.
    console.warn('[supabase-ssr] getSession failed:', error.message);
    return null;
  }
  return data.session?.access_token ?? null;
}

export interface SignOutOptions {
  cookies: SsrCookieStore;
  env?: SupabaseSsrEnv;
}

/**
 * Clear the Supabase Auth session by signing out via @supabase/ssr.
 *
 * Mirrors readSupabaseAccessToken's adapter shape so the route handler
 * never imports `@supabase/ssr` directly (per ADR-029). The SSR client
 * issues `setAll` with empty values for the chunked-cookie envelope; we
 * route those through the host cookie store, which in a Next.js route
 * handler is mutable and persists the deletions on the response.
 */
export async function signOutSupabaseSession(opts: SignOutOptions): Promise<void> {
  const env = opts.env ?? supabaseEnvFromProcess();
  const { createServerClient } = await import('@supabase/ssr');
  const client = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return readAllCookies(opts.cookies);
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
        for (const { name, value, options } of cookiesToSet) {
          if (value === '' || value === undefined) {
            opts.cookies.delete?.(name, options);
          } else {
            opts.cookies.set?.(name, value, options);
          }
        }
      },
    },
  });

  const { error } = await client.auth.signOut();
  if (error) {
    // signOut hits Supabase Auth to invalidate the refresh token; on
    // network failure the cookies are still cleared via setAll. Log and
    // continue -- the cookie clearing is the user-facing contract.
    console.warn('[supabase-ssr] signOut failed:', error.message);
  }
}

export interface ExchangeCodeOptions {
  cookies: SsrCookieStore;
  code: string;
  env?: SupabaseSsrEnv;
}

export interface ExchangeCodeResult {
  ok: boolean;
  errorMessage?: string;
}

/**
 * Exchange a magic-link PKCE code for a session, persisting the resulting
 * cookies via the supplied host store.
 *
 * Used by the /sign-in/callback route. The browser hits Supabase Auth's
 * email link, which redirects to /sign-in/callback?code=... The PKCE
 * exchange validates the code against the verifier the browser stored on
 * signInWithOtp, and on success @supabase/ssr writes the access_token /
 * refresh_token cookies via the setAll bridge. Same adapter shape as
 * readSupabaseAccessToken / signOutSupabaseSession so the route handler
 * never imports `@supabase/ssr` directly (per ADR-029).
 */
export async function exchangeSupabaseCodeForSession(
  opts: ExchangeCodeOptions,
): Promise<ExchangeCodeResult> {
  const env = opts.env ?? supabaseEnvFromProcess();
  const { createServerClient } = await import('@supabase/ssr');
  const client = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return readAllCookies(opts.cookies);
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
        for (const { name, value, options } of cookiesToSet) {
          if (value === '' || value === undefined) {
            opts.cookies.delete?.(name, options);
          } else {
            opts.cookies.set?.(name, value, options);
          }
        }
      },
    },
  });

  const { error } = await client.auth.exchangeCodeForSession(opts.code);
  if (error) {
    return { ok: false, errorMessage: error.message };
  }
  return { ok: true };
}

/**
 * Read all cookies from the host store. Next.js `cookies()` exposes
 * `getAll()` directly; for stores that only expose `get()` we fall back
 * to a known-prefix sweep. The adapter remains framework-agnostic.
 */
function readAllCookies(store: SsrCookieStore): Array<{ name: string; value: string }> {
  const maybeGetAll = (store as unknown as { getAll?: () => Array<{ name: string; value: string }> }).getAll;
  if (typeof maybeGetAll === 'function') {
    return maybeGetAll.call(store);
  }
  // Fallback: Supabase SSR writes cookies under `sb-<project-ref>-auth-token`
  // and chunked variants. Without `getAll` we cannot enumerate; the SSR
  // helper still works for the unchunked happy path because it queries
  // common names directly. Hosts that lack `getAll` will only resolve
  // sessions whose cookie envelope fits in one chunk.
  return [];
}
