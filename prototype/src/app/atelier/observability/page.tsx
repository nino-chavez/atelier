// /atelier/observability - admin-gated monitoring dashboard.
//
// Per ARCH 8.2 - eight sections: sessions, contributions, locks,
// decisions, triage, sync, vector index, cost. Each renders from
// the canonical datastore via loadObservabilityViewModel.
//
// Different surface from the coordination lenses:
//   - SSR initial render
//   - Client-side 30s poll (Refresher island) re-runs the route
//   - Manual refresh button forces an immediate re-run
//   - No broadcast subscription (operator-driven monitoring; freshness
//     is the value, not write contention)
//
// Tab selection via ?tab= search param keeps the affordance shape
// of /atelier 5-lens precedent without per-route file proliferation.
// All section data still loads on every render - the cost is bounded
// (~8 indexed queries) and the operator's reload toggles the section
// they care about.

import { cookies, headers } from 'next/headers';
import { getLensDeps } from '../../../lib/atelier/deps.ts';
import { nextCookieAdapter } from '../../../lib/atelier/adapters/next-cookies.ts';
import { LensAuthError } from '../../../lib/atelier/session.ts';
import {
  ObservabilityForbiddenError,
  resolveObservabilityViewer,
} from '../../../lib/atelier/observability-session.ts';
import { loadObservabilityViewModel } from '../../../lib/atelier/observability-data.ts';
import LensUnauthorized from '../_components/LensUnauthorized.tsx';
import ObservabilityShell from './_components/ObservabilityShell.tsx';
import { isSectionId, type SectionId } from './sections.ts';

export const dynamic = 'force-dynamic';

export default async function ObservabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const tab: SectionId = isSectionId(params.tab ?? '') ? (params.tab as SectionId) : 'sessions';

  const deps = getLensDeps();
  const reqHeaders = await headers();
  const cookieStore = await cookies();
  const request = new Request(`http://internal/atelier/observability?tab=${tab}`, {
    headers: reqHeaders,
  });

  let viewer: Awaited<ReturnType<typeof resolveObservabilityViewer>>;
  try {
    viewer = await resolveObservabilityViewer(request, deps, {
      cookies: nextCookieAdapter(cookieStore),
    });
  } catch (err) {
    if (err instanceof LensAuthError) {
      return <LensUnauthorized lensId="observability" reason={err.kind} message={err.message} />;
    }
    if (err instanceof ObservabilityForbiddenError) {
      return (
        <LensUnauthorized
          lensId="observability"
          reason="invalid_bearer"
          message={err.message}
        />
      );
    }
    throw err;
  }

  const viewModel = await loadObservabilityViewModel(viewer.auth.projectId);
  return (
    <ObservabilityShell
      tab={tab}
      viewer={{
        composerName: viewer.composerName,
        projectName: viewer.projectName,
        sessionIdShort: viewer.sessionId.slice(0, 8),
      }}
      viewModel={viewModel}
    />
  );
}
