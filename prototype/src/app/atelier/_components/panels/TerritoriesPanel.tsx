// Territories — owned + consumed view, per ARCH 6.7 and territories.yaml.
// "Owned" lights up when the viewer's discipline matches owner_role.

import type { TerritoryView } from '../../../../lib/atelier/lens-data.ts';
import styles from './Panel.module.css';

export default function TerritoriesPanel({
  territories,
}: {
  territories: TerritoryView[];
}) {
  const owned = territories.filter((t) => t.isOwned);
  const consumed = territories.filter((t) => !t.isOwned && t.contractsConsumed.length > 0);
  const other = territories.filter((t) => !t.isOwned && t.contractsConsumed.length === 0);
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>Territories</h2>
        <span className={styles.count}>
          {owned.length} owned · {consumed.length} consumed
        </span>
      </div>
      {owned.length > 0 && (
        <ul className={styles.list}>
          {owned.map((t) => (
            <TerritoryRow key={t.name} t={t} variant="owned" />
          ))}
        </ul>
      )}
      {consumed.length > 0 && (
        <>
          <div className={styles.affordance}>Consumed contracts:</div>
          <ul className={styles.list}>
            {consumed.map((t) => (
              <TerritoryRow key={t.name} t={t} variant="consumed" />
            ))}
          </ul>
        </>
      )}
      {other.length > 0 && (
        <>
          <div className={styles.affordance}>Other:</div>
          <ul className={styles.list}>
            {other.map((t) => (
              <TerritoryRow key={t.name} t={t} variant="other" />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function TerritoryRow({ t, variant }: { t: TerritoryView; variant: 'owned' | 'consumed' | 'other' }) {
  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.rowTitle}>
          {t.name}
          {variant === 'owned' && (
            <span className={`${styles.tag} ${styles.tagOk}`}> owned</span>
          )}
        </span>
        <span className={styles.rowMeta}>{t.scopeKind}</span>
      </div>
      <div className={styles.rowSub}>
        owner: {t.ownerRole}
        {t.reviewRole && t.reviewRole !== t.ownerRole && ` · review: ${t.reviewRole}`}
      </div>
      {t.contractsPublished.length > 0 && (
        <div className={styles.tags}>
          {t.contractsPublished.map((c) => (
            <span key={c} className={`${styles.tag} ${styles.tagAccent}`}>
              {c}
            </span>
          ))}
        </div>
      )}
      {t.contractsConsumed.length > 0 && (
        <div className={styles.tags}>
          {t.contractsConsumed.map((c) => (
            <span key={`c-${c}`} className={styles.tag}>
              ← {c}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
