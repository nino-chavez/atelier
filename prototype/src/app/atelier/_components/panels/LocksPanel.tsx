// Active locks. Per ARCH 7.4 + ADR-026: fencing tokens are mandatory; lock
// rows carry the holder + scope + token for observability.

import type { LockEntry } from '../../../../lib/atelier/lens-data.ts';
import styles from './Panel.module.css';

export default function LocksPanel({ locks }: { locks: LockEntry[] }) {
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>Active locks</h2>
        <span className={styles.count}>{locks.length}</span>
      </div>
      {locks.length === 0 ? (
        <div className={styles.empty}>No active locks.</div>
      ) : (
        <ul className={styles.list}>
          {locks.map((l) => (
            <li key={l.id} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={styles.rowTitle}>{l.holderComposerName}</span>
                <span className={styles.rowMeta}>token {l.fencingToken}</span>
              </div>
              <div className={styles.tags}>
                {l.artifactScope.map((s) => (
                  <span key={s} className={styles.tag}>
                    {s}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.affordance}>
        Fencing per ADR-004; conflict detection via GIN scope-overlap (ARCH 7.4.1).
      </div>
    </section>
  );
}
