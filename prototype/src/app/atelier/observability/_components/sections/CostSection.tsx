// Cost section - tokens / USD aggregates from telemetry payloads.
// Per ARCH 8.1 token-usage telemetry + 8.2 cost breakdown.

import type { CostViewModel } from '../../../../../lib/atelier/observability-data.ts';
import type { ObservabilityThresholds } from '../../../../../lib/atelier/observability-config.ts';
import { Callout, Card, Empty, MetricCard, SeverityPill } from './_ui.tsx';
import { severityFor } from '../../../../../lib/atelier/observability-config.ts';

export default function CostSection({
  data,
  thresholds,
}: {
  data: CostViewModel;
  thresholds: ObservabilityThresholds;
}) {
  const days = Math.max(1, data.windowSeconds / 86400);
  const usdPerDay = data.totalUsd / days;
  const dailyEnvelope = thresholds.costUsdPerDayPerProject;
  const severity = severityFor(usdPerDay, dailyEnvelope);
  return (
    <>
      <div className="obs-card">
        <div className="obs-card-head">
          <h2 className="obs-card-title">Cost per day (window)</h2>
          <SeverityPill severity={severity} />
        </div>
        <div className="obs-metric">
          <span className="obs-metric-value">${usdPerDay.toFixed(2)}</span>
          <span className="obs-metric-suffix">/ ${dailyEnvelope.toFixed(2)} envelope</span>
        </div>
        <div className="obs-card-sub">
          Window: {(data.windowSeconds / 3600).toFixed(0)}h · total ${data.totalUsd.toFixed(2)}.
          v1 visibility-only (per ARCH 8.1); active enforcement is v1.x scope.
        </div>
      </div>
      <MetricCard
        title="Tokens input (window)"
        value={data.totalTokensInput}
        suffix="prompt tokens"
      />
      <MetricCard
        title="Tokens output (window)"
        value={data.totalTokensOutput}
        suffix="completion tokens"
      />
      {data.signal === 'no_data' ? (
        <div className="obs-card obs-card-wide">
          <div className="obs-card-head">
            <h2 className="obs-card-title">Cost telemetry not yet populated</h2>
          </div>
          <Callout warn>
            No telemetry rows with the <code>cost_usd</code> metadata field landed in
            the lookback window. Per ARCH 8.1 cost is recorded by callers that consume
            LLM tokens (find_similar embedding generation, transcript classification,
            triage drafting). Populate by configuring{' '}
            <code>.atelier/config.yaml: telemetry.model_prices</code> and ensuring the
            embed pipeline + triage drafter emit cost on each call. Visibility ships
            at v1; active enforcement (per-composer budgets) is v1.x scope.
          </Callout>
        </div>
      ) : (
        <>
          <Card title="By action class" wide sub="top USD contributors in window">
            {data.byActionClass.length === 0 ? (
              <Empty>No cost-bearing actions in window.</Empty>
            ) : (
              <ul className="obs-row-list">
                {data.byActionClass.map((a) => (
                  <li key={a.actionClass} className="obs-row">
                    <div className="obs-row-head">
                      <span style={{ fontFamily: 'ui-monospace, monospace' }}>{a.actionClass}</span>
                      <span className="obs-row-meta">${a.usd.toFixed(2)}</span>
                    </div>
                    <div className="obs-row-meta">
                      in {a.tokensInput} · out {a.tokensOutput}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="By composer" wide sub="top USD attribution in window">
            {data.byComposer.length === 0 ? (
              <Empty>No composer-attributed cost in window.</Empty>
            ) : (
              <ul className="obs-row-list">
                {data.byComposer.map((c) => (
                  <li key={c.composerName} className="obs-row">
                    <div className="obs-row-head">
                      <span>{c.composerName}</span>
                      <span className="obs-row-meta">${c.usd.toFixed(2)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}
