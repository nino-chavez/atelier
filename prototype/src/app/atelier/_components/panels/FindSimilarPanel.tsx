// "Before you start" — find_similar surface.
// Stubbed at M3 per BUILD-SEQUENCE: find_similar lands at M5 (gates on
// D24 embedding model default). The endpoint already advertises the tool
// with degraded=true; this panel renders the degraded banner so analysts
// know the gap exists rather than encountering it as a silent absence.

import styles from './Panel.module.css';

export default function FindSimilarPanel() {
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>Before you start (find_similar)</h2>
      </div>
      <div className={styles.degraded}>
        Semantic search is degraded — keyword fallback only at M3. Eval-gated
        find_similar with embedding-model-backed precision/recall lands at
        M5 per <span className={styles.kbd}>BUILD-SEQUENCE.md</span>.
      </div>
      <div className={styles.affordance}>
        Calling <code>find_similar</code> on the endpoint returns
        <code>degraded: true</code> with empty bands until then.
      </div>
    </section>
  );
}
