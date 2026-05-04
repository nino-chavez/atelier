#!/usr/bin/env -S npx tsx
//
// Linear delivery adapter smoke test. Uses an injected fake `fetch` so the
// adapter can be exercised end-to-end without hitting the live API.
//
// Two layers (mirrors jira.smoke.ts):
//   [A] Pure adapter tests against mocked fetch (no DB).
//   [B] Integration with publish-delivery + delivery_sync_state against
//       local Supabase (still mocked fetch). [B] self-disables with an
//       explicit SKIP line if DATABASE_URL is unreachable (Q1 pattern).

import { Client } from 'pg';
import {
  LinearDeliveryAdapter,
  LinearGraphQLError,
  type LinearAdapterConfig,
} from '../lib/linear.ts';
import {
  registerDeliveryAdapter,
  resolveDeliveryAdapter,
} from '../lib/adapters.ts';
import { getEventBus, resetEventBus } from '../lib/event-bus.ts';
import { pollOnce, registerSubscriber } from '../publish-delivery.ts';
import { pullForProject } from '../mirror-delivery.ts';
import { AtelierClient } from '../lib/write.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const TEAM_ID = 'team-uuid-1234-aaaa';
const API_KEY = 'lin_api_DO_NOT_LEAK_lin_secret_value';

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
  body: { query?: string; variables?: Record<string, unknown> } | null;
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
      return new Response(JSON.stringify({ errors: [{ message: 'no mock matched' }] }), {
        status: 200,
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

function makeAdapter(extra?: Partial<LinearAdapterConfig>) {
  const responses: MockResponse[] = [];
  const dispatch = makeFakeFetch(responses);
  const adapter = new LinearDeliveryAdapter({
    apiKey: API_KEY,
    teamId: TEAM_ID,
    fetch: dispatch.fetch,
    ...(extra ?? {}),
  });
  return { adapter, responses, captured: dispatch.captured };
}

// Helpers to identify the GraphQL operation by inspecting query text.
function isOp(req: CapturedRequest, name: string): boolean {
  return typeof req.body?.query === 'string' && req.body.query.includes(name);
}

// =========================================================================
// Layer A: pure adapter tests
// =========================================================================

async function testUpsertIssueCreate(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => isOp(r, 'WorkflowStates'),
      json: {
        data: {
          workflowStates: {
            nodes: [
              { id: 'state-todo', name: 'Todo' },
              { id: 'state-progress', name: 'In Progress' },
              { id: 'state-done', name: 'Done' },
              { id: 'state-cancel', name: 'Cancelled' },
            ],
          },
        },
      },
    },
    {
      matcher: (r) => isOp(r, 'IssueLabels'),
      json: {
        data: {
          issueLabels: {
            nodes: [
              { id: 'label-atelier', name: 'atelier' },
              { id: 'label-state-claimed', name: 'atelier/state:claimed' },
              { id: 'label-kind-impl', name: 'atelier/kind:implementation' },
              { id: 'label-trace-21', name: 'atelier/trace:US-2.1' },
            ],
          },
        },
      },
    },
    {
      matcher: (r) => isOp(r, 'IssueCreate'),
      json: {
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: 'issue-uuid-42',
              identifier: 'ENG-42',
              url: 'https://linear.app/atelier/issue/ENG-42',
              state: { id: 'state-todo', name: 'Todo' },
            },
          },
        },
      },
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

  check('upsertIssue returns Linear UUID id', result.externalId === 'issue-uuid-42');
  check('upsertIssue returns Linear url', result.externalUrl === 'https://linear.app/atelier/issue/ENG-42');

  const createReq = captured.find((r) => isOp(r, 'IssueCreate'));
  check('IssueCreate mutation issued', createReq !== undefined);
  const createVars = createReq?.body?.variables as { input: Record<string, unknown> };
  const createInput = createVars?.input ?? {};
  check('create input includes teamId', createInput.teamId === TEAM_ID);
  check('create input title carries trace prefix', String(createInput.title ?? '').startsWith('[US-2.1]'));
  check('create input includes resolved stateId for claimed -> Todo', createInput.stateId === 'state-todo');
  const labelIds = (createInput.labelIds ?? []) as string[];
  check('create input includes resolved labelIds',
    Array.isArray(labelIds)
    && labelIds.includes('label-atelier')
    && labelIds.includes('label-state-claimed')
    && labelIds.includes('label-kind-impl')
    && labelIds.includes('label-trace-21'),
  );
  check('create description has atelier-managed sentinel',
    typeof createInput.description === 'string' && (createInput.description as string).includes('atelier-managed'),
  );

  // Auth header carries the raw API key WITHOUT a Bearer prefix.
  const auth = createReq?.headers?.['Authorization'] ?? '';
  check('Authorization header carries raw api key (no Bearer prefix)', auth === API_KEY);
}

async function testUpsertIssueUpdate(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => isOp(r, 'WorkflowStates'),
      json: { data: { workflowStates: { nodes: [
        { id: 'state-progress', name: 'In Progress' },
      ] } } },
    },
    {
      matcher: (r) => isOp(r, 'IssueLabels'),
      json: { data: { issueLabels: { nodes: [
        { id: 'l1', name: 'atelier' },
      ] } } },
    },
    {
      matcher: (r) => isOp(r, 'IssueUpdate'),
      json: {
        data: {
          issueUpdate: {
            success: true,
            issue: {
              id: 'issue-uuid-99',
              identifier: 'ENG-99',
              url: 'https://linear.app/atelier/issue/ENG-99',
              state: { id: 'state-progress', name: 'In Progress' },
            },
          },
        },
      },
    },
  );

  const result = await adapter.upsertIssue({
    contributionId: 'c2',
    projectId: 'p1',
    kind: 'design',
    state: 'in_progress',
    traceIds: ['US-3.4'],
    summary: 'Update path',
    bodyMarkdown: 'body',
    externalId: 'issue-uuid-99',
  });

  const updateReq = captured.find((r) => isOp(r, 'IssueUpdate'));
  check('IssueUpdate mutation issued', updateReq !== undefined);
  const updateVars = updateReq?.body?.variables as { id: string; input: Record<string, unknown> };
  check('update id is the Linear UUID', updateVars?.id === 'issue-uuid-99');
  // teamId is NOT mutable on update -- assert it's not in the input.
  check('update input does not carry teamId', updateVars?.input?.teamId === undefined);
  check('update input includes resolved stateId for in_progress', updateVars?.input?.stateId === 'state-progress');
  check('upsertIssue update returns same id', result.externalId === 'issue-uuid-99');

  // No IssueCreate request issued.
  const createReq = captured.find((r) => isOp(r, 'IssueCreate'));
  check('no IssueCreate issued on update path', createReq === undefined);
}

async function testStateNoMatchSkipsStateId(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => isOp(r, 'WorkflowStates'),
      json: { data: { workflowStates: { nodes: [
        { id: 'state-custom', name: 'Custom Only' },
      ] } } },
    },
    {
      matcher: (r) => isOp(r, 'IssueLabels'),
      json: { data: { issueLabels: { nodes: [] } } },
    },
    {
      matcher: (r) => isOp(r, 'IssueCreate'),
      json: {
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: 'issue-1', identifier: 'ENG-1', url: 'https://linear.app/issue/ENG-1',
              state: { id: 'state-custom', name: 'Custom Only' },
            },
          },
        },
      },
    },
  );

  const originalWarn = console.warn;
  let warned = '';
  console.warn = (msg: unknown) => { warned += String(msg); };
  try {
    const result = await adapter.upsertIssue({
      contributionId: 'c3',
      projectId: 'p1',
      kind: 'implementation',
      state: 'review',
      traceIds: [],
      summary: 's',
      bodyMarkdown: 'b',
    });
    check('upsertIssue still returns id when no state matches', result.externalId === 'issue-1');
  } finally {
    console.warn = originalWarn;
  }

  check('warning emitted for unmatched state', warned.includes('no workflow state matches'));
  const createReq = captured.find((r) => isOp(r, 'IssueCreate'));
  const input = (createReq?.body?.variables as { input: Record<string, unknown> })?.input ?? {};
  check('create input omits stateId when no match', input.stateId === undefined);
}

async function testMissingLabelWarning(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => isOp(r, 'WorkflowStates'),
      json: { data: { workflowStates: { nodes: [
        { id: 'state-todo', name: 'Todo' },
      ] } } },
    },
    {
      matcher: (r) => isOp(r, 'IssueLabels'),
      json: { data: { issueLabels: { nodes: [
        { id: 'l1', name: 'atelier' },
        // Missing: atelier/kind:implementation, atelier/state:claimed, atelier/trace:US-9.9
      ] } } },
    },
    {
      matcher: (r) => isOp(r, 'IssueCreate'),
      json: {
        data: {
          issueCreate: {
            success: true,
            issue: { id: 'issue-2', identifier: 'ENG-2', url: 'https://linear.app/issue/ENG-2',
              state: { id: 'state-todo', name: 'Todo' } },
          },
        },
      },
    },
  );

  const originalWarn = console.warn;
  let warned = '';
  console.warn = (msg: unknown) => { warned += String(msg); };
  try {
    await adapter.upsertIssue({
      contributionId: 'c4',
      projectId: 'p1',
      kind: 'implementation',
      state: 'claimed',
      traceIds: ['US-9.9'],
      summary: 's',
      bodyMarkdown: 'b',
    });
  } finally {
    console.warn = originalWarn;
  }

  check('missing-label warning emitted', warned.includes('label(s) not found'));
  check('warning names the missing labels',
    warned.includes('atelier/kind:implementation') && warned.includes('atelier/state:claimed') && warned.includes('atelier/trace:US-9.9'),
  );
  const createReq = captured.find((r) => isOp(r, 'IssueCreate'));
  const input = (createReq?.body?.variables as { input: Record<string, unknown> })?.input ?? {};
  const ids = (input.labelIds ?? []) as string[];
  check('only resolvable label ids included', Array.isArray(ids) && ids.length === 1 && ids[0] === 'l1');
}

async function testPullIssue(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({
    matcher: (r) => isOp(r, 'query Issue'),
    json: {
      data: {
        issue: {
          id: 'issue-uuid-55',
          identifier: 'ENG-55',
          url: 'https://linear.app/atelier/issue/ENG-55',
          state: { name: 'Done' },
          assignee: { name: 'Alice Example' },
          project: { name: 'Sprint 4 Project' },
          estimate: 5,
          updatedAt: '2026-04-28T15:00:00.000Z',
        },
      },
    },
  });

  const found = await adapter.pullIssue('issue-uuid-55');
  check('pullIssue returns external id', found?.externalId === 'issue-uuid-55');
  check('pullIssue returns externalState', found?.externalState === 'Done');
  check('pullIssue returns assignee.name', found?.assignee === 'Alice Example');
  check('pullIssue maps project -> sprint', found?.sprint === 'Sprint 4 Project');
  check('pullIssue returns estimate as points', found?.points === 5);
  check('pullIssue returns updatedAt as observedAt', found?.observedAt === '2026-04-28T15:00:00.000Z');
}

async function testPullIssueReturnsNullOnMissing(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({
    matcher: (r) => isOp(r, 'query Issue'),
    json: { data: { issue: null } },
  });
  const found = await adapter.pullIssue('issue-not-real');
  check('pullIssue returns null when data.issue is null', found === null);
}

async function testGraphQL200WithErrorsThrows(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  // The first GraphQL call resolveStateId issues is WorkflowStates --
  // return HTTP 200 with errors body. The request helper MUST throw,
  // not silently return.
  responses.push({
    matcher: () => true,
    status: 200,
    json: { errors: [{ message: 'Field "workflowStates" requires authentication' }] },
  });

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
  check('throws on HTTP 200 with body.errors', thrown instanceof LinearGraphQLError);
  check('error carries graphqlErrors array',
    thrown instanceof LinearGraphQLError && thrown.graphqlErrors.length === 1,
  );
  check('error message includes graphql error text',
    thrown instanceof Error && thrown.message.includes('requires authentication'),
  );
}

async function test401RedactsApiKey(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({
    matcher: () => true,
    status: 401,
    body: `Unauthorized for key=${API_KEY}`,
  });

  let thrown: unknown = null;
  try {
    await adapter.pullIssue('issue-1');
  } catch (err) {
    thrown = err;
  }
  check('401 throws LinearGraphQLError', thrown instanceof LinearGraphQLError);
  check('401 carries 401 status', (thrown as LinearGraphQLError).status === 401);
  const message = String((thrown as Error).message ?? '');
  check('401 message does NOT contain api key', !message.includes(API_KEY));
  check('401 message uses generic phrasing', message.includes('authentication failed'));
}

async function test500RedactsApiKeyInBody(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  // 500 with body that happens to echo the api key (server bug or dev
  // error page). The redact helper must scrub it.
  responses.push({
    matcher: () => true,
    status: 500,
    body: `internal error processing request with apikey=${API_KEY} for team`,
  });
  let thrown: unknown = null;
  try {
    await adapter.pullIssue('issue-1');
  } catch (err) {
    thrown = err;
  }
  check('500 throws LinearGraphQLError', thrown instanceof LinearGraphQLError);
  const message = String((thrown as Error).message ?? '');
  check('500 message does NOT contain api key', !message.includes(API_KEY));
  check('500 message contains *** redaction marker', message.includes('***'));
}

async function testGraphQLErrorMessageRedactsApiKey(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  // Edge: a GraphQL error message itself echoes the api key (e.g., a
  // misconfigured server logging the auth header into a typed error).
  responses.push({
    matcher: () => true,
    status: 200,
    json: { errors: [{ message: `Invalid token: ${API_KEY}` }] },
  });
  let thrown: unknown = null;
  try {
    await adapter.pullIssue('issue-1');
  } catch (err) {
    thrown = err;
  }
  check('graphql-error-with-key throws LinearGraphQLError', thrown instanceof LinearGraphQLError);
  const message = String((thrown as Error).message ?? '');
  check('graphql-error message does NOT contain api key', !message.includes(API_KEY));
}

// =========================================================================
// Layer B: integration with publish-delivery + delivery_sync_state
// =========================================================================

const PROJECT_ID = '11111111-2222-3333-4444-777777777777';
const COMPOSER_ID = '11111111-2222-3333-4444-eeeeeeeeeeee';
const TERRITORY_ID = '11111111-2222-3333-4444-ffffffffffff';

async function setupProject(): Promise<{ contributionId: string }> {
  const seed = new Client({ connectionString: DB_URL });
  await seed.connect();
  try {
    await seed.query(`DELETE FROM projects WHERE id = $1`, [PROJECT_ID]);
    await seed.query(
      `INSERT INTO projects (id, name, repo_url, template_version)
       VALUES ($1, 'linear-smoke', 'https://example.invalid/linear-smoke', '1.0')`,
      [PROJECT_ID],
    );
    await seed.query(
      `INSERT INTO composers (id, project_id, email, display_name, discipline, identity_subject)
       VALUES ($1, $2, 'linear-dev@smoke.invalid', 'Linear Dev', 'dev', 'sub-linear-dev-smoke')`,
      [COMPOSER_ID, PROJECT_ID],
    );
    await seed.query(
      `INSERT INTO territories (id, project_id, name, owner_role, review_role, scope_kind, scope_pattern)
       VALUES ($1, $2, 'linear-territory', 'dev', 'architect', 'files', ARRAY['scripts/linear-smoke/**'])`,
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
    traceIds: ['US-LINEAR-1'],
    territoryId: TERRITORY_ID,
    contentRef: 'scripts/linear-smoke/example.ts',
    artifactScope: ['scripts/linear-smoke/example.ts'],
  });
  await client.close();
  return { contributionId: claim.contributionId };
}

async function testIntegrationCreateThenUpdate(): Promise<void> {
  const { contributionId } = await setupProject();

  // Stateful fake fetch keyed on the inspected GraphQL operation.
  let nextIdNum = 0;
  const captured: CapturedRequest[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as { query?: string; variables?: Record<string, unknown> } : null;
    captured.push({ method, url, body, headers: {} });

    const query = body?.query ?? '';
    if (query.includes('WorkflowStates')) {
      return new Response(JSON.stringify({
        data: { workflowStates: { nodes: [
          { id: 'state-todo', name: 'Todo' },
          { id: 'state-progress', name: 'In Progress' },
          { id: 'state-done', name: 'Done' },
        ] } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (query.includes('IssueLabels')) {
      return new Response(JSON.stringify({
        data: { issueLabels: { nodes: [
          { id: 'lbl-1', name: 'atelier' },
          { id: 'lbl-2', name: 'atelier/state:claimed' },
          { id: 'lbl-3', name: 'atelier/state:in_progress' },
          { id: 'lbl-4', name: 'atelier/kind:implementation' },
          { id: 'lbl-5', name: 'atelier/trace:US-LINEAR-1' },
        ] } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (query.includes('IssueCreate')) {
      nextIdNum += 1;
      const id = `issue-uuid-${nextIdNum}`;
      const identifier = `ENG-${nextIdNum}`;
      return new Response(JSON.stringify({
        data: { issueCreate: { success: true, issue: {
          id, identifier,
          url: `https://linear.app/atelier/issue/${identifier}`,
          state: { id: 'state-todo', name: 'Todo' },
        } } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (query.includes('IssueUpdate')) {
      const id = (body?.variables as { id: string })?.id;
      const num = id?.replace('issue-uuid-', '') ?? '0';
      return new Response(JSON.stringify({
        data: { issueUpdate: { success: true, issue: {
          id,
          identifier: `ENG-${num}`,
          url: `https://linear.app/atelier/issue/ENG-${num}`,
          state: { id: 'state-progress', name: 'In Progress' },
        } } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (query.includes('query Issue')) {
      const id = (body?.variables as { id: string })?.id ?? 'unknown';
      return new Response(JSON.stringify({
        data: { issue: {
          id, identifier: 'ENG-1',
          url: 'https://linear.app/atelier/issue/ENG-1',
          state: { name: 'Todo' },
          assignee: { name: 'Smoke Tester' },
          project: { name: 'Smoke Cycle' },
          estimate: 3,
          updatedAt: new Date().toISOString(),
        } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ errors: [{ message: 'no mock' }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };

  const adapter = new LinearDeliveryAdapter({
    apiKey: API_KEY,
    teamId: TEAM_ID,
    fetch: fakeFetch,
  });
  registerDeliveryAdapter(adapter);

  resetEventBus();
  const bus = getEventBus();
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  registerSubscriber(bus, db, resolveDeliveryAdapter('linear'), false);

  // First poll: should create an issue and write delivery_sync_state.
  const since = new Date(Date.now() - 60_000);
  const first = await pollOnce({ db, bus, since, dryRun: true, projectId: PROJECT_ID });
  await bus.drain();
  check('first poll detected the contribution', first.detected >= 1);

  const { rows: stateRows } = await db.query<{ external_id: string; external_url: string }>(
    `SELECT external_id, external_url FROM delivery_sync_state
      WHERE contribution_id = $1 AND adapter = 'linear'`,
    [contributionId],
  );
  check('delivery_sync_state row inserted', stateRows.length === 1);
  check('external_id is the Linear UUID', stateRows[0]?.external_id === 'issue-uuid-1');
  check('external_url is the linear.app URL', stateRows[0]?.external_url === 'https://linear.app/atelier/issue/ENG-1');

  // Advance state so the cursor picks it up again.
  await db.query(
    `UPDATE contributions SET state = 'in_progress', updated_at = now() WHERE id = $1`,
    [contributionId],
  );

  captured.length = 0;
  const second = await pollOnce({ db, bus, since: new Date(0), dryRun: true, projectId: PROJECT_ID });
  await bus.drain();
  check('second poll re-detected the contribution', second.detected >= 1);

  const updateReq = captured.find((r) => typeof r.body?.query === 'string' && r.body.query.includes('IssueUpdate'));
  const createReq = captured.find((r) => typeof r.body?.query === 'string' && r.body.query.includes('IssueCreate'));
  check('second poll issued IssueUpdate (no IssueCreate)', updateReq !== undefined && createReq === undefined);

  // mirror-delivery should now find the row via delivery_sync_state.
  const mirrorResult = await pullForProject({
    db,
    projectId: PROJECT_ID,
    adapterName: 'linear',
    dryRun: false,
  });
  check('mirror-delivery pulled at least one issue', mirrorResult.pulled >= 1);

  const { rows: enriched } = await db.query<{ metadata: { assignee?: string; sprint?: string; points?: number } }>(
    `SELECT metadata FROM delivery_sync_state WHERE contribution_id = $1 AND adapter = 'linear'`,
    [contributionId],
  );
  check('mirror-delivery wrote assignee into metadata', enriched[0]?.metadata?.assignee === 'Smoke Tester');
  check('mirror-delivery wrote project as sprint into metadata', enriched[0]?.metadata?.sprint === 'Smoke Cycle');
  check('mirror-delivery wrote estimate as points into metadata', enriched[0]?.metadata?.points === 3);

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
  console.log('  upsertIssue create:');                     await testUpsertIssueCreate();
  console.log('  upsertIssue update:');                     await testUpsertIssueUpdate();
  console.log('  state no-match skips stateId:');           await testStateNoMatchSkipsStateId();
  console.log('  missing label warning:');                  await testMissingLabelWarning();
  console.log('  pullIssue:');                              await testPullIssue();
  console.log('  pullIssue returns null on missing:');      await testPullIssueReturnsNullOnMissing();
  console.log('  graphql 200 with errors throws:');         await testGraphQL200WithErrorsThrows();
  console.log('  401 redacts api key:');                    await test401RedactsApiKey();
  console.log('  500 redacts api key in body:');            await test500RedactsApiKeyInBody();
  console.log('  graphql error message redacts api key:');  await testGraphQLErrorMessageRedactsApiKey();

  console.log('\n[B] integration with publish-delivery + delivery_sync_state');
  const dbReachable = await tryConnectDb();
  if (!dbReachable) {
    console.log(`  SKIP  no Postgres reachable at ${DB_URL}; bring up local stack via 'supabase start' or set DATABASE_URL`);
  } else {
    await testIntegrationCreateThenUpdate();
  }

  console.log('\n=========================================');
  if (failures === 0) console.log('ALL LINEAR ADAPTER CHECKS PASSED');
  else console.log(`${failures} LINEAR ADAPTER CHECK(S) FAILED`);
  console.log('=========================================');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('LINEAR SMOKE CRASHED:', err);
  process.exit(2);
});
