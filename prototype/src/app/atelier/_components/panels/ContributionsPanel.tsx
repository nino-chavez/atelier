// Active contributions, weighted per the lens kind weights.
// State pill differentiates open / claimed / plan_review / in_progress / review.
// `mine` tag highlights the viewer's own contributions for orientation.

import type { ContributionEntry } from '../../../../lib/atelier/lens-data.ts';
import type { ContributionKindWeight } from '../../../../lib/atelier/lens-config.ts';
import styles from './Panel.module.css';

export default function ContributionsPanel({
  entries,
  byState,
  weights,
  canWrite,
}: {
  entries: ContributionEntry[];
  byState: Record<string, number>;
  weights: ContributionKindWeight;
  canWrite: boolean;
}) {
  const total = Object.values(byState).reduce((a, b) => a + b, 0);
  return (
    <section className={`${styles.panel} ${styles.panelWide}`}>
      <div className={styles.head}>
        <h2 className={styles.title}>Active contributions</h2>
        <span className={styles.count}>
          {entries.length} shown · {total} total
        </span>
      </div>
      <div className={styles.tags}>
        {ORDERED_STATES.map((s) => (
          <span key={s} className={styles.tag}>
            {s}: {byState[s] ?? 0}
          </span>
        ))}
      </div>
      {entries.length === 0 ? (
        <div className={styles.empty}>No active contributions in this project.</div>
      ) : (
        <ul className={styles.list}>
          {entries.map((c) => (
            <li key={c.id} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={styles.rowTitle}>
                  {c.contentRef}
                  {c.isMine && <span className={`${styles.tag} ${styles.tagMine}`}> mine</span>}
                </span>
                <span className={`${styles.statePill} ${stateStyle(c.state)}`}>{c.state}</span>
              </div>
              <div className={styles.rowSub}>
                {c.territoryName} · kind:{c.kind} · {c.authorName ?? 'unowned'}
                {c.requiresOwnerApproval && ' · awaiting owner approval'}
                {c.blockedBy && ' · BLOCKED'}
              </div>
              <div className={styles.tags}>
                {c.traceIds.map((tid) => (
                  <span key={tid} className={`${styles.tag} ${styles.tagAccent}`}>
                    {tid}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.affordance}>
        Sorted by lens kind weights:{' '}
        impl×{weights.implementation} · research×{weights.research} · design×{weights.design}.{' '}
        {canWrite ? (
          <span>
            Authoring: <code>claim</code> via the endpoint or your agent client.
          </span>
        ) : (
          <span>Read-only lens — no claim affordance.</span>
        )}
      </div>
    </section>
  );
}

const ORDERED_STATES = ['open', 'claimed', 'plan_review', 'in_progress', 'review', 'merged', 'rejected'] as const;

function stateStyle(state: string): string {
  if (state === 'review') return styles.statePillReview ?? '';
  if (state === 'in_progress') return styles.statePillInProgress ?? '';
  return '';
}
