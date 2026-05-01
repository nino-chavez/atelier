// Presence — active composers in the project (heartbeat <15min).
// Per ARCH 6.8 session.presence_changed event surface; M3 polls; M4
// upgrades to the live broadcast.

import type { PresenceEntry } from '../../../../lib/atelier/lens-data.ts';
import styles from './Panel.module.css';

export default function PresencePanel({
  entries,
  viewerComposerId,
}: {
  entries: PresenceEntry[];
  viewerComposerId: string;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>Active participants</h2>
        <span className={styles.count}>{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className={styles.empty}>No active sessions in the last 15 minutes.</div>
      ) : (
        <ul className={styles.list}>
          {entries.map((p) => {
            const isViewer = p.composerId === viewerComposerId;
            return (
              <li key={p.composerId} className={styles.row}>
                <div className={styles.rowHead}>
                  <span className={styles.rowTitle}>
                    {p.composerName}
                    {isViewer && <span className={`${styles.tag} ${styles.tagMine}`}> you</span>}
                  </span>
                  <span className={styles.rowMeta}>{relativeMinutes(p.heartbeatAt)}</span>
                </div>
                <div className={styles.tags}>
                  <span className={`${styles.tag} ${styles.tagAccent}`}>{p.discipline ?? 'no-discipline'}</span>
                  <span className={styles.tag}>{p.surface}</span>
                  {p.agentClient && <span className={styles.tag}>{p.agentClient}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className={styles.affordance}>
        Live updates land at M4 with the broadcast substrate; this view polls.
      </div>
    </section>
  );
}

function relativeMinutes(d: Date): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  if (mins === 0) return 'just now';
  if (mins === 1) return '1m ago';
  return `${mins}m ago`;
}
