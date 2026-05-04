// /atelier — role-aware default landing.
//
// Resolves the viewer's composer.discipline + access_level via the canonical
// Supabase JS client + atelier_resolve_viewer RPC, then redirects to the
// matching lens. Stakeholder access_level routes to /atelier/stakeholder
// regardless of discipline. Unauthenticated viewers see the auth-required
// state via the [lens]/page.tsx fallback (we redirect to the analyst lens
// which renders the standard auth path).

import { redirect } from 'next/navigation';
import { defaultLensFor } from '../../lib/atelier/lens-config.ts';
import { LensAuthError, resolveLensViewer } from '../../lib/atelier/session.ts';

export const dynamic = 'force-dynamic';

export default async function AtelierIndex() {
  try {
    const viewer = await resolveLensViewer();
    const lens = defaultLensFor({
      discipline: viewer.discipline,
      accessLevel: viewer.accessLevel,
    });
    redirect(`/atelier/${lens}`);
  } catch (err) {
    if (err instanceof LensAuthError) {
      redirect(`/atelier/analyst`);
    }
    throw err;
  }
}
