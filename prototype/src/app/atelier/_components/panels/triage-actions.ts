'use server';

// Server actions for the FeedbackQueuePanel (M6 / ADR-018 / migration 9).
//
// Approve creates a contribution from the drafted_proposal payload + UPDATEs
// the triage_pending row. Reject UPDATEs rejected_at + decided_by_composer_id.
// Both actions resolve the viewer composer from the Supabase Auth cookie
// (per ADR-028) -- the panel never trusts client-side composer ids.
//
// Mirrors the find-similar-action.ts pattern: server action calls
// AtelierClient methods directly (no HTTP round-trip to /api/mcp). The
// substrate's authorization guards (cross-project composer rejection,
// already-decided guard) are load-bearing.

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { getLensDeps } from '../../../../lib/atelier/deps.ts';
import { resolveLensViewer } from '../../../../lib/atelier/session.ts';
import { nextCookieAdapter } from '../../../../lib/atelier/adapters/next-cookies.ts';

export interface TriageActionResult {
  ok: boolean;
  triagePendingId: string;
  /** Set on successful approve. */
  contributionId?: string;
  /** Set on failure. */
  error?: { code: string; message: string };
}

export async function approveTriageDraft(
  triagePendingId: string,
): Promise<TriageActionResult> {
  return executeAction(triagePendingId, async (client, viewerComposerId) => {
    const result = await client.triagePendingApprove({
      triagePendingId,
      approverComposerId: viewerComposerId,
    });
    return {
      ok: true,
      triagePendingId: result.triagePendingId,
      contributionId: result.contributionId,
    };
  });
}

export async function rejectTriageDraft(
  triagePendingId: string,
  reason?: string,
): Promise<TriageActionResult> {
  return executeAction(triagePendingId, async (client, viewerComposerId) => {
    const result = await client.triagePendingReject({
      triagePendingId,
      rejecterComposerId: viewerComposerId,
      ...(reason !== undefined && reason.trim().length > 0 ? { reason: reason.trim() } : {}),
    });
    return {
      ok: true,
      triagePendingId: result.triagePendingId,
    };
  });
}

async function executeAction(
  triagePendingId: string,
  action: (
    client: import('../../../../../../scripts/sync/lib/write.ts').AtelierClient,
    viewerComposerId: string,
  ) => Promise<TriageActionResult>,
): Promise<TriageActionResult> {
  const trimmedId = (triagePendingId ?? '').trim();
  if (trimmedId.length === 0) {
    return {
      ok: false,
      triagePendingId: trimmedId,
      error: { code: 'BAD_REQUEST', message: 'triagePendingId is required' },
    };
  }

  const deps = getLensDeps();
  const cookieStore = await cookies();
  let viewerComposerId: string;
  try {
    const viewerCtx = await resolveLensViewer(
      new Request('http://internal/triage-action'),
      deps,
      { cookies: nextCookieAdapter(cookieStore) },
    );
    viewerComposerId = viewerCtx.auth.composerId;
  } catch (err) {
    return {
      ok: false,
      triagePendingId: trimmedId,
      error: {
        code: 'FORBIDDEN',
        message: err instanceof Error ? err.message : 'auth resolution failed',
      },
    };
  }

  try {
    const result = await action(deps.client, viewerComposerId);
    // Revalidate the lens page so the panel re-renders without the
    // just-decided row in the pending list.
    revalidatePath('/atelier');
    return result;
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'INTERNAL';
    const message =
      err instanceof Error ? err.message : 'unknown error';
    return {
      ok: false,
      triagePendingId: trimmedId,
      error: { code, message },
    };
  }
}
