export type Severity = 'ok' | 'warn' | 'alert';

/**
 * Compute alert severity for a metric given its value and envelope.
 * Used by both the UI observability dashboard and the backend alert publisher.
 */
export function severityFor(value: number, envelope: number): Severity {
  if (envelope <= 0) return 'ok';
  const ratio = value / envelope;
  if (ratio >= 1.0) return 'alert';
  if (ratio >= 0.8) return 'warn';
  return 'ok';
}
