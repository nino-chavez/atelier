// Contracts — published contracts in the project, with breaking/additive
// classification per ARCH 6.6 and ADR-035 effective_decision.

import type { ContractEntry, TerritoryView } from '../../../../lib/atelier/lens-data.ts';
import styles from './Panel.module.css';

export default function ContractsPanel({
  contracts,
  territories,
}: {
  contracts: ContractEntry[];
  territories: TerritoryView[];
}) {
  const consumedNames = new Set<string>(
    territories.filter((t) => t.isOwned === false && t.isConsumed).flatMap((t) => t.contractsConsumed),
  );
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>Contracts</h2>
        <span className={styles.count}>{contracts.length}</span>
      </div>
      {contracts.length === 0 ? (
        <div className={styles.empty}>
          No contracts published yet — territories declare contracts in territories.yaml; the first <code>propose_contract_change</code> publishes a row here.
        </div>
      ) : (
        <ul className={styles.list}>
          {contracts.map((c) => {
            const consumesIt = consumedNames.has(c.name);
            return (
              <li key={c.id} className={styles.row}>
                <div className={styles.rowHead}>
                  <span className={styles.rowTitle}>
                    {c.name}
                    {consumesIt && (
                      <span className={`${styles.tag} ${styles.tagWarm}`}> consumed by you</span>
                    )}
                  </span>
                  <span className={styles.rowMeta}>v{c.version}</span>
                </div>
                <div className={styles.rowSub}>
                  {c.territoryName} · published {c.publishedAt.toISOString().slice(0, 10)}
                </div>
                <div className={styles.tags}>
                  <span
                    className={`${styles.tag} ${
                      c.effectiveDecision === 'breaking' ? styles.tagDanger : styles.tagOk
                    }`}
                  >
                    {c.effectiveDecision}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className={styles.affordance}>
        Breaking-change classifier per ARCH 6.6.1; override + justification per ADR-035.
      </div>
    </section>
  );
}
