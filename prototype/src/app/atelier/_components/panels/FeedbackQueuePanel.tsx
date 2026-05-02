// Feedback queue — pending triage drafts awaiting human classification
// (M6 / ADR-018 / migration 9 / ARCH §6.5.2).
//
// Reads from viewModel.feedbackQueue (loaded by lens-data.ts via
// AtelierClient.triagePendingList). Approve/reject affordances use the
// server actions in triage-actions.ts.
//
// Routing per ADR-025: a draft's approval surface is gated by the
// territory's review_role (or owner_role when null). Drafts NOT routed
// to the viewer's discipline render read-only with a "routed to <role>"
// hint. The substrate enforces this at the action level (cross-project
// approver -> FORBIDDEN); the UI hint exists for ergonomics, not
// security.

'use client';

import { useState, useTransition } from 'react';

import type { FeedbackEntry } from '../../../../lib/atelier/lens-data.ts';
import {
  approveTriageDraft,
  rejectTriageDraft,
  type TriageActionResult,
} from './triage-actions.ts';
import styles from './Panel.module.css';

export default function FeedbackQueuePanel({
  entries,
  viewerDiscipline,
}: {
  entries: FeedbackEntry[];
  viewerDiscipline: string | null;
}) {
  return (
    <section className={`${styles.panel} ${styles.panelWide}`}>
      <div className={styles.head}>
        <h2 className={styles.title}>Feedback queue</h2>
        <span className={styles.count}>{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className={styles.empty}>
          No pending triage drafts. New external comments (Figma, GitHub PR
          discussions, etc.) below the classifier confidence threshold land
          here for human classification per ADR-018.
        </div>
      ) : (
        <ul className={styles.list}>
          {entries.map((entry) => (
            <FeedbackRow
              key={entry.id}
              entry={entry}
              viewerDiscipline={viewerDiscipline}
            />
          ))}
        </ul>
      )}
      <div className={styles.affordance}>
        Triage <em>never</em> auto-merges per ADR-018; every external comment
        becomes a contribution awaiting human approval. Approve to create a
        contribution from the drafted proposal; reject to dismiss with an
        optional reason.
      </div>
    </section>
  );
}

function FeedbackRow({
  entry,
  viewerDiscipline,
}: {
  entry: FeedbackEntry;
  viewerDiscipline: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<TriageActionResult | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectReason, setShowRejectReason] = useState(false);

  const handleApprove = (): void => {
    startTransition(async () => {
      const r = await approveTriageDraft(entry.id);
      setResult(r);
    });
  };

  const handleReject = (): void => {
    startTransition(async () => {
      const r = await rejectTriageDraft(entry.id, rejectReason);
      setResult(r);
    });
  };

  const decided = result?.ok === true;
  const errored = result !== null && result.ok === false;

  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.rowTitle}>
          {entry.source} · {entry.externalAuthor} · {entry.externalCommentId}
        </span>
        <span className={`${styles.statePill} ${styles.statePillReview}`}>
          {entry.category}
        </span>
      </div>
      <div className={styles.rowSub}>
        {entry.territoryName ?? entry.territoryId} · review_role:{' '}
        {entry.reviewRole ?? '<inherits owner_role>'} · confidence:{' '}
        {entry.confidence.toFixed(2)} · classifier signals:{' '}
        {entry.signals.length > 0 ? entry.signals.join(', ') : 'none'}
      </div>
      <details className={styles.tags}>
        <summary>Drafted proposal ({entry.discipline})</summary>
        <pre style={{ whiteSpace: 'pre-wrap', margin: '0.5rem 0' }}>
          {entry.bodyMarkdown}
        </pre>
        <p style={{ margin: 0 }}>
          <strong>Suggested action:</strong> {entry.suggestedAction}
        </p>
      </details>
      <blockquote
        style={{
          margin: '0.5rem 0',
          padding: '0.5rem 0.75rem',
          borderLeft: '3px solid #ccc',
          fontSize: '0.9em',
        }}
      >
        {entry.commentText}
      </blockquote>
      {decided && result?.contributionId !== undefined ? (
        <div className={styles.affordance}>
          ✓ Approved. Contribution id: <code>{result.contributionId}</code>
        </div>
      ) : decided ? (
        <div className={styles.affordance}>✓ Rejected.</div>
      ) : errored ? (
        <div className={styles.affordance}>
          ✗ {result?.error?.code}: {result?.error?.message}
        </div>
      ) : entry.routedToViewer ? (
        <div className={styles.tags}>
          {!showRejectReason ? (
            <>
              <button type="button" disabled={isPending} onClick={handleApprove}>
                Approve (creates contribution)
              </button>{' '}
              <button
                type="button"
                disabled={isPending}
                onClick={() => setShowRejectReason(true)}
              >
                Reject…
              </button>
            </>
          ) : (
            <>
              <input
                type="text"
                placeholder="Optional rejection reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                style={{ width: '60%' }}
              />{' '}
              <button type="button" disabled={isPending} onClick={handleReject}>
                Confirm reject
              </button>{' '}
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setShowRejectReason(false);
                  setRejectReason('');
                }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      ) : (
        <div className={styles.affordance}>
          Routed to <strong>{entry.reviewRole ?? '<owner_role>'}</strong> (your
          discipline: {viewerDiscipline ?? '<none>'}). Read-only here.
        </div>
      )}
    </li>
  );
}
