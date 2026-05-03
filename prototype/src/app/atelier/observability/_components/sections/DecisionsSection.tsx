// Decisions section - lifetime ADR count, find_similar match-rate
// signal. Per ARCH 8.2.

import type { DecisionsViewModel } from '../../../../../lib/atelier/observability-data.ts';
import type { ObservabilityThresholds } from '../../../../../lib/atelier/observability-config.ts';
import { Callout, MetricCard, relativeTime } from './_ui.tsx';

export default function DecisionsSection({
  data,
  thresholds,
}: {
  data: DecisionsViewModel;
  thresholds: ObservabilityThresholds;
}) {
  return (
    <>
      <MetricCard
        title="Lifetime decisions"
        value={data.lifetime}
        envelope={thresholds.decisionsLifetimePerProject}
        suffix="ADRs logged"
        sub="Per-ADR file split per ADR-030. Vector index handles comfortably at envelope."
      />
      <MetricCard
        title="Recent (lookback window)"
        value={data.recentCount}
        suffix="new ADRs"
      />
      <div className="obs-card obs-card-wide">
        <div className="obs-card-head">
          <h2 className="obs-card-title">find_similar signal</h2>
          <span className="obs-card-sub">last harness run</span>
        </div>
        {data.findSimilarSignal === 'no_data' ? (
          <Callout warn>
            <strong>No find_similar measurement signal recorded yet.</strong> The signal
            populates when the eval harness runs against the deployed substrate (per
            scripts/test/scale/load-runner.ts) or when find_similar emits per-call
            telemetry. Run <code>npm run eval -- find_similar</code> to populate the
            advisory-tier precision/recall trail (per ADR-043 / ADR-047 advisory
            informational-default).
          </Callout>
        ) : (
          <Callout>
            Last find_similar event: <strong>{relativeTime(data.findSimilarLastRunAt)}</strong>.
            Per ADR-043 / ADR-047 the gate is advisory at v1; precision/recall history
            populates from the eval harness writing telemetry rows under
            <code> action LIKE 'find_similar.%' </code> or <code> action LIKE 'scale_test.%find_similar%'</code>.
          </Callout>
        )}
      </div>
    </>
  );
}
