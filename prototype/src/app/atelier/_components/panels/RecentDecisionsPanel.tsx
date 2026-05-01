// Recent decisions — the project-wide direct band from get_context.
// Epic-sibling and contribution-linked bands light up at M3-late when
// get_context surfaces them. Truncation flag mirrors ARCH 6.7.1 contract.

import type { RecentDecisionEntry } from '../../../../lib/atelier/lens-data.ts';
import styles from './Panel.module.css';

export default function RecentDecisionsPanel({
  decisions,
  truncated,
}: {
  decisions: RecentDecisionEntry[];
  truncated: boolean;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>Recent decisions</h2>
        <span className={styles.count}>
          {decisions.length}
          {truncated && '+'}
        </span>
      </div>
      {decisions.length === 0 ? (
        <div className={styles.empty}>No decisions yet.</div>
      ) : (
        <ul className={styles.list}>
          {decisions.map((d) => (
            <li key={d.id} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={styles.rowTitle}>{d.summary}</span>
                <span className={styles.rowMeta}>
                  {d.repoCommitSha ? d.repoCommitSha.slice(0, 7) : 'no-sha'}
                </span>
              </div>
              <div className={styles.tags}>
                {d.traceIds.map((tid) => (
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
        Direct band only at M3; epic-sibling + contribution-linked bands per ARCH 6.7.1.
      </div>
    </section>
  );
}
