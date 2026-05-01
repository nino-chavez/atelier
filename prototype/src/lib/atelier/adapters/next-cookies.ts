// Next.js cookies() -> SsrCookieStore adapter (per ADR-029).
//
// `cookies()` from `next/headers` returns a Next.js-specific store; the
// lens code consumes the framework-agnostic SsrCookieStore so the
// Supabase SSR adapter and any future cookie source (test fixtures,
// alternative frameworks) can plug in without touching session.ts.

import type { SsrCookieStore } from './supabase-ssr.ts';

/**
 * Subset of Next.js's cookie store we need. Typed as `unknown`-wrapping to
 * accept either ReadonlyRequestCookies (Server Components) or
 * RequestCookies (Route Handlers / Middleware) without coupling to the
 * exact Next type, which has overload incompatibilities across versions.
 */
type NextCookieStoreLike = {
  get(name: string): { name: string; value: string } | undefined;
  getAll(): Array<{ name: string; value: string }>;
  // set / delete vary across Next versions; we cast at the call site.
};

/**
 * Wrap a Next.js cookie store as an SsrCookieStore. Writes use a defensive
 * `try` because Server Components cannot mutate cookies during render --
 * the SSR helper always attempts refresh, which is fine to no-op here;
 * the actual refresh happens on the next browser-driven request via a
 * route handler / middleware.
 */
export function nextCookieAdapter(store: NextCookieStoreLike): SsrCookieStore & {
  getAll(): Array<{ name: string; value: string }>;
} {
  type MutableStore = NextCookieStoreLike & {
    set?: (...args: unknown[]) => unknown;
    delete?: (...args: unknown[]) => unknown;
  };
  const mutable = store as MutableStore;
  return {
    get(name: string) {
      const c = store.get(name);
      return c ? { value: c.value } : undefined;
    },
    getAll() {
      return store.getAll();
    },
    set(name: string, value: string, options?: Record<string, unknown>) {
      try {
        mutable.set?.(name, value, options);
      } catch {
        // Read-only render context; refresh writes land on the next
        // browser-driven request.
      }
    },
    delete(name: string, options?: Record<string, unknown>) {
      try {
        mutable.delete?.(name, options);
      } catch {
        // See above.
      }
    },
  };
}
