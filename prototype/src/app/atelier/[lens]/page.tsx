// /atelier/[lens] — server-rendered role-aware lens.
//
// Loads the canonical state slice + lens-augmenting queries via
// loadLensViewModel, then renders the lens shell. Each lens is a default-
// view configuration of the same canonical state per ADR-017.

import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import Lens from '../_components/Lens.tsx';
import LensUnauthorized from '../_components/LensUnauthorized.tsx';
import { isLensId } from '../../../lib/atelier/lens-config.ts';
import { loadLensViewModel } from '../../../lib/atelier/lens-data.ts';
import { nextCookieAdapter } from '../../../lib/atelier/adapters/next-cookies.ts';

export const dynamic = 'force-dynamic';

export default async function LensPage({
  params,
}: {
  params: Promise<{ lens: string }>;
}) {
  const { lens } = await params;
  if (!isLensId(lens)) {
    notFound();
  }
  const lensId = lens;
  const reqHeaders = await headers();
  const cookieStore = await cookies();
  const request = new Request(`http://internal/atelier/${lensId}`, { headers: reqHeaders });
  const result = await loadLensViewModel(lensId, request, {
    cookies: nextCookieAdapter(cookieStore),
  });
  if (!result.ok) {
    return <LensUnauthorized lensId={lensId} reason={result.reason} message={result.message} />;
  }
  return <Lens viewModel={result.viewModel} />;
}
