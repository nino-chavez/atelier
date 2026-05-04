'use server';

// Server actions for the FeedbackQueuePanel (M6 / ADR-018 / migration 9).
//
// Approve creates a contribution from the drafted_proposal payload + UPDATEs
// the triage_pending row. Reject UPDATEs rejected_at + decided_by_composer_id.
// Both actions resolve the viewer composer through the canonical Supabase JS
// client → atelier_resolve_viewer RPC; the panel never trusts client-side
// composer ids.
//
// The triage approve/reject operations themselves still flow through
// AtelierClient.triagePendingApprove/Reject which holds the multi-table
// transaction (insert contribution + UPDATE triage_pending). Per the
// canonical-rebuild brief, /api/mcp transport stays out of scope; the
// AtelierClient living under scripts/sync/lib/ is not a pg.Pool import
// in prototype/src/. The client is reused through getMcpDeps()'s warm
// singleton so we don't double-allocate connections.

import { revalidatePath } from 'next/cache';

import { getMcpDeps } from '../../../../lib/atelier/mcp-deps.ts';
import {
  LensAuthError,
  resolveLensViewer,
} from '../../../../lib/atelier/session.ts';

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
  return executeAction(triagePendingId, async (viewerComposerId) => {
    const result = await getMcpDeps().client.triagePendingApprove({
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
  return executeAction(triagePendingId, async (viewerComposerId) => {
    const result = await getMcpDeps().client.triagePendingReject({
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
  action: (viewerComposerId: string) => Promise<TriageActionResult>,
): Promise<TriageActionResult> {
  const trimmedId = (triagePendingId ?? '').trim();
  if (trimmedId.length === 0) {
    return {
      ok: false,
      triagePendingId: trimmedId,
      error: { code: 'BAD_REQUEST', message: 'triagePendingId is required' },
    };
  }

  let viewerComposerId: string;
  try {
    const viewer = await resolveLensViewer();
    viewerComposerId = viewer.composerId;
  } catch (err) {
    return {
      ok: false,
      triagePendingId: trimmedId,
      error: {
        code: err instanceof LensAuthError ? err.kind.toUpperCase() : 'FORBIDDEN',
        message: err instanceof Error ? err.message : 'auth resolution failed',
      },
    };
  }

  try {
    const result = await action(viewerComposerId);
    revalidatePath('/atelier');
    return result;
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'INTERNAL';
    const message = err instanceof Error ? err.message : 'unknown error';
    return {
      ok: false,
      triagePendingId: trimmedId,
      error: { code, message },
    };
  }
}
