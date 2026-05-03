// Generic-webhook MessagingAdapter (BRD-OPEN-QUESTIONS §30 / ADR-029).
//
// Dispatches alerts via HTTP POST to a configurable webhook URL. Works
// with:
//   - Slack incoming webhooks (https://hooks.slack.com/...)
//   - Discord webhooks (https://discord.com/api/webhooks/...)
//   - Microsoft Teams incoming webhooks (https://outlook.office.com/webhook/...)
//   - Generic JSON receivers (any HTTP service that accepts POST JSON)
//
// Per ADR-029 the GCP-portability discipline keeps Supabase / Vercel
// SDKs out of `lib/` and contained in named adapter files. This adapter
// uses node:fetch (standard) and stays portable.
//
// Per-vendor body shape:
//   - Slack: emits `{ text, blocks }` (formatAlertSlackBlocks output)
//   - Discord: emits `{ content, embeds }` (Discord block model)
//   - Teams: emits `{ text }` (Teams plain-text fallback; Adaptive Cards
//     are configurable but the Teams team has been deprecating webhook-
//     specific shapes — plain text stays compatible across versions)
//   - Generic: emits `{ event, plain }` so adopters can shape their
//     own receiver
//
// Vendor inference: by URL host pattern. Override via the `bodyShape`
// constructor param when adopters want a specific shape regardless of
// URL.

import { formatAlertPlain, formatAlertSlackBlocks } from '../lib/messaging.ts';
import type { AlertEvent, MessagingAdapter } from '../lib/messaging.ts';

export type BodyShape = 'slack' | 'discord' | 'teams' | 'generic';

export interface WebhookMessagingOpts {
  /** Webhook URL. Must be HTTPS in production; HTTP allowed for local dev only. */
  webhookUrl: string;
  /**
   * Override the auto-inferred body shape. Useful when adopters route
   * a Slack-shaped payload through an internal proxy with a non-Slack
   * URL.
   */
  bodyShape?: BodyShape;
  /** Per-call timeout in ms. Default 5s; webhook receivers should be fast. */
  timeoutMs?: number;
  /**
   * Optional headers (e.g., {Authorization: 'Bearer <secret>'} for a
   * generic receiver that requires auth).
   */
  headers?: Record<string, string>;
}

function inferBodyShape(url: string): BodyShape {
  if (url.includes('hooks.slack.com')) return 'slack';
  if (url.includes('discord.com/api/webhooks')) return 'discord';
  if (url.includes('outlook.office.com/webhook') || url.includes('webhook.office.com')) return 'teams';
  return 'generic';
}

function buildBody(shape: BodyShape, event: AlertEvent): unknown {
  const plain = formatAlertPlain(event);
  switch (shape) {
    case 'slack': {
      return formatAlertSlackBlocks(event);
    }
    case 'discord': {
      // Discord webhook body: { content?: string, embeds?: [...] }
      // Use embed for visual emphasis on color (red=alert, yellow=warn, green=recovered)
      const color = event.severity === 'alert' ? 0xed4245 : event.severity === 'warn' ? 0xfaa61a : 0x57f287;
      return {
        content: plain,
        embeds: [
          {
            title: `${event.severity.toUpperCase()}: ${event.metric}`,
            description: `Project: **${event.projectName}**`,
            color,
            fields: [
              { name: 'Current', value: `${event.value} / ${event.envelope}`, inline: true },
              {
                name: '% envelope',
                value:
                  event.envelope > 0
                    ? `${Math.round((event.value / event.envelope) * 100)}%`
                    : 'n/a',
                inline: true,
              },
              { name: 'Prior', value: event.priorSeverity, inline: true },
            ],
            timestamp: event.occurredAt,
            ...(event.dashboardUrl ? { url: event.dashboardUrl } : {}),
          },
        ],
      };
    }
    case 'teams': {
      // Teams incoming webhook body: just `text` works across versions.
      // Adaptive-Card shape is more capable but the spec is in flux;
      // text is the resilient choice.
      return { text: plain };
    }
    case 'generic':
    default: {
      return { event, plain };
    }
  }
}

export function webhookMessagingAdapter(opts: WebhookMessagingOpts): MessagingAdapter {
  const shape = opts.bodyShape ?? inferBodyShape(opts.webhookUrl);
  return {
    kind: shape === 'generic' ? 'webhook' : shape,
    async publish(_channel, event): Promise<boolean> {
      const body = buildBody(shape, event);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
      try {
        const res = await fetch(opts.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(opts.headers ?? {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          console.error(
            `[webhook-messaging:${shape}] publish failed: ${res.status} ${res.statusText}`,
          );
          return false;
        }
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[webhook-messaging:${shape}] publish errored: ${msg}`);
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
