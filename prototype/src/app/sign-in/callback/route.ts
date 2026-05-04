// /sign-in/callback -- magic-link PKCE exchange (D7).
//
// Supabase Auth's email link points here with `?code=<pkce>` (and the
// originally-requested redirect threaded through `?redirect=`). The
// route exchanges the code for a session cookie via @supabase/ssr (in
// the named adapter per ADR-029) and bounces the user to the redirect.
//
// Failure modes:
//   - Missing code              -> /sign-in?error=expired
//   - exchangeCodeForSession    -> /sign-in?error=exchange_failed
// Both surface a useful inline message in the form via the error= map.

import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { exchangeSupabaseCodeForSession } from '../../../lib/atelier/adapters/supabase-ssr.ts';
import { nextCookieAdapter } from '../../../lib/atelier/adapters/next-cookies.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const redirectParam = url.searchParams.get('redirect') ?? '/atelier';
  const redirectTo = sanitizeRedirect(redirectParam);

  if (!code) {
    return NextResponse.redirect(new URL('/sign-in?error=expired', request.url));
  }

  const cookieStore = await cookies();
  const result = await exchangeSupabaseCodeForSession({
    code,
    cookies: nextCookieAdapter(cookieStore),
  });
  if (!result.ok) {
    return NextResponse.redirect(
      new URL('/sign-in?error=exchange_failed', request.url),
    );
  }
  return NextResponse.redirect(new URL(redirectTo, request.url));
}

/**
 * Same restriction as the form: same-origin paths only.
 */
function sanitizeRedirect(raw: string): string {
  if (!raw.startsWith('/')) return '/atelier';
  if (raw.startsWith('//')) return '/atelier';
  if (/^\/?[a-z][a-z0-9+.-]*:/i.test(raw)) return '/atelier';
  return raw;
}
