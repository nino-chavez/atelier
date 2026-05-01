// Charter — the canonical files agents read on every register/get_context.
// Per ARCH 6.7 charter is paths-only by default; excerpts opt-in via the
// lens depth (PM and stakeholder lenses default to excerpts on).

import styles from './Panel.module.css';

export default function CharterPanel({
  paths,
  excerpts,
  excerptsEnabled,
}: {
  paths: string[];
  excerpts: Record<string, string> | null;
  excerptsEnabled: boolean;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>Charter</h2>
        <span className={styles.count}>{paths.length}</span>
      </div>
      <ul className={styles.list}>
        {paths.map((path) => (
          <li key={path} className={styles.row}>
            <div className={styles.rowHead}>
              <span className={styles.rowTitle}>
                <code>{path}</code>
              </span>
            </div>
            {excerpts?.[path] && (
              <pre className={styles.rowSub}>{excerpts[path]}</pre>
            )}
          </li>
        ))}
      </ul>
      <div className={styles.affordance}>
        {excerptsEnabled
          ? 'Lens default: excerpts on. get_context returns first-N-line excerpts inline.'
          : 'Lens default: paths only. Set with_charter_excerpts=true on get_context to include bodies.'}
      </div>
    </section>
  );
}
