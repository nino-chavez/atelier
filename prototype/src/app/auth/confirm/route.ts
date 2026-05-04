// /auth/confirm -- magic-link / email-OTP token-hash verifier (BRD-OQ §31).
//
// Replaces the legacy /sign-in/callback PKCE-exchange route. Supabase Auth's
// email template emits a URL of the shape:
//
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=/atelier
//
// The browser lands here, this route calls
// `supabase.auth.verifyOtp({ type, token_hash })` via the named SSR adapter
// (per ADR-029 the only place the Supabase SSR client is constructed is the
// adapter module), and on success @supabase/ssr seats the session cookies.
//
// The token-hash shape is the recommended pattern per the Supabase docs:
// it does not require the redirect URL to live in the dashboard allowlist,
// and Site URL stays at the app root so OAuth Connectors (separate flow at
// /oauth/api/mcp) keep working unchanged.
//
// Failure modes:
//   - Missing/invalid token_hash or type     -> /sign-in?error=expired
//   - verifyOtp returns an error             -> /sign-in?error=expired
// Both surface a useful inline message in the form via the error= map.

import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import {
  SUPABASE_EMAIL_OTP_TYPES,
  type SupabaseEmailOtpType,
  verifySupabaseOtpWithCookies,
} from '../../../lib/atelier/adapters/supabase-ssr.ts';
import { nextCookieAdapter } from '../../../lib/atelier/adapters/next-cookies.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const typeParam = url.searchParams.get('type');
  const next = sanitizeNext(url.searchParams.get('next'));

  if (!tokenHash || !typeParam || !isValidOtpType(typeParam)) {
    return NextResponse.redirect(new URL('/sign-in?error=expired', request.url));
  }

  const cookieStore = await cookies();
  const result = await verifySupabaseOtpWithCookies({
    cookies: nextCookieAdapter(cookieStore),
    tokenHash,
    type: typeParam,
  });
  if (!result.ok) {
    return NextResponse.redirect(new URL('/sign-in?error=expired', request.url));
  }
  return NextResponse.redirect(new URL(next, request.url));
}

function isValidOtpType(value: string): value is SupabaseEmailOtpType {
  return (SUPABASE_EMAIL_OTP_TYPES as ReadonlyArray<string>).includes(value);
}

function sanitizeNext(raw: string | null): string {
  if (!raw) return '/atelier';
  if (!raw.startsWith('/')) return '/atelier';
  if (raw.startsWith('//')) return '/atelier';
  if (/^\/?[a-z][a-z0-9+.-]*:/i.test(raw)) return '/atelier';
  return raw;
}
