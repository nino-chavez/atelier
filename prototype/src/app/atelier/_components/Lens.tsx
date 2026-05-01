// Lens shell.
//
// Renders the per-lens header (label + description + viewer + lens
// selector), then the panel grid in the order config.panels declares.
// Each panel is its own server component; the shell is purely composition.

import type { LensViewModel } from '../../../lib/atelier/lens-data.ts';
import LensSelector from './LensSelector.tsx';
import PanelHost from './PanelHost.tsx';
import styles from './Lens.module.css';

export default function Lens({ viewModel }: { viewModel: LensViewModel }) {
  const { config, viewer } = viewModel;
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <div className={styles.eyebrow}>{viewer.projectName} · /atelier</div>
          <h1 className={styles.title}>{config.label} lens</h1>
          <p className={styles.description}>{config.description}</p>
        </div>
        <div className={styles.viewer}>
          <div className={styles.viewerName}>{viewer.composerName}</div>
          <div className={styles.viewerMeta}>
            {viewer.discipline ?? 'no-discipline'} ·{' '}
            {viewer.accessLevel ?? 'member'} · session {viewer.sessionId.slice(0, 8)}…
          </div>
          <div className={styles.staleness}>
            Snapshot at {viewModel.staleAsOf.toISOString()}
          </div>
        </div>
      </header>
      <LensSelector currentLens={config.id} />
      {!config.affordances.canWrite && (
        <div className={styles.readonlyBanner}>
          Read-only lens — no authoring affordances.
        </div>
      )}
      <div className={styles.panels}>
        {config.panels.map((panelId) => (
          <PanelHost key={panelId} panelId={panelId} viewModel={viewModel} />
        ))}
      </div>
    </main>
  );
}
