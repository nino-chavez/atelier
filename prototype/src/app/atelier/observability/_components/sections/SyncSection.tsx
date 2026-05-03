// Sync section - per-script lag, error rate, last successful run.
// Per ARCH 8.2 / 8.3.

import type { SyncViewModel } from '../../../../../lib/atelier/observability-data.ts';
import type { ObservabilityThresholds } from '../../../../../lib/atelier/observability-config.ts';
import { Card, Empty, SeverityPill, relativeTime } from './_ui.tsx';
import { severityFor } from '../../../../../lib/atelier/observability-config.ts';

export default function SyncSection({
  data,
  thresholds: _thresholds,
}: {
  data: SyncViewModel;
  thresholds: ObservabilityThresholds;
}) {
  return (
    <Card title="Sync scripts" wide sub="last successful run + window error rate per ADR-008">
      {data.scripts.every((s) => s.lastRunAt === null && s.runCountLastWindow === 0) ? (
        <Empty>No sync activity recorded. Confirm scripts are scheduled (cron) per BUILD-SEQUENCE M1.</Empty>
      ) : (
        <ul className="obs-row-list">
          {data.scripts.map((s) => {
            const errSeverity = severityFor(s.errorRateLastWindow, 0.05); // >5% error is alert
            return (
              <li key={s.action} className="obs-row">
                <div className="obs-row-head">
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>{s.action}</span>
                  <span className="obs-row-meta">
                    last run {relativeTime(s.lastRunAt)} ({s.lastOutcome ?? '—'})
                  </span>
                </div>
                <div className="obs-row-head">
                  <span className="obs-row-meta">
                    {s.runCountLastWindow} runs in window · error rate{' '}
                    {(s.errorRateLastWindow * 100).toFixed(1)}%
                  </span>
                  <SeverityPill severity={errSeverity} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
