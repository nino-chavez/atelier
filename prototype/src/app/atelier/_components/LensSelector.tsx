// LensSelector — tab navigation across the five lenses.
//
// Server component (the active state is derived from the URL, which the
// parent already knows; no client interaction needed beyond Link). Each
// tab is a plain anchor so back/forward + middle-click + open-in-new-tab
// all work without JS.

import Link from 'next/link';
import { LENS_IDS, LENS_CONFIGS, type LensId } from '../../../lib/atelier/lens-config.ts';
import styles from './LensSelector.module.css';

export default function LensSelector({ currentLens }: { currentLens: LensId }) {
  return (
    <nav className={styles.nav} aria-label="Lens selector">
      {LENS_IDS.map((lensId) => {
        const cfg = LENS_CONFIGS[lensId];
        const isActive = lensId === currentLens;
        return (
          <Link
            key={lensId}
            href={`/atelier/${lensId}`}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            aria-current={isActive ? 'page' : undefined}
          >
            {cfg.label}
          </Link>
        );
      })}
    </nav>
  );
}
