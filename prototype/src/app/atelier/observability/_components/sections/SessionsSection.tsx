// Sessions section - heartbeat health timeline, surface breakdown,
// reaper activity. Per ARCH 8.2 first row.

import type {
  SessionsViewModel,
} from '../../../../../lib/atelier/observability-data.ts';
import type { ObservabilityThresholds } from '../../../../../lib/atelier/observability-config.ts';
import { Card, Empty, MetricCard, relativeTime } from './_ui.tsx';

export default function SessionsSection({
  data,
  thresholds,
}: {
  data: SessionsViewModel;
  thresholds: ObservabilityThresholds;
}) {
  return (
    <>
      <MetricCard
        title="Active sessions (project)"
        value={data.activeNow}
        envelope={thresholds.sessionsActivePerProject}
        suffix="active in last 15min"
      />
      <MetricCard
        title="Active sessions (guild)"
        value={data.guildActiveNow}
        envelope={thresholds.sessionsActivePerGuild}
        suffix="across all projects"
      />
      <MetricCard
        title="Reaped (lookback window)"
        value={data.reapedLastWindow}
        suffix="dead sessions cleaned"
        sub="Source: telemetry action='session.reaped'. Healthy at low absolute counts; spikes hint at network or platform issues."
      />
      <Card title="Surface breakdown">
        {Object.keys(data.activeBySurface).length === 0 ? (
          <Empty>No active sessions in the last 15 minutes.</Empty>
        ) : (
          <ul className="obs-row-list">
            {Object.entries(data.activeBySurface).map(([surface, count]) => (
              <li key={surface} className="obs-row">
                <div className="obs-row-head">
                  <span style={{ textTransform: 'capitalize' }}>{surface}</span>
                  <span className="obs-row-meta">{count}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Recent registrations" wide sub={`last ${data.recentRegistrations.length} entries in window`}>
        {data.recentRegistrations.length === 0 ? (
          <Empty>No sessions registered in the lookback window.</Empty>
        ) : (
          <ul className="obs-row-list">
            {data.recentRegistrations.map((r, idx) => (
              <li key={`${r.at.toISOString()}-${idx}`} className="obs-row">
                <div className="obs-row-head">
                  <span>
                    <span style={{ textTransform: 'capitalize' }}>{r.surface}</span>
                    {r.agentClient ? <span className="obs-row-meta"> · {r.agentClient}</span> : null}
                  </span>
                  <span className="obs-row-meta">{relativeTime(r.at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
