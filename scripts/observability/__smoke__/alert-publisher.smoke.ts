// Smoke test for the observability alert publisher (C1; §30).
//
// Exercises:
//   1. Webhook adapter body shape inference (Slack/Discord/Teams/generic)
//   2. Plain-text + Slack-block formatting helpers
//   3. Publisher state-tracking against an in-memory mock adapter
//      (no real HTTP; no DB writes either — the smoke uses a stub
//      DB connection that captures queries)
//
// Run: `npm run smoke:alert-publisher`

import { Client } from 'pg';
import {
  formatAlertPlain,
  formatAlertSlackBlocks,
  type AlertEvent,
  type MessagingAdapter,
} from '../../coordination/lib/messaging.ts';
import {
  webhookMessagingAdapter,
} from '../../coordination/adapters/webhook-messaging.ts';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

const sampleEvent: AlertEvent = {
  metric: 'sessions_active_per_project',
  severity: 'alert',
  projectId: 'aaaaaaaa-1111-1111-1111-111111111111',
  projectName: 'iaux-smoke',
  value: 25,
  envelope: 20,
  priorSeverity: 'warn',
  occurredAt: '2026-05-03T19:00:00.000Z',
  dashboardUrl: 'https://atelier.example.com/atelier/observability',
};

async function testFormattingHelpers(): Promise<void> {
  console.log('# 1. Formatting helpers');

  const plain = formatAlertPlain(sampleEvent);
  check(
    'formatAlertPlain includes severity verb',
    plain.includes('[ALERT]'),
    plain,
  );
  check(
    'formatAlertPlain includes ratio',
    plain.includes('125% of envelope') || plain.includes('125%'),
    'should compute 25/20 -> 125%',
  );

  const slack = formatAlertSlackBlocks(sampleEvent);
  check('formatAlertSlackBlocks returns text', typeof slack.text === 'string');
  check(
    'formatAlertSlackBlocks returns blocks array',
    Array.isArray(slack.blocks) && slack.blocks.length >= 2,
    `${slack.blocks.length} blocks`,
  );
  check(
    'slack blocks include dashboard button when URL provided',
    slack.blocks.some((b) => b.type === 'actions'),
  );

  // Without dashboard URL: no actions block
  const noUrl = { ...sampleEvent };
  delete (noUrl as { dashboardUrl?: string }).dashboardUrl;
  const slackNoUrl = formatAlertSlackBlocks(noUrl);
  check(
    'slack blocks omit actions when no URL',
    !slackNoUrl.blocks.some((b) => b.type === 'actions'),
  );
}

async function testWebhookAdapterShapeInference(): Promise<void> {
  console.log('# 2. Webhook adapter body shape inference');

  const slackAdapter = webhookMessagingAdapter({
    webhookUrl: 'https://hooks.slack.com/services/T/B/secret',
  });
  check(
    'slack URL inferred as kind=slack',
    slackAdapter.kind === 'slack',
    `got ${slackAdapter.kind}`,
  );

  const discordAdapter = webhookMessagingAdapter({
    webhookUrl: 'https://discord.com/api/webhooks/123/abc',
  });
  check(
    'discord URL inferred as kind=discord',
    discordAdapter.kind === 'discord',
    `got ${discordAdapter.kind}`,
  );

  const teamsAdapter = webhookMessagingAdapter({
    webhookUrl: 'https://outlook.office.com/webhook/abc',
  });
  check(
    'teams URL inferred as kind=teams',
    teamsAdapter.kind === 'teams',
    `got ${teamsAdapter.kind}`,
  );

  const genericAdapter = webhookMessagingAdapter({
    webhookUrl: 'https://internal.example.com/alerts',
  });
  check(
    'arbitrary URL falls back to kind=webhook',
    genericAdapter.kind === 'webhook',
    `got ${genericAdapter.kind}`,
  );

  const overrideAdapter = webhookMessagingAdapter({
    webhookUrl: 'https://internal.example.com/alerts',
    bodyShape: 'slack',
  });
  check(
    'explicit bodyShape overrides URL inference',
    overrideAdapter.kind === 'slack',
    `got ${overrideAdapter.kind}`,
  );
}

async function testWebhookAdapterPublishMockServer(): Promise<void> {
  console.log('# 3. Webhook adapter publish (mock HTTP receiver)');

  // Spin up a tiny HTTP server that captures POST bodies and returns 200.
  const { createServer } = await import('node:http');
  let captured: { method: string | undefined; body: unknown } = {
    method: undefined,
    body: undefined,
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        captured = { method: req.method, body: JSON.parse(body) };
      } catch {
        captured = { method: req.method, body };
      }
      res.statusCode = 200;
      res.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  try {
    const adapter = webhookMessagingAdapter({
      webhookUrl: `http://127.0.0.1:${port}/alerts`,
    });
    const ok = await adapter.publish('default', sampleEvent);
    check('publish returns true on 200 OK', ok === true);
    check('captured method was POST', captured.method === 'POST');
    check(
      'captured body shape includes event',
      typeof captured.body === 'object' &&
        captured.body !== null &&
        'event' in (captured.body as Record<string, unknown>),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // Failure path: connect to a port nothing is listening on
  const failingAdapter = webhookMessagingAdapter({
    webhookUrl: 'http://127.0.0.1:1/alerts', // port 1 reserved; nothing should bind
    timeoutMs: 1000,
  });
  const ok = await failingAdapter.publish('default', sampleEvent);
  check('publish returns false on transport error', ok === false);
}

async function testPublisherStateTracking(): Promise<void> {
  console.log('# 4. Publisher state tracking (against real DB)');

  const DB_URL =
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const pg = new Client({ connectionString: DB_URL });
  try {
    await pg.connect();
  } catch {
    console.log('  SKIP  no local Postgres reachable; skipping DB-backed checks');
    return;
  }

  // Create a throwaway project so the smoke doesn't pollute real data.
  const projectId = '11111111-2222-3333-4444-555555555555';
  await pg.query(`DELETE FROM telemetry WHERE project_id = $1::uuid`, [projectId]);
  await pg.query(`DELETE FROM projects WHERE id = $1::uuid`, [projectId]);
  await pg.query(
    `INSERT INTO projects (id, name, repo_url, template_version)
     VALUES ($1::uuid, 'alert-publisher-smoke', 'https://example.invalid/aps', '1.0')`,
    [projectId],
  );

  // Mock adapter that captures publish calls.
  const captured: AlertEvent[] = [];
  const mock: MessagingAdapter = {
    kind: 'mock',
    async publish(_channel, event) {
      captured.push(event);
      return true;
    },
  };

  const { runOnce } = await import('../alert-publisher.ts');

  // First run: scoped check on this project's transitions only. Other
  // projects in the DB (lens-smoke, iaux-smoke, scale-harness from prior
  // sessions) may have their own transitions; we don't assert on them.
  const r1 = await runOnce({
    databaseUrl: DB_URL,
    config: {
      thresholds: {
        sessionsActivePerProject: 20,
        contributionsLifetimePerProject: 10000,
        decisionsLifetimePerProject: 500,
        locksHeldConcurrentPerProject: 20,
        triagePendingBacklog: 25,
        syncLagSecondsP95: 300,
        costUsdPerDayPerProject: 10,
      },
      alerts: {
        channels: [],
        routes: [
          { metric: 'sessions_active_per_project', channel: 'mock', minSeverity: 'warn' },
        ],
      },
    },
    adapters: new Map([['mock', mock]]),
    dashboardBaseUrl: undefined,
  });
  const r1OurProject = captured.filter((e) => e.projectId === projectId);
  check(
    'first run with empty data for THIS project: 0 publishes',
    r1OurProject.length === 0,
    `got ${r1OurProject.length}; total transitions across all projects: ${r1.transitionsDetected}`,
  );

  // Now insert sessions to trigger an alert: 25 active sessions -> > 100% envelope
  for (let i = 0; i < 25; i++) {
    await pg.query(
      `INSERT INTO composers (id, project_id, email, display_name, discipline, access_level, identity_subject, status)
       VALUES (gen_random_uuid(), $1::uuid, $2, $3, 'dev', 'member', $4, 'active')
       ON CONFLICT DO NOTHING`,
      [projectId, `c${i}@aps.invalid`, `Composer ${i}`, `aps-c-${i}`],
    );
  }
  const { rows: comps } = await pg.query<{ id: string }>(
    `SELECT id FROM composers WHERE project_id = $1::uuid`,
    [projectId],
  );
  for (const c of comps) {
    await pg.query(
      `INSERT INTO sessions (project_id, composer_id, surface, agent_client, status, heartbeat_at)
       VALUES ($1::uuid, $2::uuid, 'web', 'claude.ai', 'active', now())`,
      [projectId, c.id],
    );
  }

  // Second run: sessions=25, envelope=20 -> alert -> publishes
  captured.length = 0;
  const r2 = await runOnce({
    databaseUrl: DB_URL,
    config: {
      thresholds: {
        sessionsActivePerProject: 20,
        contributionsLifetimePerProject: 10000,
        decisionsLifetimePerProject: 500,
        locksHeldConcurrentPerProject: 20,
        triagePendingBacklog: 25,
        syncLagSecondsP95: 300,
        costUsdPerDayPerProject: 10,
      },
      alerts: {
        channels: [],
        routes: [
          { metric: 'sessions_active_per_project', channel: 'mock', minSeverity: 'warn' },
        ],
      },
    },
    adapters: new Map([['mock', mock]]),
    dashboardBaseUrl: undefined,
  });
  const r2OurProject = captured.filter((e) => e.projectId === projectId);
  check(
    'after 25 sessions seeded: this project published a sessions alert',
    r2OurProject.some((e) => e.metric === 'sessions_active_per_project'),
    `captured ${r2OurProject.length} events for this project; total ${r2.transitionsDetected}`,
  );
  if (r2OurProject.length > 0) {
    const sessAlert = r2OurProject.find((e) => e.metric === 'sessions_active_per_project');
    check(
      'published event for sessions has severity=alert (25 > 20 envelope)',
      sessAlert?.severity === 'alert',
      `got ${sessAlert?.severity}`,
    );
  }

  // Third run: same data, no severity change => no new transitions
  captured.length = 0;
  const r3 = await runOnce({
    databaseUrl: DB_URL,
    config: {
      thresholds: {
        sessionsActivePerProject: 20,
        contributionsLifetimePerProject: 10000,
        decisionsLifetimePerProject: 500,
        locksHeldConcurrentPerProject: 20,
        triagePendingBacklog: 25,
        syncLagSecondsP95: 300,
        costUsdPerDayPerProject: 10,
      },
      alerts: {
        channels: [],
        routes: [
          { metric: 'sessions_active_per_project', channel: 'mock', minSeverity: 'warn' },
        ],
      },
    },
    adapters: new Map([['mock', mock]]),
    dashboardBaseUrl: undefined,
  });
  const r3OurProject = captured.filter((e) => e.projectId === projectId);
  check(
    'third run with no change for THIS project: 0 publishes (state-tracking suppresses repeat)',
    r3OurProject.length === 0,
    `captured ${r3OurProject.length} events for this project; total transitions=${r3.transitionsDetected}`,
  );

  // Cleanup
  await pg.query(`DELETE FROM telemetry WHERE project_id = $1::uuid`, [projectId]);
  await pg.query(`DELETE FROM sessions WHERE project_id = $1::uuid`, [projectId]);
  await pg.query(`DELETE FROM composers WHERE project_id = $1::uuid`, [projectId]);
  await pg.query(`DELETE FROM projects WHERE id = $1::uuid`, [projectId]);
  await pg.end();
}

async function main(): Promise<void> {
  await testFormattingHelpers();
  await testWebhookAdapterShapeInference();
  await testWebhookAdapterPublishMockServer();
  await testPublisherStateTracking();

  console.log('');
  if (failures === 0) {
    console.log('alert-publisher smoke: PASS');
    process.exit(0);
  }
  console.log(`alert-publisher smoke: FAIL (${failures} failures)`);
  process.exit(1);
}

main().catch((err) => {
  console.error('alert-publisher smoke: fatal:', err);
  process.exit(1);
});
