// MessagingAdapter interface (BRD-OPEN-QUESTIONS §30 / ARCH §8.3).
//
// Out-of-band observability alerting: when a metric crosses an envelope
// threshold (sessions, locks, sync lag, cost, etc.), the publisher
// dispatches a notification through one or more messaging surfaces
// (Slack, Discord, Teams, generic webhook, email).
//
// This module defines the vendor-neutral interface every implementation
// must satisfy. Concrete adapters live under `../adapters/` per the
// ADR-029 GCP-portability discipline -- this file does NOT import any
// provider SDK.
//
// Design parallels BroadcastService (broadcast.ts):
//   - Per-channel addressing (channel name supplied per call)
//   - Best-effort delivery (failure is logged, not retried; the dashboard
//     remains the source of truth for metric state)
//   - No persistence (transitions are tracked separately by the publisher
//     in the telemetry table)

export type AlertSeverity = 'warn' | 'alert' | 'recovered';

export interface AlertEvent {
  // Identifies the metric that crossed the threshold (e.g.,
  // "sessions_active_per_project", "sync_lag_seconds_p95"). Stable
  // across versions; the messaging-side template uses this as a key.
  metric: string;

  // Severity of the new state. `recovered` fires when a metric drops
  // back to ok after being warn/alert.
  severity: AlertSeverity;

  // Project context. project_id is the canonical scope; project_name
  // is human-readable for the channel rendering.
  projectId: string;
  projectName: string;

  // Numeric context: current value + envelope for the metric. The
  // adapter renders these in the channel-appropriate format.
  value: number;
  envelope: number;

  // Severity transition narrative. The publisher fills this with the
  // prior severity so the receiver knows the direction of change
  // (e.g., "warn -> alert" vs "ok -> warn").
  priorSeverity: AlertSeverity | 'ok';

  // Timestamp of the transition (ISO 8601). Receivers may display
  // relative time ("3 minutes ago").
  occurredAt: string;

  // Optional URL to the dashboard view for this metric. The publisher
  // populates this from the deploy URL + the metric's section anchor.
  dashboardUrl?: string;
}

export interface MessagingAdapter {
  /**
   * Dispatch an alert event to the configured destination.
   *
   * Returns true on successful delivery, false on transport error.
   * The publisher logs failures but does NOT retry per call -- the next
   * publisher tick will re-evaluate state and fire again if the
   * condition still holds.
   *
   * The `channel` parameter is adapter-specific:
   *   - Slack incoming webhook: ignored (channel is fixed by the webhook URL)
   *   - Generic webhook: passed through as a header or query param the
   *     receiver may use for routing
   *   - SMTP: comma-separated email recipients
   */
  publish(channel: string, event: AlertEvent): Promise<boolean>;

  /** Adapter identifier for logging / config matching ("webhook", "slack", etc.). */
  readonly kind: string;
}

/**
 * Format an alert event as a single-line plain-text summary suitable
 * for systems that don't support rich blocks. Used as the fallback
 * rendering when an adapter can't structure the alert.
 */
export function formatAlertPlain(event: AlertEvent): string {
  const verb =
    event.severity === 'recovered'
      ? 'RECOVERED'
      : event.severity === 'alert'
        ? 'ALERT'
        : 'WARN';
  const ratio = event.envelope > 0 ? Math.round((event.value / event.envelope) * 100) : 0;
  return `[${verb}] ${event.projectName}: ${event.metric} = ${event.value} / ${event.envelope} (${ratio}% of envelope; was ${event.priorSeverity}) at ${event.occurredAt}${event.dashboardUrl ? ` -- ${event.dashboardUrl}` : ''}`;
}

/**
 * Format an alert event as a Slack-compatible block payload.
 * Slack incoming webhooks accept this shape directly. Discord and
 * Teams have similar block models but different field names; their
 * adapters call this helper and remap as needed.
 */
export function formatAlertSlackBlocks(event: AlertEvent): {
  text: string;
  blocks: Array<Record<string, unknown>>;
} {
  const emoji =
    event.severity === 'recovered' ? ':white_check_mark:' : event.severity === 'alert' ? ':rotating_light:' : ':warning:';
  const text = formatAlertPlain(event);
  return {
    text, // fallback for notifications/clients without block rendering
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji} *${event.severity.toUpperCase()}* — \`${event.metric}\` in *${event.projectName}*`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Current:*\n${event.value} / ${event.envelope}` },
          {
            type: 'mrkdwn',
            text: `*% of envelope:*\n${event.envelope > 0 ? Math.round((event.value / event.envelope) * 100) : 0}%`,
          },
          { type: 'mrkdwn', text: `*Prior state:*\n${event.priorSeverity}` },
          { type: 'mrkdwn', text: `*Occurred:*\n${event.occurredAt}` },
        ],
      },
      ...(event.dashboardUrl
        ? [
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Open dashboard' },
                  url: event.dashboardUrl,
                },
              ],
            },
          ]
        : []),
    ],
  };
}
