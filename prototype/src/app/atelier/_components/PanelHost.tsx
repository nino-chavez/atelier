// PanelHost — render a single panel by id from a lens view-model.
//
// The lens shell iterates config.panels in order; PanelHost is the
// indirection that maps panel id → component. Adding a new panel means:
//   1. add the id to PanelId in lens-config.ts
//   2. add the component file under panels/
//   3. add the case here.
//
// A central case is intentional. There is no plugin registry at v1; lens
// composition is via the LensConfig object, panels are vetted UI surfaces.

import type { LensViewModel } from '../../../lib/atelier/lens-data.ts';
import type { PanelId } from '../../../lib/atelier/lens-config.ts';
import CharterPanel from './panels/CharterPanel.tsx';
import ContractsPanel from './panels/ContractsPanel.tsx';
import ContributionsPanel from './panels/ContributionsPanel.tsx';
import FeedbackQueuePanel from './panels/FeedbackQueuePanel.tsx';
import FindSimilarPanel from './panels/FindSimilarPanel.tsx';
import LocksPanel from './panels/LocksPanel.tsx';
import PresencePanel from './panels/PresencePanel.tsx';
import RecentDecisionsPanel from './panels/RecentDecisionsPanel.tsx';
import ReviewQueuePanel from './panels/ReviewQueuePanel.tsx';
import TerritoriesPanel from './panels/TerritoriesPanel.tsx';

export default function PanelHost({
  panelId,
  viewModel,
}: {
  panelId: PanelId;
  viewModel: LensViewModel;
}) {
  switch (panelId) {
    case 'presence':
      return <PresencePanel entries={viewModel.presence} viewerComposerId={viewModel.viewer.composerId} />;
    case 'find_similar':
      return <FindSimilarPanel />;
    case 'review_queue':
      return (
        <ReviewQueuePanel
          entries={viewModel.reviewQueue}
          viewerDiscipline={viewModel.viewer.discipline}
        />
      );
    case 'contributions':
      return (
        <ContributionsPanel
          entries={viewModel.activeContributions}
          byState={viewModel.contributionsByState}
          weights={viewModel.config.depth.contributionsKindWeights}
          canWrite={viewModel.config.affordances.canWrite}
        />
      );
    case 'locks':
      return <LocksPanel locks={viewModel.locks} />;
    case 'contracts':
      return <ContractsPanel contracts={viewModel.contracts} territories={viewModel.territories} />;
    case 'feedback_queue':
      return (
        <FeedbackQueuePanel
          entries={viewModel.feedbackQueue}
          viewerDiscipline={viewModel.viewer.discipline}
        />
      );
    case 'recent_decisions':
      return (
        <RecentDecisionsPanel
          decisions={viewModel.recentDecisions.direct}
          truncated={viewModel.recentDecisions.truncated}
        />
      );
    case 'territories':
      return <TerritoriesPanel territories={viewModel.territories} />;
    case 'charter':
      return (
        <CharterPanel
          paths={viewModel.charter.paths}
          excerpts={viewModel.charter.excerpts}
          excerptsEnabled={viewModel.config.depth.charterExcerpts}
        />
      );
  }
}
