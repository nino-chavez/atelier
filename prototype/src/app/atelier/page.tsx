// /atelier — role-aware default landing.
//
// Resolves the viewer's composer.discipline and redirects to the matching
// lens. Stakeholder access_level routes to /atelier/stakeholder regardless
// of discipline. Unauthenticated viewers see the auth-required state via
// the [lens]/page.tsx fallback (we redirect to the analyst lens which
// renders the standard auth path).

import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { getLensDeps } from '../../lib/atelier/deps.ts';
import { defaultLensFor } from '../../lib/atelier/lens-config.ts';
import { LensAuthError, resolveLensViewer } from '../../lib/atelier/session.ts';
import { nextCookieAdapter } from '../../lib/atelier/adapters/next-cookies.ts';

export const dynamic = 'force-dynamic';

export default async function AtelierIndex() {
  const deps = getLensDeps();
  const reqHeaders = await headers();
  const cookieStore = await cookies();
  const request = new Request('http://internal/atelier', { headers: reqHeaders });
  try {
    const { auth } = await resolveLensViewer(request, deps, {
      cookies: nextCookieAdapter(cookieStore),
    });
    const accessLevel = await loadAccessLevel(deps, auth.composerId);
    const lens = defaultLensFor({ discipline: auth.discipline, accessLevel });
    redirect(`/atelier/${lens}`);
  } catch (err) {
    if (err instanceof LensAuthError) {
      redirect(`/atelier/analyst`);
    }
    throw err;
  }
}

async function loadAccessLevel(
  deps: ReturnType<typeof getLensDeps>,
  composerId: string,
): Promise<string | null> {
  const pool = (deps.client as unknown as { pool: import('pg').Pool }).pool;
  const { rows } = await pool.query<{ access_level: string }>(
    `SELECT access_level::text AS access_level FROM composers WHERE id = $1`,
    [composerId],
  );
  return rows[0]?.access_level ?? null;
}
