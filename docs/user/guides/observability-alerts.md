---
trace_id: BRD:Epic-12
related_questions: [BRD-OPEN-QUESTIONS-30]
audience: ops
status: v1
last_reviewed: 2026-05-03
---

# Out-of-band observability alerts

**Audience:** Ops operators wanting Slack / Discord / Teams / generic-webhook notifications when Atelier metrics cross thresholds.

**Status:** v1 deliverable (closes BRD-OPEN-QUESTIONS §30 publisher portion). Quiet hours, ack-from-channel, and exponential-backoff polish are filed for future v1.x signal.

---

## What ships at v1

- **Publisher script:** `scripts/observability/alert-publisher.ts`
- **Adapter interface:** `scripts/coordination/lib/messaging.ts` (`MessagingAdapter`)
- **Generic webhook adapter:** `scripts/coordination/adapters/webhook-messaging.ts` — auto-detects Slack / Discord / Teams / generic by URL host, formats payload accordingly
- **Config schema:** `.atelier/config.yaml: observability.alerts` — channels + per-metric routes
- **State tracking:** transitions stored as `telemetry.action='alert.last_state.<metric>'` rows; survives publisher restarts

## What this is NOT

- Not a replacement for the `/atelier/observability` dashboard. The dashboard remains the canonical visibility surface; out-of-band alerts are a notification overlay.
- Not a metrics pipeline. The publisher polls the existing telemetry/sessions/locks tables — it doesn't introduce a separate metrics store.
- Not on-call rotation management. Adopters using PagerDuty / Opsgenie route through them via webhook; this publisher just dispatches to a webhook URL.

---

## Setup

### 1. Pick destination(s) and obtain webhook URLs

- **Slack:** Apps → "Incoming Webhooks" → activate → add to channel → copy URL (`https://hooks.slack.com/services/...`)
- **Discord:** Channel settings → Integrations → Webhooks → New Webhook → copy URL (`https://discord.com/api/webhooks/...`)
- **Microsoft Teams:** Channel → ⋯ → Connectors → Incoming Webhook → copy URL (`https://outlook.office.com/webhook/...`)
- **Generic receiver:** any HTTPS endpoint that accepts `POST` with JSON body

### 2. Add channels + routes to `.atelier/config.yaml`

```yaml
observability:
  alerts:
    dashboard_base_url: "https://atelier.example.com"
    channels:
      - name: "ops-on-call"
        webhook_url: "${OPS_SLACK_WEBHOOK_URL}"
      - name: "finance"
        webhook_url: "${FINANCE_DISCORD_WEBHOOK_URL}"
    routes:
      - metric: "sessions_active_per_project"
        channel: "ops-on-call"
        min_severity: "warn"
      - metric: "locks_held_concurrent_per_project"
        channel: "ops-on-call"
        min_severity: "alert"
      - metric: "cost_usd_per_day_per_project"
        channel: "finance"
        min_severity: "alert"
```

The `${VAR_NAME}` substitution lets you keep webhook secrets out of the repo. Resolve via `vercel env pull` (Vercel deploy) or your host's secret manager.

### 3. Run the publisher

**One-shot** (good for cron / scheduler integration):

```bash
POSTGRES_URL=postgresql://... \
OPS_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... \
  npm run alert-publisher
```

**Continuous** (good for long-running deployments without a cron):

```bash
POSTGRES_URL=... OPS_SLACK_WEBHOOK_URL=... \
  npx tsx scripts/observability/alert-publisher.ts --interval 300
```

`--interval` is in seconds. 300s = 5 minutes is the recommended default; faster than the dashboard's 30s poll is unnecessary noise.

**Dry run** (evaluates state but doesn't publish or persist):

```bash
POSTGRES_URL=... npm run alert-publisher -- --dry-run
```

### 4. Wire to your scheduler (recommended for production)

**Vercel Cron** (per ADR-046 reference deploy):

Add to `vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron/alert-publisher", "schedule": "*/5 * * * *" }]
}
```

Then add the route handler at `prototype/src/app/api/cron/alert-publisher/route.ts` that invokes `runOnce()` directly. (v1.x polish: ship this route handler in-tree once first adopter adds it.)

**GCP Cloud Scheduler** (per `docs/migration-to-gcp.md`):

```bash
gcloud scheduler jobs create http alert-publisher \
  --schedule="*/5 * * * *" \
  --uri="https://atelier.example.com/api/cron/alert-publisher" \
  --http-method=POST
```

**Local cron** (development):

```cron
*/5 * * * * cd /path/to/atelier && /usr/local/bin/npm run alert-publisher
```

---

## What metrics are alertable at v1

Publisher polls these on each tick (per project in the datastore):

| Metric | Source | Default envelope |
|---|---|---|
| `sessions_active_per_project` | sessions table; status='active' AND heartbeat <15min | 20 |
| `contributions_lifetime_per_project` | contributions COUNT | 10000 |
| `locks_held_concurrent_per_project` | locks COUNT | 20 |
| `triage_pending_backlog` | triage_pending state='pending' COUNT | 25 |

Envelopes come from `.atelier/config.yaml: observability.thresholds`. Severity computation matches the dashboard's UI bands:
- `ok` — value < 80% of envelope
- `warn` — 80% to <100%
- `alert` — ≥100%

Publishes fire on **transitions**, not on each tick (state tracking via telemetry rows). A metric staying in `alert` for an hour publishes once; dropping back to `ok` publishes a `recovered` event.

Metrics not yet alertable at v1: `decisions_lifetime_per_project`, `vector_index_rows_per_guild`, `sync_lag_seconds_p95`, `cost_usd_per_day_per_project` — these require lookback computation the publisher doesn't yet wire. Filed as v1.x publisher polish.

---

## Per-channel formatting

The webhook adapter infers vendor by URL host:

- **Slack** (`hooks.slack.com`): emits `{text, blocks}` — uses block rendering with severity emoji + dashboard button
- **Discord** (`discord.com/api/webhooks`): emits `{content, embeds}` — uses colored embed (red/yellow/green) with field grid
- **Teams** (`outlook.office.com/webhook` or `webhook.office.com`): emits `{text}` — plain-text fallback (Adaptive Card spec is in flux; text stays compatible)
- **Generic** (anything else): emits `{event, plain}` — full event object + plain-text summary so adopters can shape their own receiver

Override via `webhookMessagingAdapter({ webhookUrl, bodyShape: 'slack' })` in code if your receiver expects a specific shape behind a non-canonical URL.

---

## Testing your setup

The smoke includes a real HTTP-receiver test:

```bash
npm run smoke:alert-publisher
```

To send one real test alert through your configured channel without seeding metric data:

```bash
# 1. Manually insert a transition row in telemetry
psql $POSTGRES_URL -c "
  INSERT INTO telemetry (project_id, action, outcome, metadata)
  VALUES (
    '<your-project-uuid>'::uuid,
    'alert.last_state.sessions_active_per_project',
    'ok',
    '{\"severity\": \"ok\"}'::jsonb
  );"

# 2. Insert 25 active sessions to push value past envelope
# (your existing test composers; or seed via scripts/bootstrap/seed-composer.ts)

# 3. Run the publisher
npm run alert-publisher

# Expected: severity transitions ok->alert; webhook fires.
```

---

## Failure mode

The publisher logs and continues on per-channel failures. State is **only** recorded as transitioned when the publish succeeds — this means a flaky webhook receiver causes the next publisher tick to retry the same transition.

If a webhook URL is permanently broken (deleted incoming-webhook, revoked Slack app, etc.), the publisher will keep retrying every tick. Diagnose by tailing publisher logs for `[webhook-messaging:<kind>] publish failed: ...` lines and either fix the URL or remove the route from `.atelier/config.yaml`.

---

## Concurrent publishers (advisory lock)

Each `runOnce` call wraps its per-tick body in a Postgres transaction-scoped advisory lock keyed off `hashtextextended('atelier-alert-publisher', 0)`. If you run two publishers against the same datastore at the same time — for example a Vercel Cron schedule plus a long-running `npm run alert-publisher --interval 30` process — the second runner blocks until the first commits, then sees the recorded `alert.last_state.*` rows and treats every metric as already-published. The net effect: each severity transition fires exactly one notification regardless of how many publisher instances are racing.

Operators do not need to configure this; it is on by default. The lock is held only for the duration of one tick (typically <1s in practice), so there is no risk of stalling a long-running publisher behind another.

X1 audit D1.

---

## Adopter signal (what would change v1.x)

Per BRD-OPEN-QUESTIONS §30's "trigger to land" rationale, the publisher v1 implementation lands when an adopter requests out-of-band ops alerts. Future polish that v1.x signal would inform:

1. **Quiet hours / ack-from-channel** — respect operator-set quiet windows; allow ack from messaging surface to suppress repeats until next state transition
2. **Backoff on flap** — exponential backoff when a metric oscillates between warn and alert
3. **Per-vendor rich rendering** — Adaptive Cards for Teams; Block Kit accessory rendering for Slack; richer Discord embeds
4. **Cost / sync-lag publishers** — wire the metrics not yet polled (see "What metrics are alertable" above)
5. **PagerDuty / Opsgenie native adapters** — direct API integrations vs webhook indirection (current path: route their incoming webhook through the generic adapter; works but lacks deduplication / priority semantics native APIs offer)

---

## Cross-references

- BRD-OPEN-QUESTIONS §30 — design rationale + v1.x deferral list
- ARCH §8.3 — observability sink + alert architecture
- `prototype/src/lib/atelier/observability-config.ts` — severity calculator (mirrors publisher logic)
- `scripts/coordination/lib/messaging.ts` — adapter interface
- `scripts/coordination/adapters/webhook-messaging.ts` — generic webhook implementation
- `scripts/observability/alert-publisher.ts` — publisher script
- `scripts/observability/__smoke__/alert-publisher.smoke.ts` — smoke test
- `.atelier/config.yaml` — schema for `observability.alerts` block
