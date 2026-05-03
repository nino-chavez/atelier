// Observability dashboard shell.
//
// Header (project + viewer + snapshot meta + manual refresh) plus the
// section tab bar plus the active section's panel. Section selection
// keyed off the ?tab= search param the page resolved before mount.
//
// The 5-lens precedent (LensSelector) used path-segment routing because
// each lens is a complete reorientation. Observability sections share
// one canonical view-model and one viewer; the search-param tab keeps
// routing cheap (single page file) while preserving the bookmarkable
// affordance of separate URLs per section.

import Link from 'next/link';
import type { ObservabilityViewModel } from '../../../../lib/atelier/observability-data.ts';
import { SECTIONS, type SectionId } from '../sections.ts';
import Refresher from './Refresher.tsx';
import SessionsSection from './sections/SessionsSection.tsx';
import ContributionsSection from './sections/ContributionsSection.tsx';
import LocksSection from './sections/LocksSection.tsx';
import DecisionsSection from './sections/DecisionsSection.tsx';
import TriageSection from './sections/TriageSection.tsx';
import SyncSection from './sections/SyncSection.tsx';
import VectorSection from './sections/VectorSection.tsx';
import CostSection from './sections/CostSection.tsx';
import './Observability.css';

const TAB_LABELS: Record<SectionId, string> = {
  sessions: 'Sessions',
  contributions: 'Contributions',
  locks: 'Locks',
  decisions: 'Decisions',
  triage: 'Triage',
  sync: 'Sync',
  vector: 'Vector index',
  cost: 'Cost',
};

export default function ObservabilityShell({
  tab,
  viewer,
  viewModel,
}: {
  tab: SectionId;
  viewer: { composerName: string; projectName: string; sessionIdShort: string };
  viewModel: ObservabilityViewModel;
}) {
  return (
    <main className="obs-shell">
      <header className="obs-header">
        <div className="obs-identity">
          <div className="obs-eyebrow">{viewer.projectName} · /atelier/observability</div>
          <h1 className="obs-title">Observability</h1>
          <p className="obs-description">
            Operator-gated monitoring of the eight substrate dimensions per ARCH 8.2.
            Threshold pills color yellow at 80% of envelope and red at 100%
            (.atelier/config.yaml: observability.thresholds). Out-of-band alert
            delivery (Slack/Teams/Discord) deferred to v1.x per BRD-OPEN-QUESTIONS §29.
          </p>
        </div>
        <div className="obs-viewer">
          <div className="obs-viewer-name">{viewer.composerName}</div>
          <div className="obs-viewer-meta">
            admin · session {viewer.sessionIdShort}…
          </div>
          <Refresher staleAsOf={viewModel.staleAsOf.toISOString()} />
        </div>
      </header>

      <nav className="obs-tabs" aria-label="Observability section selector">
        {SECTIONS.map((id) => {
          const isActive = id === tab;
          return (
            <Link
              key={id}
              href={`/atelier/observability?tab=${id}`}
              className={`obs-tab ${isActive ? 'obs-tab-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              {TAB_LABELS[id]}
            </Link>
          );
        })}
      </nav>

      <div className="obs-section">{renderSection(tab, viewModel)}</div>
    </main>
  );
}

function renderSection(tab: SectionId, vm: ObservabilityViewModel) {
  switch (tab) {
    case 'sessions':
      return <SessionsSection data={vm.sessions} thresholds={vm.thresholds} />;
    case 'contributions':
      return <ContributionsSection data={vm.contributions} thresholds={vm.thresholds} />;
    case 'locks':
      return <LocksSection data={vm.locks} thresholds={vm.thresholds} />;
    case 'decisions':
      return <DecisionsSection data={vm.decisions} thresholds={vm.thresholds} />;
    case 'triage':
      return <TriageSection data={vm.triage} thresholds={vm.thresholds} />;
    case 'sync':
      return <SyncSection data={vm.sync} thresholds={vm.thresholds} />;
    case 'vector':
      return <VectorSection data={vm.vector} thresholds={vm.thresholds} />;
    case 'cost':
      return <CostSection data={vm.cost} thresholds={vm.thresholds} />;
  }
}
