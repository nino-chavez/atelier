#!/usr/bin/env -S npx tsx
//
// Jira delivery adapter smoke test. Uses an injected fake `fetch` so the
// adapter can be exercised end-to-end without hitting the live API.
//
// Two layers (mirrors github.smoke.ts):
//   [A] Pure adapter tests against mocked fetch (no DB).
//   [B] Integration with publish-delivery + delivery_sync_state against
//       local Supabase (still mocked fetch). [B] self-disables with an
//       explicit SKIP line if DATABASE_URL is unreachable (Q1 pattern
//       from X1: smokes must not silently pass when their substrate is
//       absent).

import { Client } from 'pg';
import {
  JiraDeliveryAdapter,
  JiraHttpError,
  type JiraAdapterConfig,
} from '../lib/jira.ts';
import {
  registerDeliveryAdapter,
  resolveDeliveryAdapter,
} from '../lib/adapters.ts';
import { getEventBus, resetEventBus } from '../lib/event-bus.ts';
import { pollOnce, registerSubscriber } from '../publish-delivery.ts';
import { pullForProject } from '../mirror-delivery.ts';
import { AtelierClient } from '../lib/write.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const BASE_URL = 'https://atelier-test.atlassian.net';
const PROJECT_KEY = 'ATL';
const API_TOKEN = 'jira-test-api-token-do-not-leak';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

// =========================================================================
// Fake fetch
// =========================================================================

interface CapturedRequest {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

interface MockResponse {
  matcher: (req: CapturedRequest) => boolean;
  status?: number;
  json?: unknown;
  body?: string;
}

function makeFakeFetch(responses: MockResponse[]) {
  const captured: CapturedRequest[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const req: CapturedRequest = { method, url, body, headers };
    captured.push(req);

    const match = responses.find((r) => r.matcher(req));
    if (!match) {
      return new Response(JSON.stringify({ message: 'no mock matched' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const status = match.status ?? 200;
    if (status === 204) return new Response(null, { status });
    const responseBody = match.json !== undefined ? JSON.stringify(match.json) : (match.body ?? '');
    return new Response(responseBody, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetch: fakeFetch, captured };
}

function makeAdapter(extra?: Partial<JiraAdapterConfig>) {
  const responses: MockResponse[] = [];
  const dispatch = makeFakeFetch(responses);
  const adapter = new JiraDeliveryAdapter({
    baseUrl: BASE_URL,
    email: 'smoke@atelier.test',
    apiToken: API_TOKEN,
    projectKey: PROJECT_KEY,
    fetch: dispatch.fetch,
    ...(extra ?? {}),
  });
  return { adapter, responses, captured: dispatch.captured };
}

// =========================================================================
// Layer A: pure adapter tests
// =========================================================================

async function testUpsertIssueCreate(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/rest/api/2/issue'),
      status: 201,
      json: { id: '10001', key: 'ATL-42', self: `${BASE_URL}/rest/api/2/issue/10001` },
    },
    {
      matcher: (r) => r.method === 'GET' && r.url.endsWith('/rest/api/2/issue/ATL-42/transitions'),
      json: {
        transitions: [
          { id: '11', name: 'To Do',       to: { id: '10', name: 'To Do' } },
          { id: '21', name: 'Start',       to: { id: '20', name: 'In Progress' } },
        ],
      },
    },
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/rest/api/2/issue/ATL-42/transitions'),
      status: 204,
    },
  );

  const result = await adapter.upsertIssue({
    contributionId: 'c1',
    projectId: 'p1',
    kind: 'implementation',
    state: 'claimed',
    traceIds: ['US-2.1'],
    summary: 'Hello world',
    bodyMarkdown: 'Some body',
  });
  check('upsertIssue create returns external id (key)', result.externalId === 'ATL-42');
  check('upsertIssue create returns browse URL', result.externalUrl === `${BASE_URL}/browse/ATL-42`);

  const post = captured.find((r) => r.method === 'POST' && r.url.endsWith('/rest/api/2/issue'));
  check('upsertIssue posted to /rest/api/2/issue', post !== undefined);

  const created = (post?.body ?? {}) as { fields: { project: { key: string }; issuetype: { name: string }; summary: string; description: string; labels: string[] } };
  check('create body sets project key', created.fields?.project?.key === PROJECT_KEY);
  check('create body sets issuetype Task', created.fields?.issuetype?.name === 'Task');
  check('title carries trace_ids prefix', created.fields?.summary?.startsWith('[US-2.1]'));
  check('labels include atelier marker + state + kind + trace',
    created.fields?.labels?.includes('atelier')
    && created.fields?.labels?.includes('atelier/state:claimed')
    && created.fields?.labels?.includes('atelier/kind:implementation')
    && created.fields?.labels?.includes('atelier/trace:US-2.1'),
  );
  check('body has atelier-managed sentinel', created.fields?.description?.includes('atelier-managed'));

  const transitionPost = captured.find((r) => r.method === 'POST' && r.url.endsWith('/rest/api/2/issue/ATL-42/transitions'));
  check('upsertIssue called transitions endpoint', transitionPost !== undefined);
  const tBody = (transitionPost?.body ?? {}) as { transition: { id: string } };
  check('transition selected To Do for claimed', tBody.transition?.id === '11');

  // Verify Authorization header is Basic-auth shape (not Bearer).
  const authHeader = post?.headers['Authorization'] ?? '';
  check('Authorization header uses Basic scheme', authHeader.startsWith('Basic '));
}

async function testUpsertIssueClosesOnMerged(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/rest/api/2/issue'),
      status: 201,
      json: { id: '10007', key: 'ATL-7', self: `${BASE_URL}/rest/api/2/issue/10007` },
    },
    {
      matcher: (r) => r.method === 'GET' && r.url.endsWith('/rest/api/2/issue/ATL-7/transitions'),
      json: {
        transitions: [
          { id: '31', name: 'Resolve', to: { id: '30', name: 'Done' } },
        ],
      },
    },
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/rest/api/2/issue/ATL-7/transitions'),
      status: 204,
    },
  );

  const result = await adapter.upsertIssue({
    contributionId: 'c2',
    projectId: 'p1',
    kind: 'implementation',
    state: 'merged',
    traceIds: ['US-2.2'],
    summary: 'Already merged',
    bodyMarkdown: 'body',
  });
  check('upsertIssue (merged) returns key', result.externalId === 'ATL-7');
  const tPost = captured.find((r) => r.method === 'POST' && r.url.endsWith('/rest/api/2/issue/ATL-7/transitions'));
  check('upsertIssue transitioned to Done',
    tPost !== undefined && (tPost.body as { transition: { id: string } }).transition?.id === '31',
  );
}

async function testUpsertIssueUpdate(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'PUT' && r.url.endsWith('/rest/api/2/issue/ATL-99'),
      status: 204,
    },
    {
      matcher: (r) => r.method === 'GET' && r.url.endsWith('/rest/api/2/issue/ATL-99/transitions'),
      json: {
        transitions: [
          { id: '21', name: 'Start', to: { id: '20', name: 'In Progress' } },
        ],
      },
    },
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/rest/api/2/issue/ATL-99/transitions'),
      status: 204,
    },
  );

  const result = await adapter.upsertIssue({
    contributionId: 'c3',
    projectId: 'p1',
    kind: 'design',
    state: 'in_progress',
    traceIds: ['US-3.4'],
    summary: 'Update path',
    bodyMarkdown: 'body',
    externalId: 'ATL-99',
  });
  const put = captured.find((r) => r.method === 'PUT');
  check('upsertIssue update path PUTs existing issue', put !== undefined);

  const putBody = (put?.body ?? {}) as { fields: { project?: unknown; issuetype?: unknown; summary: string; labels: string[]; description: string } };
  check('update body omits immutable project field', putBody.fields?.project === undefined);
  check('update body omits immutable issuetype field', putBody.fields?.issuetype === undefined);
  check('update body still carries summary + labels',
    typeof putBody.fields?.summary === 'string' && Array.isArray(putBody.fields?.labels),
  );
  check('upsertIssue update returns same key', result.externalId === 'ATL-99');
}

async function testUpsertIssueNoTransitionMatch(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/rest/api/2/issue'),
      status: 201,
      json: { id: '10010', key: 'ATL-10', self: `${BASE_URL}/rest/api/2/issue/10010` },
    },
    {
      matcher: (r) => r.method === 'GET' && r.url.endsWith('/rest/api/2/issue/ATL-10/transitions'),
      json: {
        transitions: [
          { id: '99', name: 'Custom-Only', to: { id: '900', name: 'Custom Status' } },
        ],
      },
    },
  );

  const originalWarn = console.warn;
  let warned = '';
  console.warn = (msg: unknown) => { warned += String(msg); };
  try {
    const result = await adapter.upsertIssue({
      contributionId: 'c4',
      projectId: 'p1',
      kind: 'implementation',
      state: 'review',
      traceIds: [],
      summary: 'Custom workflow',
      bodyMarkdown: 'body',
    });
    check('upsertIssue still returns id when no transition matches', result.externalId === 'ATL-10');
  } finally {
    console.warn = originalWarn;
  }
  check('warning emitted for unmatched transition', warned.includes('no workflow transition matches'));
  const transitionPost = captured.find((r) => r.method === 'POST' && r.url.endsWith('/rest/api/2/issue/ATL-10/transitions'));
  check('no POST to /transitions when no match', transitionPost === undefined);
}

async function testPullIssue(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'GET' && r.url.includes('/rest/api/2/issue/ATL-55'),
      json: {
        id: '10055',
        key: 'ATL-55',
        self: `${BASE_URL}/rest/api/2/issue/10055`,
        fields: {
          summary: '[US-2.5] Done thing',
          status: { name: 'Done' },
          assignee: { displayName: 'Alice Example' },
          updated: '2026-04-28T15:00:00.000+0000',
          labels: ['atelier', 'atelier/state:merged'],
          customfield_10020: [{ id: 1, name: 'Sprint 4', state: 'active' }],
          customfield_10016: 5,
        },
      },
    },
    {
      matcher: (r) => r.method === 'GET' && r.url.includes('/rest/api/2/issue/ATL-404'),
      status: 404,
      json: { errorMessages: ['Issue does not exist'] },
    },
  );

  const found = await adapter.pullIssue('ATL-55');
  check('pullIssue returns external state', found?.externalState === 'Done');
  check('pullIssue returns assignee displayName', found?.assignee === 'Alice Example');
  check('pullIssue returns sprint name', found?.sprint === 'Sprint 4');
  check('pullIssue returns story points', found?.points === 5);
  check('pullIssue returns observedAt from updated', found?.observedAt === '2026-04-28T15:00:00.000+0000');

  const missing = await adapter.pullIssue('ATL-404');
  check('pullIssue 404 returns null', missing === null);
}

async function testPullIssueLegacySprintShape(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({
    matcher: (r) => r.method === 'GET' && r.url.includes('/rest/api/2/issue/ATL-77'),
    json: {
      id: '10077',
      key: 'ATL-77',
      self: `${BASE_URL}/rest/api/2/issue/10077`,
      fields: {
        summary: 'Legacy sprint',
        status: { name: 'In Progress' },
        assignee: null,
        updated: '2026-04-28T15:00:00.000+0000',
        labels: [],
        // GreenHopper-encoded legacy sprint shape (Cloud rarely returns this
        // anymore but Server forks still do).
        customfield_10020: [
          'com.atlassian.greenhopper.service.sprint.Sprint@123[id=4,rapidViewId=2,state=ACTIVE,name=Sprint Legacy,startDate=...]',
        ],
        customfield_10016: null,
      },
    },
  });
  const found = await adapter.pullIssue('ATL-77');
  check('pullIssue handles legacy sprint string', found?.sprint === 'Sprint Legacy');
  check('pullIssue returns null points when missing', found?.points === null);
  check('pullIssue returns null assignee when missing', found?.assignee === null);
}

async function testCustomFieldIdsFromConstructor(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter({
    sprintFieldId: 'customfield_99999',
    pointsFieldId: 'customfield_88888',
  });
  responses.push({
    matcher: (r) => r.method === 'GET' && r.url.includes('/rest/api/2/issue/ATL-1'),
    json: {
      id: '1',
      key: 'ATL-1',
      self: `${BASE_URL}/rest/api/2/issue/1`,
      fields: {
        summary: 's',
        status: { name: 'Open' },
        assignee: null,
        updated: '2026-04-28T00:00:00.000+0000',
        labels: [],
        customfield_99999: [{ name: 'Custom Sprint' }],
        customfield_88888: 13,
      },
    },
  });
  const found = await adapter.pullIssue('ATL-1');
  check('custom sprintFieldId is read', found?.sprint === 'Custom Sprint');
  check('custom pointsFieldId is read', found?.points === 13);

  const get = captured.find((r) => r.method === 'GET');
  check('fields query param includes overridden sprint id', get !== undefined && get.url.includes('customfield_99999'));
  check('fields query param includes overridden points id', get !== undefined && get.url.includes('customfield_88888'));
}

async function test401RedactsCredentials(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({
    matcher: () => true,
    status: 401,
    json: { errorMessages: ['Unauthorized; bad token'] },
  });

  let thrown: unknown = null;
  try {
    await adapter.pullIssue('ATL-1');
  } catch (err) {
    thrown = err;
  }
  check('401 throws JiraHttpError', thrown instanceof JiraHttpError);
  const status = (thrown as JiraHttpError).status;
  check('error carries 401 status', status === 401);
  const message = String((thrown as Error).message ?? '');
  check('error message does NOT contain api token', !message.includes(API_TOKEN));
  // The Basic-auth header value is base64(email:apiToken). Ensure that
  // encoded form is not echoed either.
  const encodedAuth = Buffer.from(`smoke@atelier.test:${API_TOKEN}`).toString('base64');
  check('error message does NOT contain encoded basic-auth value', !message.includes(encodedAuth));
  check('error message uses generic phrasing', message.includes('authentication failed'));
}

async function test403RedactsCredentials(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({ matcher: () => true, status: 403, json: { errorMessages: ['Forbidden'] } });
  let thrown: unknown = null;
  try {
    await adapter.upsertIssue({
      contributionId: 'c5',
      projectId: 'p1',
      kind: 'implementation',
      state: 'claimed',
      traceIds: [],
      summary: 's',
      bodyMarkdown: 'b',
    });
  } catch (err) {
    thrown = err;
  }
  check('403 throws JiraHttpError', thrown instanceof JiraHttpError);
  const message = String((thrown as Error).message ?? '');
  check('403 error message does NOT contain api token', !message.includes(API_TOKEN));
  check('403 error uses generic phrasing', message.includes('authentication failed'));
}

// =========================================================================
// Layer B: integration with publish-delivery + delivery_sync_state
// =========================================================================

const PROJECT_ID = '11111111-2222-3333-4444-666666666666';
const COMPOSER_ID = '11111111-2222-3333-4444-cccccccccccc';
const TERRITORY_ID = '11111111-2222-3333-4444-dddddddddddd';

async function setupProject(): Promise<{ contributionId: string }> {
  const seed = new Client({ connectionString: DB_URL });
  await seed.connect();
  try {
    await seed.query(`DELETE FROM projects WHERE id = $1`, [PROJECT_ID]);
    await seed.query(
      `INSERT INTO projects (id, name, repo_url, template_version)
       VALUES ($1, 'jira-smoke', 'https://example.invalid/jira-smoke', '1.0')`,
      [PROJECT_ID],
    );
    await seed.query(
      `INSERT INTO composers (id, project_id, email, display_name, discipline, identity_subject)
       VALUES ($1, $2, 'jira-dev@smoke.invalid', 'Jira Dev', 'dev', 'sub-jira-dev-smoke')`,
      [COMPOSER_ID, PROJECT_ID],
    );
    await seed.query(
      `INSERT INTO territories (id, project_id, name, owner_role, review_role, scope_kind, scope_pattern)
       VALUES ($1, $2, 'jira-territory', 'dev', 'architect', 'files', ARRAY['scripts/jira-smoke/**'])`,
      [TERRITORY_ID, PROJECT_ID],
    );
  } finally {
    await seed.end();
  }

  const client = new AtelierClient({ databaseUrl: DB_URL });
  const session = await client.createSession({ projectId: PROJECT_ID, composerId: COMPOSER_ID, surface: 'terminal' });
  const claim = await client.claim({
    contributionId: null,
    sessionId: session.id,
    kind: 'implementation',
    traceIds: ['US-JIRA-1'],
    territoryId: TERRITORY_ID,
    contentRef: 'scripts/jira-smoke/example.ts',
    artifactScope: ['scripts/jira-smoke/example.ts'],
  });
  await client.close();
  return { contributionId: claim.contributionId };
}

async function testIntegrationCreateThenUpdate(): Promise<void> {
  const { contributionId } = await setupProject();

  // Stateful fake fetch that tracks issues across calls.
  let nextIssueNum = 0;
  const captured: CapturedRequest[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    captured.push({ method, url, body, headers: {} });

    // POST /rest/api/2/issue -> create
    if (method === 'POST' && url.endsWith('/rest/api/2/issue')) {
      nextIssueNum += 1;
      const key = `${PROJECT_KEY}-${nextIssueNum}`;
      return new Response(
        JSON.stringify({ id: String(10_000 + nextIssueNum), key, self: `${BASE_URL}/rest/api/2/issue/${10_000 + nextIssueNum}` }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }
    // PUT /rest/api/2/issue/{key} -> update (no body)
    if (method === 'PUT' && /\/rest\/api\/2\/issue\/[^/]+$/.test(url)) {
      return new Response(null, { status: 204 });
    }
    // GET /rest/api/2/issue/{key}/transitions -> transitions list
    if (method === 'GET' && /\/transitions$/.test(url)) {
      return new Response(
        JSON.stringify({
          transitions: [
            { id: '11', name: 'To Do',  to: { id: '10', name: 'To Do' } },
            { id: '21', name: 'Start',  to: { id: '20', name: 'In Progress' } },
            { id: '31', name: 'Resolve', to: { id: '30', name: 'Done' } },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    // POST /rest/api/2/issue/{key}/transitions -> apply transition
    if (method === 'POST' && /\/transitions$/.test(url)) {
      return new Response(null, { status: 204 });
    }
    // GET /rest/api/2/issue/{key}?fields=... -> fetch issue
    if (method === 'GET' && /\/rest\/api\/2\/issue\/[^/?]+/.test(url)) {
      const keyMatch = url.match(/\/issue\/([^/?]+)/);
      const key = keyMatch ? keyMatch[1]! : 'UNKNOWN';
      return new Response(
        JSON.stringify({
          id: '99',
          key,
          self: `${BASE_URL}/rest/api/2/issue/99`,
          fields: {
            summary: '[US-JIRA-1] Atelier implementation',
            status: { name: 'To Do' },
            assignee: { displayName: 'Smoke Tester' },
            updated: new Date().toISOString(),
            labels: ['atelier', 'atelier/state:claimed'],
            customfield_10020: [{ id: 7, name: 'Sprint Smoke' }],
            customfield_10016: 3,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ message: 'no mock' }), { status: 500 });
  };

  const adapter = new JiraDeliveryAdapter({
    baseUrl: BASE_URL,
    email: 'smoke@atelier.test',
    apiToken: API_TOKEN,
    projectKey: PROJECT_KEY,
    fetch: fakeFetch,
  });
  // Override the registered 'jira' adapter with our mocked instance.
  registerDeliveryAdapter(adapter);

  resetEventBus();
  const bus = getEventBus();
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  registerSubscriber(bus, db, resolveDeliveryAdapter('jira'), false);

  // First poll: should create an issue and write delivery_sync_state.
  const since = new Date(Date.now() - 60_000);
  const first = await pollOnce({ db, bus, since, dryRun: true, projectId: PROJECT_ID });
  await bus.drain();
  check('first poll detected the contribution', first.detected >= 1);

  const { rows: stateRows } = await db.query<{ external_id: string; external_url: string }>(
    `SELECT external_id, external_url FROM delivery_sync_state
      WHERE contribution_id = $1 AND adapter = 'jira'`,
    [contributionId],
  );
  check('delivery_sync_state row inserted', stateRows.length === 1);
  check('external_id is the issue key', stateRows[0]?.external_id === `${PROJECT_KEY}-1`);
  check('external_url is the browse URL', stateRows[0]?.external_url === `${BASE_URL}/browse/${PROJECT_KEY}-1`);

  // Advance the contribution so the cursor picks it up again.
  await db.query(
    `UPDATE contributions SET state = 'in_progress', updated_at = now() WHERE id = $1`,
    [contributionId],
  );

  captured.length = 0;
  const second = await pollOnce({ db, bus, since: new Date(0), dryRun: true, projectId: PROJECT_ID });
  await bus.drain();
  check('second poll re-detected the contribution', second.detected >= 1);

  const putCalls  = captured.filter((r) => r.method === 'PUT');
  const postCreateCalls = captured.filter((r) => r.method === 'POST' && r.url.endsWith('/rest/api/2/issue'));
  check('second poll PUTed (no new issue created)', putCalls.length >= 1 && postCreateCalls.length === 0);

  // mirror-delivery should now find the row via delivery_sync_state.
  const mirrorResult = await pullForProject({
    db,
    projectId: PROJECT_ID,
    adapterName: 'jira',
    dryRun: false,
  });
  check('mirror-delivery pulled at least one issue', mirrorResult.pulled >= 1);

  const { rows: enriched } = await db.query<{ metadata: { assignee?: string; sprint?: string; points?: number } }>(
    `SELECT metadata FROM delivery_sync_state WHERE contribution_id = $1 AND adapter = 'jira'`,
    [contributionId],
  );
  check('mirror-delivery wrote assignee into metadata', enriched[0]?.metadata?.assignee === 'Smoke Tester');
  check('mirror-delivery wrote sprint into metadata', enriched[0]?.metadata?.sprint === 'Sprint Smoke');
  check('mirror-delivery wrote points into metadata', enriched[0]?.metadata?.points === 3);

  await db.end();
}

async function tryConnectDb(): Promise<boolean> {
  const probe = new Client({ connectionString: DB_URL });
  try {
    await probe.connect();
    await probe.end();
    return true;
  } catch {
    try { await probe.end(); } catch { /* ignore */ }
    return false;
  }
}

// =========================================================================
// Run
// =========================================================================

async function main(): Promise<void> {
  console.log('\n[A] adapter unit tests (mocked fetch)');
  console.log('  upsertIssue create:');             await testUpsertIssueCreate();
  console.log('  upsertIssue closes on merged:');   await testUpsertIssueClosesOnMerged();
  console.log('  upsertIssue update:');             await testUpsertIssueUpdate();
  console.log('  upsertIssue no transition match:'); await testUpsertIssueNoTransitionMatch();
  console.log('  pullIssue:');                      await testPullIssue();
  console.log('  pullIssue legacy sprint shape:');  await testPullIssueLegacySprintShape();
  console.log('  custom field ids from ctor:');     await testCustomFieldIdsFromConstructor();
  console.log('  401 redacts credentials:');        await test401RedactsCredentials();
  console.log('  403 redacts credentials:');        await test403RedactsCredentials();

  console.log('\n[B] integration with publish-delivery + delivery_sync_state');
  const dbReachable = await tryConnectDb();
  if (!dbReachable) {
    console.log(`  SKIP  no Postgres reachable at ${DB_URL}; bring up local stack via 'supabase start' or set DATABASE_URL`);
  } else {
    await testIntegrationCreateThenUpdate();
  }

  console.log('\n=========================================');
  if (failures === 0) console.log('ALL JIRA ADAPTER CHECKS PASSED');
  else console.log(`${failures} JIRA ADAPTER CHECK(S) FAILED`);
  console.log('=========================================');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('JIRA SMOKE CRASHED:', err);
  process.exit(2);
});
