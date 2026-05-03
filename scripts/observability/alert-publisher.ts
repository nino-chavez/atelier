#!/usr/bin/env -S npx tsx
//
// Observability alert publisher (BRD-OPEN-QUESTIONS §30 / ARCH §8.3).
//
// Polls the same metrics the /atelier/observability dashboard renders,
// computes severity per the same `severityFor()` helper the UI uses,
// and dispatches notifications through configured messaging adapters
// when severity transitions (ok->warn, ok->alert, warn->alert, or any
// drop back to ok = `recovered`).
//
// State tracking: the publisher records the LAST observed severity per
// (project_id, metric) tuple in the telemetry table under
// `action='alert.last_state.<metric>'`. On each tick, it reads the
// last_state row for each metric and compares against the current
// observed severity — only fires when they differ. This:
//   - Prevents continuous alert spam while a metric stays in the same band
//   - Survives publisher restarts (state lives in Postgres, not memory)
//   - Surfaces in /atelier/observability under the cost section
//     (telemetry rows tagged 'alert.*')
//
// Run modes:
//   1. one-shot: `npx tsx scripts/observability/alert-publisher.ts`
//      Evaluates once, publishes any transitions, exits. Wire to a
//      cron (Vercel Cron, GCP Scheduler, etc.) for periodic execution.
//   2. continuous: `... --interval 300` (seconds)
//      Loops, evaluating every N seconds. Use for long-running deploys
//      where wiring a cron is more friction than running this as a
//      service.
//
// Per the §30 trigger: this is the v1.x deliverable that lands when an
// adopter requests out-of-band ops alerts. No adopter-driven channel
// preference yet, so the v1 implementation supports the generic-webhook
// adapter (which works with Slack/Discord/Teams incoming webhooks
// out-of-the-box per webhook-messaging.ts vendor inference).

import { Client, type QueryResult } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { webhookMessagingAdapter } from '../coordination/adapters/webhook-messaging.ts';
import type {
  AlertEvent,
  AlertSeverity,
  MessagingAdapter,
} from '../coordination/lib/messaging.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface AlertChannelConfig {
  name: string;
  webhookUrl: string;
  headers?: Record<string, string>;
}

interface AlertRouteConfig {
  metric: string;
  channel: string;
  /** Optional severity floor (default warn): only fire alerts at or above this severity. */
  minSeverity?: AlertSeverity | 'recovered';
}

interface ObservabilityAlertsConfig {
  channels: AlertChannelConfig[];
  routes: AlertRouteConfig[];
  /** Optional dashboard base URL ("https://atelier.example.com"). Used for "Open dashboard" buttons. */
  dashboardBaseUrl?: string;
}

interface ObservabilityThresholds {
  sessionsActivePerProject: number;
  contributionsLifetimePerProject: number;
  decisionsLifetimePerProject: number;
  locksHeldConcurrentPerProject: number;
  triagePendingBacklog: number;
  syncLagSecondsP95: number;
  costUsdPerDayPerProject: number;
}

interface AppConfig {
  thresholds: ObservabilityThresholds;
  alerts: ObservabilityAlertsConfig | null;
}

const DEFAULT_THRESHOLDS: ObservabilityThresholds = {
  sessionsActivePerProject: 20,
  contributionsLifetimePerProject: 10000,
  decisionsLifetimePerProject: 500,
  locksHeldConcurrentPerProject: 20,
  triagePendingBacklog: 25,
  syncLagSecondsP95: 300,
  costUsdPerDayPerProject: 10,
};

function loadConfig(repoRoot: string): AppConfig {
  const path = join(repoRoot, '.atelier', 'config.yaml');
  if (!existsSync(path)) {
    return { thresholds: DEFAULT_THRESHOLDS, alerts: null };
  }
  const raw = parseYaml(readFileSync(path, 'utf-8')) as
    | {
        observability?: {
          thresholds?: Partial<{
            sessions_active_per_project: number;
            contributions_lifetime_per_project: number;
            decisions_lifetime_per_project: number;
            locks_held_concurrent_per_project: number;
            triage_pending_backlog: number;
            sync_lag_seconds_p95: number;
            cost_usd_per_day_per_project: number;
          }>;
          alerts?: {
            dashboard_base_url?: string;
            channels?: Array<{
              name: string;
              webhook_url: string;
              headers?: Record<string, string>;
            }>;
            routes?: Array<{
              metric: string;
              channel: string;
              min_severity?: 'warn' | 'alert' | 'recovered';
            }>;
          };
        };
      }
    | null;
  const t = raw?.observability?.thresholds ?? {};
  const a = raw?.observability?.alerts;
  return {
    thresholds: {
      sessionsActivePerProject:
        t.sessions_active_per_project ?? DEFAULT_THRESHOLDS.sessionsActivePerProject,
      contributionsLifetimePerProject:
        t.contributions_lifetime_per_project ?? DEFAULT_THRESHOLDS.contributionsLifetimePerProject,
      decisionsLifetimePerProject:
        t.decisions_lifetime_per_project ?? DEFAULT_THRESHOLDS.decisionsLifetimePerProject,
      locksHeldConcurrentPerProject:
        t.locks_held_concurrent_per_project ?? DEFAULT_THRESHOLDS.locksHeldConcurrentPerProject,
      triagePendingBacklog: t.triage_pending_backlog ?? DEFAULT_THRESHOLDS.triagePendingBacklog,
      syncLagSecondsP95: t.sync_lag_seconds_p95 ?? DEFAULT_THRESHOLDS.syncLagSecondsP95,
      costUsdPerDayPerProject:
        t.cost_usd_per_day_per_project ?? DEFAULT_THRESHOLDS.costUsdPerDayPerProject,
    },
    alerts: a
      ? {
          channels: (a.channels ?? []).map((c) => ({
            name: c.name,
            webhookUrl: c.webhook_url,
            ...(c.headers ? { headers: c.headers } : {}),
          })),
          routes: (a.routes ?? []).map((r) => ({
            metric: r.metric,
            channel: r.channel,
            ...(r.min_severity ? { minSeverity: r.min_severity } : {}),
          })),
          ...(a.dashboard_base_url ? { dashboardBaseUrl: a.dashboard_base_url } : {}),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Severity helpers (mirrors prototype/src/lib/atelier/observability-config.ts)
// ---------------------------------------------------------------------------

function severityFor(value: number, envelope: number): AlertSeverity | 'ok' {
  if (envelope <= 0) return 'ok';
  const ratio = value / envelope;
  if (ratio >= 1) return 'alert';
  if (ratio >= 0.8) return 'warn';
  return 'ok';
}

function severityRank(s: AlertSeverity | 'ok'): number {
  if (s === 'ok') return 0;
  if (s === 'recovered') return 0;
  if (s === 'warn') return 1;
  return 2;
}

// ---------------------------------------------------------------------------
// Metric collectors — query Postgres directly (matches observability-data.ts
// patterns but doesn't go through the lens-deps stack).
// ---------------------------------------------------------------------------

interface MetricSample {
  metric: string;
  projectId: string;
  projectName: string;
  value: number;
  envelope: number;
}

async function collectMetrics(
  pg: Client,
  thresholds: ObservabilityThresholds,
): Promise<MetricSample[]> {
  const out: MetricSample[] = [];
  const { rows: projects } = await pg.query<{ id: string; name: string }>(
    `SELECT id, name FROM projects`,
  );
  for (const p of projects) {
    // sessions_active_per_project
    const sessions = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sessions
        WHERE project_id = $1 AND status = 'active' AND heartbeat_at > now() - interval '15 minutes'`,
      [p.id],
    );
    out.push({
      metric: 'sessions_active_per_project',
      projectId: p.id,
      projectName: p.name,
      value: Number(sessions.rows[0]?.count ?? '0'),
      envelope: thresholds.sessionsActivePerProject,
    });

    // contributions_lifetime_per_project
    const contribs = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM contributions WHERE project_id = $1`,
      [p.id],
    );
    out.push({
      metric: 'contributions_lifetime_per_project',
      projectId: p.id,
      projectName: p.name,
      value: Number(contribs.rows[0]?.count ?? '0'),
      envelope: thresholds.contributionsLifetimePerProject,
    });

    // locks_held_concurrent_per_project
    const locks = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM locks WHERE project_id = $1`,
      [p.id],
    );
    out.push({
      metric: 'locks_held_concurrent_per_project',
      projectId: p.id,
      projectName: p.name,
      value: Number(locks.rows[0]?.count ?? '0'),
      envelope: thresholds.locksHeldConcurrentPerProject,
    });

    // triage_pending_backlog
    const triage = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM triage_pending
        WHERE project_id = $1 AND state = 'pending'`,
      [p.id],
    ).catch(() => ({ rows: [{ count: '0' }] }) as QueryResult<{ count: string }>);
    out.push({
      metric: 'triage_pending_backlog',
      projectId: p.id,
      projectName: p.name,
      value: Number(triage.rows[0]?.count ?? '0'),
      envelope: thresholds.triagePendingBacklog,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// State tracking — last observed severity per (project, metric)
// ---------------------------------------------------------------------------

async function loadLastSeverities(
  pg: Client,
): Promise<Map<string, AlertSeverity | 'ok'>> {
  // Read the most recent alert.last_state.* telemetry row per
  // (project_id, action) — that's the "previous severity" we last observed.
  const { rows } = await pg.query<{
    project_id: string;
    action: string;
    metadata: { severity?: string };
  }>(
    `SELECT DISTINCT ON (project_id, action) project_id, action, metadata
       FROM telemetry
      WHERE action LIKE 'alert.last_state.%'
      ORDER BY project_id, action, created_at DESC`,
  );
  const out = new Map<string, AlertSeverity | 'ok'>();
  for (const r of rows) {
    const metric = r.action.replace(/^alert\.last_state\./, '');
    const sev = (r.metadata.severity ?? 'ok') as AlertSeverity | 'ok';
    out.set(keyFor(r.project_id, metric), sev);
  }
  return out;
}

function keyFor(projectId: string, metric: string): string {
  return `${projectId}:${metric}`;
}

async function recordSeverity(
  pg: Client,
  projectId: string,
  metric: string,
  severity: AlertSeverity | 'ok',
): Promise<void> {
  await pg.query(
    `INSERT INTO telemetry (project_id, action, outcome, metadata)
     VALUES ($1::uuid, $2, 'ok', $3::jsonb)`,
    [projectId, `alert.last_state.${metric}`, JSON.stringify({ severity })],
  );
}

// ---------------------------------------------------------------------------
// Publisher loop
// ---------------------------------------------------------------------------

interface PublisherOpts {
  databaseUrl: string;
  config: AppConfig;
  adapters: Map<string, MessagingAdapter>;
  dashboardBaseUrl: string | undefined;
  /** When true, evaluate but don't publish (used by smoke tests). */
  dryRun?: boolean;
}

interface PublisherResult {
  evaluated: number;
  transitionsDetected: number;
  transitionsPublished: number;
  errors: number;
}

export async function runOnce(opts: PublisherOpts): Promise<PublisherResult> {
  const pg = new Client({ connectionString: opts.databaseUrl });
  await pg.connect();
  const result: PublisherResult = {
    evaluated: 0,
    transitionsDetected: 0,
    transitionsPublished: 0,
    errors: 0,
  };
  try {
    const samples = await collectMetrics(pg, opts.config.thresholds);
    const lastSeverities = await loadLastSeverities(pg);
    result.evaluated = samples.length;

    for (const s of samples) {
      const current = severityFor(s.value, s.envelope);
      const prior = lastSeverities.get(keyFor(s.projectId, s.metric)) ?? 'ok';
      if (current === prior) continue;

      result.transitionsDetected += 1;

      // Determine event severity: drop back to ok = recovered.
      const eventSeverity: AlertSeverity =
        current === 'ok' ? 'recovered' : current;

      // Skip publish below configured min severity (per route config).
      const route = opts.config.alerts?.routes.find((r) => r.metric === s.metric);
      if (!route) {
        // No route for this metric — record state to suppress repeat detection,
        // but don't publish.
        if (!opts.dryRun) await recordSeverity(pg, s.projectId, s.metric, current);
        continue;
      }
      const minSev = route.minSeverity ?? 'warn';
      if (severityRank(eventSeverity) < severityRank(minSev as AlertSeverity)) {
        if (!opts.dryRun) await recordSeverity(pg, s.projectId, s.metric, current);
        continue;
      }

      const adapter = opts.adapters.get(route.channel);
      if (!adapter) {
        console.warn(
          `[alert-publisher] route for ${s.metric} references unknown channel "${route.channel}"`,
        );
        result.errors += 1;
        continue;
      }

      const event: AlertEvent = {
        metric: s.metric,
        severity: eventSeverity,
        projectId: s.projectId,
        projectName: s.projectName,
        value: s.value,
        envelope: s.envelope,
        priorSeverity: prior,
        occurredAt: new Date().toISOString(),
        ...(opts.dashboardBaseUrl
          ? {
              dashboardUrl: `${opts.dashboardBaseUrl}/atelier/observability`,
            }
          : {}),
      };

      if (!opts.dryRun) {
        const ok = await adapter.publish(route.channel, event);
        if (ok) {
          result.transitionsPublished += 1;
          await recordSeverity(pg, s.projectId, s.metric, current);
        } else {
          result.errors += 1;
          // Don't record state on failed publish — next tick re-tries.
        }
      } else {
        result.transitionsPublished += 1;
        console.log(`[alert-publisher:dry-run] would publish: ${event.metric} ${prior}→${current}`);
      }
    }
  } finally {
    await pg.end();
  }
  return result;
}

function buildAdapters(
  channels: AlertChannelConfig[],
): Map<string, MessagingAdapter> {
  const out = new Map<string, MessagingAdapter>();
  for (const c of channels) {
    out.set(
      c.name,
      webhookMessagingAdapter({
        webhookUrl: c.webhookUrl,
        ...(c.headers ? { headers: c.headers } : {}),
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

async function cli(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = args.repoRoot ?? process.cwd();
  const databaseUrl =
    args.databaseUrl ??
    process.env.ATELIER_DATASTORE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

  const config = loadConfig(repoRoot);
  if (!config.alerts || config.alerts.channels.length === 0) {
    console.log(
      '[alert-publisher] no alerts.channels configured in .atelier/config.yaml; nothing to do',
    );
    return;
  }
  const adapters = buildAdapters(config.alerts.channels);
  const opts: PublisherOpts = {
    databaseUrl,
    config,
    adapters,
    dashboardBaseUrl: config.alerts.dashboardBaseUrl,
    ...(args.dryRun ? { dryRun: true } : {}),
  };

  if (args.intervalSec === undefined) {
    const r = await runOnce(opts);
    console.log(
      `[alert-publisher] one-shot complete: evaluated=${r.evaluated} transitions=${r.transitionsDetected} published=${r.transitionsPublished} errors=${r.errors}`,
    );
    process.exit(r.errors > 0 ? 1 : 0);
  } else {
    console.log(`[alert-publisher] continuous mode; interval=${args.intervalSec}s`);
    while (true) {
      const r = await runOnce(opts);
      console.log(
        `[alert-publisher] tick: evaluated=${r.evaluated} transitions=${r.transitionsDetected} published=${r.transitionsPublished} errors=${r.errors}`,
      );
      await new Promise((resolve) => setTimeout(resolve, args.intervalSec! * 1000));
    }
  }
}

interface CliArgs {
  repoRoot?: string;
  databaseUrl?: string;
  intervalSec?: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: { repoRoot?: string; databaseUrl?: string; intervalSec?: number; dryRun: boolean } = {
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a === '--interval' && argv[i + 1]) {
      out.intervalSec = parseInt(argv[i + 1]!, 10);
      i += 1;
    } else if (a === '--repo-root' && argv[i + 1]) {
      out.repoRoot = argv[i + 1]!;
      i += 1;
    } else if (a === '--database-url' && argv[i + 1]) {
      out.databaseUrl = argv[i + 1]!;
      i += 1;
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cli().catch((err) => {
    console.error('[alert-publisher] fatal:', err);
    process.exit(1);
  });
}
