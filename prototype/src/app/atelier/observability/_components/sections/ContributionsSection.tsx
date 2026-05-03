// Contributions section - by-state count, recent state-transition audit
// log, throughput per territory. Per ARCH 8.2.

import type { ContributionsViewModel } from '../../../../../lib/atelier/observability-data.ts';
import type { ObservabilityThresholds } from '../../../../../lib/atelier/observability-config.ts';
import { Card, Empty, MetricCard, relativeTime } from './_ui.tsx';

export default function ContributionsSection({
  data,
  thresholds,
}: {
  data: ContributionsViewModel;
  thresholds: ObservabilityThresholds;
}) {
  return (
    <>
      <MetricCard
        title="Lifetime contributions"
        value={data.lifetime}
        envelope={thresholds.contributionsLifetimePerProject}
        suffix="all states"
        sub="Beyond envelope: archive policy + tier upgrade per ARCH 9.8."
      />
      <Card title="By state">
        {Object.keys(data.byState).length === 0 ? (
          <Empty>No contributions in this project yet.</Empty>
        ) : (
          <ul className="obs-row-list">
            {Object.entries(data.byState).map(([state, count]) => (
              <li key={state} className="obs-row">
                <div className="obs-row-head">
                  <span style={{ textTransform: 'capitalize' }}>{state.replace(/_/g, ' ')}</span>
                  <span className="obs-row-meta">{count}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Throughput by territory" sub="window count of new contributions">
        {data.throughputByTerritory.length === 0 ? (
          <Empty>No contribution activity in the lookback window.</Empty>
        ) : (
          <ul className="obs-row-list">
            {data.throughputByTerritory.map((t) => (
              <li key={t.territory} className="obs-row">
                <div className="obs-row-head">
                  <span>{t.territory}</span>
                  <span className="obs-row-meta">{t.count}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Recent state transitions" wide sub={`last ${data.recentTransitions.length} events in window`}>
        {data.recentTransitions.length === 0 ? (
          <Empty>No state transitions recorded in the lookback window.</Empty>
        ) : (
          <ul className="obs-row-list">
            {data.recentTransitions.map((t, idx) => (
              <li key={`${t.at.toISOString()}-${idx}`} className="obs-row">
                <div className="obs-row-head">
                  <span>
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{t.action}</span>
                    {t.composerName ? <span className="obs-row-meta"> · {t.composerName}</span> : null}
                    {t.contributionId ? (
                      <span className="obs-row-meta"> · {t.contributionId.slice(0, 8)}…</span>
                    ) : null}
                  </span>
                  <span className="obs-row-meta">{relativeTime(t.at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
