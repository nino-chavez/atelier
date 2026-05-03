// Tiny shared section primitives.

import { severityFor, type Severity } from '../../../../../lib/atelier/observability-config.ts';

export function MetricCard({
  title,
  value,
  envelope,
  suffix,
  sub,
  wide,
}: {
  title: string;
  value: number;
  envelope?: number;
  suffix?: string;
  sub?: string;
  wide?: boolean;
}) {
  const severity: Severity = envelope ? severityFor(value, envelope) : 'ok';
  const ratio = envelope && envelope > 0 ? Math.min(1, value / envelope) : 0;
  return (
    <div className={`obs-card${wide ? ' obs-card-wide' : ''}`}>
      <div className="obs-card-head">
        <h2 className="obs-card-title">{title}</h2>
        {envelope && <SeverityPill severity={severity} />}
      </div>
      <div className="obs-metric">
        <span className="obs-metric-value">{formatNumber(value)}</span>
        {envelope && <span className="obs-metric-suffix">/ {formatNumber(envelope)}{suffix ? ` ${suffix}` : ''}</span>}
        {!envelope && suffix && <span className="obs-metric-suffix">{suffix}</span>}
      </div>
      {envelope && (
        <div className="obs-bar-track">
          <div
            className={`obs-bar-fill${severity === 'warn' ? ' obs-bar-fill-warn' : severity === 'alert' ? ' obs-bar-fill-alert' : ''}`}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      )}
      {sub && <div className="obs-card-sub">{sub}</div>}
    </div>
  );
}

export function SeverityPill({ severity, label }: { severity: Severity; label?: string }) {
  const cls = severity === 'alert' ? 'obs-pill-alert' : severity === 'warn' ? 'obs-pill-warn' : 'obs-pill-ok';
  const text = label ?? severity;
  return <span className={`obs-pill ${cls}`}>{text}</span>;
}

export function Card({
  title,
  children,
  wide,
  sub,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  sub?: string;
}) {
  return (
    <div className={`obs-card${wide ? ' obs-card-wide' : ''}`}>
      <div className="obs-card-head">
        <h2 className="obs-card-title">{title}</h2>
        {sub && <span className="obs-card-sub">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="obs-empty">{children}</div>;
}

export function Callout({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return <div className={`obs-callout${warn ? ' obs-callout-warn' : ''}`}>{children}</div>;
}

export function BarRow({
  label,
  count,
  max,
  severity,
}: {
  label: string;
  count: number;
  max: number;
  severity?: Severity;
}) {
  const ratio = max > 0 ? Math.min(1, count / max) : 0;
  const sev = severity ?? 'ok';
  return (
    <div className="obs-bar-row">
      <span className="obs-bar-label">{label}</span>
      <span className="obs-bar-track">
        <span
          className={`obs-bar-fill${sev === 'warn' ? ' obs-bar-fill-warn' : sev === 'alert' ? ' obs-bar-fill-alert' : ''}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </span>
      <span className="obs-bar-count">{count}</span>
    </div>
  );
}

export function relativeTime(d: Date | null | undefined): string {
  if (!d) return 'never';
  const ms = Date.now() - new Date(d).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
