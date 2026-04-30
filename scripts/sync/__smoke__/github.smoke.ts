#!/usr/bin/env -S npx tsx
//
// GitHub delivery adapter smoke test. Uses an injected fake `fetch` so the
// adapter can be exercised end-to-end without hitting the live API.
//
// Two layers:
//   [A] Pure adapter tests against mocked fetch (no DB).
//   [B] Integration with publish-delivery + delivery_sync_state against
//       local Supabase (still mocked fetch).

import { Client } from 'pg';
import {
  GitHubDeliveryAdapter,
  type GitHubAdapterConfig,
} from '../lib/github.ts';
import {
  registerDeliveryAdapter,
  resolveDeliveryAdapter,
} from '../lib/adapters.ts';
import { getEventBus, resetEventBus } from '../lib/event-bus.ts';
import { pollOnce, registerSubscriber } from '../publish-delivery.ts';
import { pullForProject } from '../mirror-delivery.ts';
import { AtelierClient } from '../lib/write.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

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

function makeAdapter(extra?: Partial<GitHubAdapterConfig>) {
  const responses: MockResponse[] = [];
  const dispatch = makeFakeFetch(responses);
  const adapter = new GitHubDeliveryAdapter({
    token: 'test-token',
    owner: 'atelier-test',
    repo: 'smoke',
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
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/repos/atelier-test/smoke/issues'),
      status: 201,
      json: { number: 42, html_url: 'https://github.com/atelier-test/smoke/issues/42', state: 'open', state_reason: null, title: '', body: null, labels: [], assignee: null, milestone: null, updated_at: '2026-04-28T12:00:00Z' },
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
  check('upsertIssue create returns external id', result.externalId === '42');
  check('upsertIssue create returns html_url', result.externalUrl === 'https://github.com/atelier-test/smoke/issues/42');
  check('upsertIssue posted to /issues', captured.some((r) => r.method === 'POST' && /\/issues$/.test(r.url)));

  const created = captured[0]!;
  const createdBody = created.body as { title: string; labels: string[]; body: string };
  check('title carries trace_ids prefix', createdBody.title.startsWith('[US-2.1]'));
  check('labels include atelier marker + state + kind + trace', createdBody.labels.includes('atelier') && createdBody.labels.includes('atelier/state:claimed') && createdBody.labels.includes('atelier/kind:implementation') && createdBody.labels.includes('atelier/trace:US-2.1'));
  check('body has atelier-managed sentinel', createdBody.body.includes('atelier-managed'));
}

async function testUpsertIssueClosesOnMerged(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/repos/atelier-test/smoke/issues'),
      status: 201,
      json: { number: 7, html_url: 'https://github.com/atelier-test/smoke/issues/7', state: 'open', state_reason: null, title: '', body: null, labels: [], assignee: null, milestone: null, updated_at: '2026-04-28T12:00:00Z' },
    },
    {
      matcher: (r) => r.method === 'PATCH' && r.url.endsWith('/issues/7'),
      json: { number: 7, html_url: 'https://github.com/atelier-test/smoke/issues/7', state: 'closed', state_reason: 'completed', title: '', body: null, labels: [], assignee: null, milestone: null, updated_at: '2026-04-28T12:00:01Z' },
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
  check('upsertIssue (merged) returns id', result.externalId === '7');
  const patch = captured.find((r) => r.method === 'PATCH');
  check('upsertIssue followed POST with PATCH state=closed', patch !== undefined && (patch.body as { state: string; state_reason: string }).state === 'closed' && (patch.body as { state: string; state_reason: string }).state_reason === 'completed');
}

async function testUpsertIssueUpdate(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push({
    matcher: (r) => r.method === 'PATCH' && r.url.endsWith('/issues/99'),
    json: { number: 99, html_url: 'https://github.com/atelier-test/smoke/issues/99', state: 'open', state_reason: null, title: '', body: null, labels: [], assignee: null, milestone: null, updated_at: '2026-04-28T12:00:00Z' },
  });

  const result = await adapter.upsertIssue({
    contributionId: 'c3',
    projectId: 'p1',
    kind: 'design',
    state: 'in_progress',
    traceIds: ['US-3.4'],
    summary: 'Update path',
    bodyMarkdown: 'body',
    externalId: '99',
  });
  check('upsertIssue update path PATCHes existing issue', captured.length === 1 && captured[0]?.method === 'PATCH');
  check('upsertIssue update returns same id', result.externalId === '99');
}

async function testPullIssue(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'GET' && r.url.endsWith('/issues/55'),
      json: {
        number: 55,
        html_url: 'https://github.com/atelier-test/smoke/issues/55',
        state: 'closed',
        state_reason: 'completed',
        title: '[US-2.5] Done thing',
        body: 'body',
        labels: [{ name: 'atelier' }, { name: 'points:5' }],
        assignee: { login: 'alice' },
        milestone: { title: 'Sprint 4' },
        updated_at: '2026-04-28T15:00:00Z',
      },
    },
    {
      matcher: (r) => r.method === 'GET' && r.url.endsWith('/issues/404'),
      status: 404,
      json: { message: 'Not Found' },
    },
  );

  const found = await adapter.pullIssue('55');
  check('pullIssue returns external state', found?.externalState === 'closed:completed');
  check('pullIssue returns assignee', found?.assignee === 'alice');
  check('pullIssue returns sprint', found?.sprint === 'Sprint 4');
  check('pullIssue extracts points label', found?.points === 5);

  const missing = await adapter.pullIssue('404');
  check('pullIssue 404 returns null', missing === null);
}

async function testListManagedBranches(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'GET' && r.url.includes('/git/matching-refs/heads/'),
      json: [
        { ref: 'refs/heads/atelier/c-merged', object: { sha: 'sha-merged', type: 'commit' } },
        { ref: 'refs/heads/atelier/c-active', object: { sha: 'sha-active', type: 'commit' } },
      ],
    },
    {
      matcher: (r) => r.method === 'GET' && r.url.includes('/pulls?'),
      json: [{ number: 10, state: 'open', head: { ref: 'atelier/c-active' } }],
    },
    {
      matcher: (r) => r.method === 'GET' && r.url.endsWith('/git/commits/sha-merged'),
      json: { sha: 'sha-merged', commit: { committer: { date: '2026-01-01T00:00:00Z' } }, committer: null },
    },
    {
      matcher: (r) => r.method === 'GET' && r.url.endsWith('/git/commits/sha-active'),
      json: { sha: 'sha-active', commit: { committer: { date: '2026-04-25T00:00:00Z' } }, committer: null },
    },
  );

  const branches = await adapter.listManagedBranches();
  check('listManagedBranches returns 2 refs', branches !== null && branches.length === 2);
  check('listManagedBranches normalizes ref name', branches?.[0]?.ref === 'atelier/c-merged');
  check('hasOpenPr=true for branch with open PR', branches?.find((b) => b.ref === 'atelier/c-active')?.hasOpenPr === true);
  check('hasOpenPr=false for branch without PR', branches?.find((b) => b.ref === 'atelier/c-merged')?.hasOpenPr === false);
  check('lastCommitAt populated from commit endpoint', branches?.[0]?.lastCommitAt === '2026-01-01T00:00:00Z');

  // Confirm the prefix encoding used the expected GitHub matching-refs path
  const refsCall = captured.find((r) => r.url.includes('/git/matching-refs/heads/'));
  check('matching-refs path encodes branch prefix', !!refsCall && refsCall.url.includes('atelier'));
}

async function testDeleteRemoteBranch(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push({
    matcher: (r) => r.method === 'DELETE' && r.url.includes('/git/refs/heads/atelier/c1'),
    status: 204,
  });
  await adapter.deleteRemoteBranch('atelier/c1');
  check('deleteRemoteBranch issued DELETE', captured.some((r) => r.method === 'DELETE'));
}

// =========================================================================
// Layer B: integration with publish-delivery + delivery_sync_state
// =========================================================================

const PROJECT_ID = '11111111-2222-3333-4444-555555555555';
const COMPOSER_ID = '11111111-2222-3333-4444-aaaaaaaaaaaa';
const TERRITORY_ID = '11111111-2222-3333-4444-bbbbbbbbbbbb';

async function setupProject(): Promise<{ contributionId: string }> {
  const seed = new Client({ connectionString: DB_URL });
  await seed.connect();
  try {
    await seed.query(`DELETE FROM projects WHERE id = $1`, [PROJECT_ID]);
    await seed.query(
      `INSERT INTO projects (id, name, repo_url, template_version)
       VALUES ($1, 'github-smoke', 'https://example.invalid/gh-smoke', '1.0')`,
      [PROJECT_ID],
    );
    await seed.query(
      `INSERT INTO composers (id, project_id, email, display_name, discipline, identity_subject)
       VALUES ($1, $2, 'gh-dev@smoke.invalid', 'GH Dev', 'dev', 'sub-gh-dev-smoke')`,
      [COMPOSER_ID, PROJECT_ID],
    );
    await seed.query(
      `INSERT INTO territories (id, project_id, name, owner_role, review_role, scope_kind, scope_pattern)
       VALUES ($1, $2, 'gh-territory', 'dev', 'architect', 'files', ARRAY['scripts/gh-smoke/**'])`,
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
    traceIds: ['US-GH-1'],
    territoryId: TERRITORY_ID,
    contentRef: 'scripts/gh-smoke/example.ts',
    artifactScope: ['scripts/gh-smoke/example.ts'],
  });
  await client.close();
  return { contributionId: claim.contributionId };
}

async function testIntegrationCreateThenUpdate(): Promise<void> {
  const { contributionId } = await setupProject();

  // Stateful fake fetch that tracks issue numbers across calls.
  let issueNumber = 0;
  const captured: CapturedRequest[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    captured.push({ method, url, body, headers: {} });

    if (method === 'POST' && url.endsWith('/repos/atelier-test/smoke/issues')) {
      issueNumber += 1;
      return new Response(
        JSON.stringify({
          number: issueNumber,
          html_url: `https://github.com/atelier-test/smoke/issues/${issueNumber}`,
          state: 'open',
          state_reason: null,
          title: body.title,
          body: body.body,
          labels: (body.labels as string[]).map((n: string) => ({ name: n })),
          assignee: null,
          milestone: null,
          updated_at: new Date().toISOString(),
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (method === 'PATCH' && /\/issues\/\d+$/.test(url)) {
      const numMatch = url.match(/\/issues\/(\d+)$/);
      const num = numMatch ? Number(numMatch[1]) : 0;
      return new Response(
        JSON.stringify({
          number: num,
          html_url: `https://github.com/atelier-test/smoke/issues/${num}`,
          state: body.state ?? 'open',
          state_reason: body.state_reason ?? null,
          title: body.title ?? '',
          body: body.body ?? null,
          labels: (body.labels ?? []).map((n: string) => ({ name: n })),
          assignee: null,
          milestone: null,
          updated_at: new Date().toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (method === 'GET' && /\/issues\/\d+$/.test(url)) {
      const numMatch = url.match(/\/issues\/(\d+)$/);
      const num = numMatch ? Number(numMatch[1]) : 0;
      return new Response(
        JSON.stringify({
          number: num,
          html_url: `https://github.com/atelier-test/smoke/issues/${num}`,
          state: 'open',
          state_reason: null,
          title: '[US-GH-1] Atelier implementation',
          body: 'body',
          labels: [{ name: 'atelier' }, { name: 'atelier/state:claimed' }],
          assignee: { login: 'someone' },
          milestone: null,
          updated_at: new Date().toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ message: 'no mock' }), { status: 500 });
  };

  const adapter = new GitHubDeliveryAdapter({
    token: 'test-token',
    owner: 'atelier-test',
    repo: 'smoke',
    fetch: fakeFetch,
  });
  // Override the registered 'github' adapter with our mocked instance for
  // this test.
  registerDeliveryAdapter(adapter);

  resetEventBus();
  const bus = getEventBus();
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  registerSubscriber(bus, db, resolveDeliveryAdapter('github'), false);

  // First poll: should create an issue and write delivery_sync_state.
  const since = new Date(Date.now() - 60_000);
  const first = await pollOnce({ db, bus, since, dryRun: true, projectId: PROJECT_ID });
  await bus.drain();
  check('first poll detected the contribution', first.detected >= 1);

  const { rows: stateRows } = await db.query<{ external_id: string; external_url: string }>(
    `SELECT external_id, external_url FROM delivery_sync_state
      WHERE contribution_id = $1 AND adapter = 'github'`,
    [contributionId],
  );
  check('delivery_sync_state row inserted', stateRows.length === 1);
  check('external_id is the issue number', stateRows[0]?.external_id === '1');
  check('external_url is the html_url', stateRows[0]?.external_url === 'https://github.com/atelier-test/smoke/issues/1');

  // Advance the contribution to in_progress so updated_at moves and the
  // poll picks it up again. We're testing the publish-delivery wiring,
  // not lifecycle, so write state directly via SQL.
  await db.query(
    `UPDATE contributions SET state = 'in_progress', updated_at = now() WHERE id = $1`,
    [contributionId],
  );

  captured.length = 0;
  const second = await pollOnce({ db, bus, since: stateRows[0] ? new Date(0) : since, dryRun: true, projectId: PROJECT_ID });
  await bus.drain();
  check('second poll re-detected the contribution', second.detected >= 1);

  const patchCalls = captured.filter((r) => r.method === 'PATCH');
  const postCalls = captured.filter((r) => r.method === 'POST');
  check('second poll PATCHed (no new issue created)', patchCalls.length >= 1 && postCalls.length === 0);

  // mirror-delivery should now find the row via delivery_sync_state.
  const mirrorResult = await pullForProject({
    db,
    projectId: PROJECT_ID,
    adapterName: 'github',
    dryRun: false,
  });
  check('mirror-delivery pulled at least one issue', mirrorResult.pulled >= 1);

  // Verify the assignee from pullIssue was persisted to metadata.
  const { rows: enriched } = await db.query<{ metadata: { assignee?: string } }>(
    `SELECT metadata FROM delivery_sync_state WHERE contribution_id = $1 AND adapter = 'github'`,
    [contributionId],
  );
  check('mirror-delivery wrote assignee into metadata', enriched[0]?.metadata?.assignee === 'someone');

  await db.end();
}

// =========================================================================
// Run
// =========================================================================

async function main(): Promise<void> {
  console.log('\n[A] adapter unit tests (mocked fetch)');
  console.log('  upsertIssue create:');     await testUpsertIssueCreate();
  console.log('  upsertIssue closes on merged:'); await testUpsertIssueClosesOnMerged();
  console.log('  upsertIssue update:');      await testUpsertIssueUpdate();
  console.log('  pullIssue:');               await testPullIssue();
  console.log('  listManagedBranches:');     await testListManagedBranches();
  console.log('  deleteRemoteBranch:');      await testDeleteRemoteBranch();

  console.log('\n[B] integration with publish-delivery + delivery_sync_state');
  await testIntegrationCreateThenUpdate();

  console.log('\n=========================================');
  if (failures === 0) console.log('ALL GITHUB ADAPTER CHECKS PASSED');
  else console.log(`${failures} GITHUB ADAPTER CHECK(S) FAILED`);
  console.log('=========================================');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('GITHUB SMOKE CRASHED:', err);
  process.exit(2);
});
