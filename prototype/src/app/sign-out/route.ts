// /sign-out -- clear the Supabase Auth session cookie (D7).
//
// GET-driven (link-click ergonomics) so the lens header can wire a
// plain anchor. CSRF concern (C2) is filed in BRD-OPEN-QUESTIONS §31
// LOW-severity items; activates when an adopter reports it OR a
// one-form-edit polish lands. Until then, a CSRF-driven sign-out is
// at worst a denial-of-service against the user's own session, which
// the user can recover from instantly by signing in again.

import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { signOutSupabaseSession } from '../../lib/atelier/adapters/supabase-ssr.ts';
import { nextCookieAdapter } from '../../lib/atelier/adapters/next-cookies.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  await signOutSupabaseSession({
    cookies: nextCookieAdapter(cookieStore),
  });
  return NextResponse.redirect(new URL('/', request.url));
}
