// Locks section - acquisition/release ledger with fencing tokens,
// conflict rate. Per ARCH 8.2.

import type { LocksViewModel } from '../../../../../lib/atelier/observability-data.ts';
import type { ObservabilityThresholds } from '../../../../../lib/atelier/observability-config.ts';
import { Card, Empty, MetricCard, relativeTime, SeverityPill } from './_ui.tsx';
import { severityFor } from '../../../../../lib/atelier/observability-config.ts';

export default function LocksSection({
  data,
  thresholds,
}: {
  data: LocksViewModel;
  thresholds: ObservabilityThresholds;
}) {
  const conflictPct = (data.conflictRate * 100).toFixed(1);
  const conflictSeverity = severityFor(data.conflictRate, 0.2); // >20% conflict rate is alert
  return (
    <>
      <MetricCard
        title="Locks held now"
        value={data.heldNow}
        envelope={thresholds.locksHeldConcurrentPerProject}
        suffix="active"
        sub="Concurrent fenced acquisitions per ARCH 6.1.1."
      />
      <MetricCard
        title="Acquisitions (window)"
        value={data.recentAcquisitions}
        suffix="lock.acquired events"
      />
      <MetricCard
        title="Releases (window)"
        value={data.recentReleases}
        suffix="lock.released events"
      />
      <div className="obs-card">
        <div className="obs-card-head">
          <h2 className="obs-card-title">Conflict rate</h2>
          <SeverityPill severity={conflictSeverity} />
        </div>
        <div className="obs-metric">
          <span className="obs-metric-value">{conflictPct}%</span>
          <span className="obs-metric-suffix">contested acquisitions / window</span>
        </div>
        <div className="obs-card-sub">
          Proxy: telemetry rows with action='lock.acquired' AND outcome='error'.
          Sustained &gt;20% suggests territory boundaries need re-examining.
        </div>
      </div>
      <Card title="Recent ledger" wide sub={`last ${data.recentLedger.length} entries in window`}>
        {data.recentLedger.length === 0 ? (
          <Empty>No lock activity in the lookback window.</Empty>
        ) : (
          <ul className="obs-row-list">
            {data.recentLedger.map((r, idx) => (
              <li key={`${r.at.toISOString()}-${idx}`} className="obs-row" data-iaux-row="lock-ledger">
                <div className="obs-row-head">
                  <span>
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{r.action}</span>
                    {r.holderName ? <span className="obs-row-meta"> · {r.holderName}</span> : null}
                    {r.fencingToken ? (
                      <span className="obs-row-meta"> · token {r.fencingToken}</span>
                    ) : null}
                  </span>
                  <span className="obs-row-meta">{relativeTime(r.at)}</span>
                </div>
                {r.artifactScope.length > 0 && (
                  <div className="obs-row-meta" style={{ wordBreak: 'break-all' }}>
                    {r.artifactScope.join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
