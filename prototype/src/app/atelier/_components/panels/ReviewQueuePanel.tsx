// Review queue — contributions in state=review whose territory routes to
// the viewer's discipline (per ADR-025: territories.review_role determines
// which lens surfaces a review).

import type { ReviewQueueEntry } from '../../../../lib/atelier/lens-data.ts';
import styles from './Panel.module.css';

export default function ReviewQueuePanel({
  entries,
  viewerDiscipline,
}: {
  entries: ReviewQueueEntry[];
  viewerDiscipline: string | null;
}) {
  return (
    <section className={`${styles.panel} ${styles.panelWide}`}>
      <div className={styles.head}>
        <h2 className={styles.title}>Review queue</h2>
        <span className={styles.count}>{entries.length}</span>
      </div>
      {viewerDiscipline === null ? (
        <div className={styles.empty}>
          No discipline assigned — review routing is keyed off composer.discipline.
        </div>
      ) : entries.length === 0 ? (
        <div className={styles.empty}>
          Nothing routed to {viewerDiscipline} review at this time.
        </div>
      ) : (
        <ul className={styles.list}>
          {entries.map((c) => (
            <li key={c.id} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={styles.rowTitle}>{c.contentRef}</span>
                <span className={`${styles.statePill} ${styles.statePillReview}`}>review</span>
              </div>
              <div className={styles.rowSub}>
                {c.territoryName} · review_role: {c.reviewRole ?? c.territoryName} · author:{' '}
                {c.authorName ?? 'unowned'}
              </div>
              <div className={styles.tags}>
                {c.traceIds.map((tid) => (
                  <span key={tid} className={`${styles.tag} ${styles.tagAccent}`}>
                    {tid}
                  </span>
                ))}
                <span className={`${styles.tag} ${styles.tagWarm}`}>kind:{c.kind}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.affordance}>
        Routing per ADR-025: <code>territory.review_role</code> determines which lens surfaces the review.
      </div>
    </section>
  );
}
