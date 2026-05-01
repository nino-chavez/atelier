// Feedback queue — inbound triage from external systems (Figma comments,
// published-doc comments, etc.) per ADR-018 + ARCH 6.5.2.
//
// Stubbed at M3 per BUILD-SEQUENCE: triage classifier + drafter run from
// M1 (sync substrate) and the schema row exists; full Figma webhook +
// design-comment mapping land at M6 alongside remote-principal composers.

import styles from './Panel.module.css';

export default function FeedbackQueuePanel() {
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>Feedback queue</h2>
      </div>
      <div className={styles.empty}>
        Inbound triage queue is empty (or not yet wired). Figma comment
        ingestion lands at M6; design-doc comment paths track ARCH 6.5.2.
      </div>
      <div className={styles.affordance}>
        Triage <em>never</em> auto-merges per ADR-018; every external comment
        becomes a contribution awaiting human approval.
      </div>
    </section>
  );
}
