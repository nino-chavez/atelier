// Atelier prototype middleware (canonical Supabase Next.js pattern).
//
// Per https://supabase.com/docs/guides/auth/server-side/nextjs the middleware
// is responsible for refreshing the user's Auth session on every navigation.
// Without this the access_token cookie can become stale (the SSR helper
// cannot rotate cookies during a Server Component render), and the lens
// then redirects to the unauthorized state on subsequent requests.
//
// What this does:
//   1. Construct a request-scoped Supabase client that reads + writes the
//      Auth cookie envelope on the response.
//   2. Call supabase.auth.getUser() — the canonical refresh trigger; the
//      SSR helper handles silent token rotation under the hood.
//   3. Forward the request with the refreshed cookies attached.
//
// Per ADR-029 only the named adapter under prototype/src/lib/atelier/
// adapters/ may import @supabase/ssr. The middleware sits at
// prototype/middleware.ts (Next.js convention) and is the one place outside
// the adapter directory that needs the SSR helper. We keep the surface
// minimal — just the canonical refresh — to limit the divergence.
//
// Matcher excludes /api routes (the MCP endpoint authenticates with bearer
// JWT in the Authorization header, not cookie sessions; running the SSR
// refresh on those routes would be wasted work + an unnecessary Supabase
// Auth round-trip on every MCP call).

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without env, fail open (the lens will fail closed on its own request-
  // time check). The middleware should not 500 the entire site for missing
  // env in a deploy-misconfigured state.
  if (!supabaseUrl || !publishableKey) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Trigger silent token refresh. Result intentionally unused — the side
  // effect (cookie rotation via setAll above) is the load-bearing part.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Match every navigation except:
    //   - /api/*  (MCP routes; bearer auth, no cookies)
    //   - Next.js static asset paths (_next/static, _next/image)
    //   - the favicon
    //   - any common static file extension (svg, png, jpg, gif, ico, webp, woff2)
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2|css)$).*)',
  ],
};
