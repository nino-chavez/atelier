// Triage section - classifier confidence distribution, accept/reject
// rate. Per ARCH 8.2.

import type { TriageViewModel } from '../../../../../lib/atelier/observability-data.ts';
import type { ObservabilityThresholds } from '../../../../../lib/atelier/observability-config.ts';
import { BarRow, Card, Empty, MetricCard, SeverityPill } from './_ui.tsx';
import { severityFor } from '../../../../../lib/atelier/observability-config.ts';

export default function TriageSection({
  data,
  thresholds,
}: {
  data: TriageViewModel;
  thresholds: ObservabilityThresholds;
}) {
  const total = data.confidenceBuckets.low + data.confidenceBuckets.medium + data.confidenceBuckets.high;
  const max = Math.max(1, data.confidenceBuckets.low, data.confidenceBuckets.medium, data.confidenceBuckets.high);
  const acceptRate = (() => {
    const denom = data.acceptedLastWindow + data.rejectedLastWindow;
    return denom === 0 ? null : data.acceptedLastWindow / denom;
  })();
  const acceptSeverity = acceptRate === null ? 'ok' : severityFor(1 - acceptRate, 0.5); // >50% reject is alert
  return (
    <>
      <MetricCard
        title="Pending backlog"
        value={data.pendingCount}
        envelope={thresholds.triagePendingBacklog}
        suffix="awaiting human review"
        sub="Per ADR-018 triage never auto-merges; backlog reflects external comments awaiting routing."
      />
      <MetricCard
        title="Accepted (window)"
        value={data.acceptedLastWindow}
        suffix="approvals recorded"
      />
      <MetricCard
        title="Rejected (window)"
        value={data.rejectedLastWindow}
        suffix="triage.rejected"
      />
      <div className="obs-card">
        <div className="obs-card-head">
          <h2 className="obs-card-title">Accept rate</h2>
          {acceptRate !== null && <SeverityPill severity={acceptSeverity} />}
        </div>
        <div className="obs-metric">
          <span className="obs-metric-value">
            {acceptRate === null ? '–' : `${(acceptRate * 100).toFixed(0)}%`}
          </span>
          <span className="obs-metric-suffix">accepted / (accepted + rejected)</span>
        </div>
        <div className="obs-card-sub">
          Sustained low accept rate suggests classifier drift; tune thresholds or revisit
          the triage routing rules.
        </div>
      </div>
      <Card title="Classifier confidence distribution (pending)" wide sub={`${total} pending rows bucketed`}>
        {total === 0 ? (
          <Empty>No pending triage rows to bucket.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <BarRow label="High (>=0.8)" count={data.confidenceBuckets.high} max={max} />
            <BarRow label="Medium (0.5-0.8)" count={data.confidenceBuckets.medium} max={max} severity="warn" />
            <BarRow label="Low (<0.5)" count={data.confidenceBuckets.low} max={max} severity="alert" />
          </div>
        )}
      </Card>
    </>
  );
}
