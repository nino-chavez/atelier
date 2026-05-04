#!/usr/bin/env -S npx tsx
//
// Figma comment-source adapter smoke test. Uses an injected fake `fetch`
// (and an injected `sleep`) so the adapter can be exercised end-to-end
// without hitting the live API and without burning real wall-clock seconds
// on the inter-request delay.
//
// Two layers (mirrors jira.smoke.ts / notion.smoke.ts):
//   [A] Pure adapter tests against mocked fetch (no DB).
//   [B] Integration with triage: register the Figma adapter via the
//       registry seam, resolve it, call fetchSince() to pull canned
//       comments, feed each through routeProposal() with a high threshold
//       so the rows land in triage_pending with source='figma'. Assert
//       the persisted row carries commentSource + commentContext.fileKey.
//       Self-disables with an explicit SKIP line if DATABASE_URL is
//       unreachable (Q1 pattern).
//
// Run:
//   npm run smoke:sync-figma
//   # or: DATABASE_URL=... npx tsx scripts/sync/__smoke__/figma.smoke.ts

import { Client } from 'pg';
import {
  FigmaCommentSourceAdapter,
  FigmaApiError,
  type FigmaAdapterConfig,
} from '../lib/figma.ts';
import {
  registerCommentSourceAdapter,
  resolveCommentSourceAdapter,
} from '../lib/adapters.ts';
import { AtelierClient } from '../lib/write.ts';
import { routeProposal } from '../triage/route-proposal.ts';

const BASE_URL = 'https://api.figma.com';
const FILE_KEY_A = 'fileKeyAAA111';
const FILE_KEY_B = 'fileKeyBBB222';
const API_TOKEN  = 'figd_personal-access-token-DO-NOT-LEAK-1234';
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

// =========================================================================
// Fake fetch + fake sleep
// =========================================================================

interface CapturedRequest {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
  /** Wall-clock-relative timestamp at which the request was issued. The
   *  adapter's sleep is faked so the gap is "logical" not real, but the
   *  monotonic-counter timestamp captures the relative ordering + the
   *  sleep-induced gaps in a deterministic way. */
  monoT: number;
}

interface MockResponse {
  matcher: (req: CapturedRequest) => boolean;
  status?: number;
  json?: unknown;
  body?: string;
  headers?: Record<string, string>;
}

interface FakeStack {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  captured: CapturedRequest[];
  sleepCalls: number[];
}

function makeFakeFetch(responses: MockResponse[]): FakeStack {
  let mono = 0;
  const captured: CapturedRequest[] = [];
  const sleepCalls: number[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const req: CapturedRequest = { method, url, body, headers, monoT: mono };
    captured.push(req);
    const match = responses.find((r) => r.matcher(req));
    if (!match) {
      return new Response(JSON.stringify({ status: 500, err: 'no mock matched' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const status = match.status ?? 200;
    if (status === 204) return new Response(null, { status });
    const responseBody = match.json !== undefined ? JSON.stringify(match.json) : (match.body ?? '');
    return new Response(responseBody, {
      status,
      headers: match.headers ?? { 'Content-Type': 'application/json' },
    });
  };
  const fakeSleep = async (ms: number): Promise<void> => {
    sleepCalls.push(ms);
    mono += ms;
  };
  return { fetch: fakeFetch, sleep: fakeSleep, captured, sleepCalls };
}

function makeAdapter(extra?: Partial<FigmaAdapterConfig>): {
  adapter: FigmaCommentSourceAdapter;
  responses: MockResponse[];
  captured: CapturedRequest[];
  sleepCalls: number[];
  warnings: string[];
} {
  const responses: MockResponse[] = [];
  const stack = makeFakeFetch(responses);
  const warnings: string[] = [];
  const adapter = new FigmaCommentSourceAdapter({
    apiToken: API_TOKEN,
    fileKeys: [FILE_KEY_A],
    fetch: stack.fetch,
    sleep: stack.sleep,
    onWarn: (m) => warnings.push(m),
    ...(extra ?? {}),
  });
  return { adapter, responses, captured: stack.captured, sleepCalls: stack.sleepCalls, warnings };
}

function figmaComment(opts: {
  id: string;
  handle?: string;
  message?: string;
  createdAt: string;
  resolvedAt?: string | null;
  parentId?: string | null;
  nodeId?: string | null;
}): unknown {
  return {
    id: opts.id,
    user: { id: `user-${opts.id}`, handle: opts.handle ?? 'designer' },
    message: opts.message ?? `comment ${opts.id}`,
    created_at: opts.createdAt,
    resolved_at: opts.resolvedAt ?? null,
    parent_id: opts.parentId ?? null,
    client_meta: opts.nodeId ? { node_id: opts.nodeId, node_offset: { x: 10, y: 20 } } : null,
  };
}

// =========================================================================
// Layer A: pure adapter tests
// =========================================================================

async function testSingleFileFetch(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push({
    matcher: (r) => r.method === 'GET' && r.url.includes(`/v1/files/${FILE_KEY_A}/comments`),
    json: {
      comments: [
        figmaComment({ id: 'c-1', createdAt: '2026-05-04T10:00:00.000Z', nodeId: '1:23' }),
        figmaComment({ id: 'c-2', createdAt: '2026-05-04T11:00:00.000Z', parentId: 'c-1' }),
      ],
    },
  });

  const since = new Date('2026-05-04T00:00:00.000Z');
  const out = await adapter.fetchSince(since);

  check('single-file fetch returns 2 mapped comments', out.length === 2);
  check('source set to figma', out.every((c) => c.source === 'figma'));
  check('externalCommentId carried from Figma id', out[0]?.externalCommentId === 'c-1');
  check('externalAuthor uses Figma handle', out[0]?.externalAuthor === 'designer');
  check('text uses Figma message', out[0]?.text === 'comment c-1');
  check('receivedAt uses created_at', out[0]?.receivedAt === '2026-05-04T10:00:00.000Z');
  check('context.fileKey is the polled fileKey',
    (out[0]?.context as { fileKey: string })?.fileKey === FILE_KEY_A);
  check('context.nodeId carried from client_meta',
    (out[0]?.context as { nodeId: string | null })?.nodeId === '1:23');
  check('context.parentCommentId carried for thread reply',
    (out[1]?.context as { parentCommentId: string | null })?.parentCommentId === 'c-1');
  check('as_md=true requested',
    captured[0]?.url.includes('as_md=true') === true);
  check('output sorted ascending by receivedAt',
    out[0]!.receivedAt < out[1]!.receivedAt);
}

async function testMultiFileFetchWith500msGap(): Promise<void> {
  const { adapter: _ignore, ...stack } = makeAdapter();
  // Discard the single-file adapter; build a 2-file one explicitly.
  void _ignore;
  const responses: MockResponse[] = [];
  const fakeStack = makeFakeFetch(responses);
  const warnings: string[] = [];
  const adapter = new FigmaCommentSourceAdapter({
    apiToken: API_TOKEN,
    fileKeys: [FILE_KEY_A, FILE_KEY_B],
    fetch: fakeStack.fetch,
    sleep: fakeStack.sleep,
    onWarn: (m) => warnings.push(m),
  });
  void stack; // type silence

  responses.push(
    {
      matcher: (r) => r.method === 'GET' && r.url.includes(`/v1/files/${FILE_KEY_A}/comments`),
      json: {
        comments: [
          figmaComment({ id: 'c-A1', createdAt: '2026-05-04T10:00:00.000Z' }),
        ],
      },
    },
    {
      matcher: (r) => r.method === 'GET' && r.url.includes(`/v1/files/${FILE_KEY_B}/comments`),
      json: {
        comments: [
          figmaComment({ id: 'c-B1', createdAt: '2026-05-04T11:00:00.000Z' }),
        ],
      },
    },
  );

  const out = await adapter.fetchSince(new Date('2026-05-04T00:00:00.000Z'));
  check('multi-file fetch flattens results', out.length === 2);
  check('one comment from each file',
    out.find((c) => (c.context as { fileKey: string }).fileKey === FILE_KEY_A) !== undefined &&
    out.find((c) => (c.context as { fileKey: string }).fileKey === FILE_KEY_B) !== undefined,
  );
  check('exactly one 500ms sleep between two files',
    fakeStack.sleepCalls.length === 1 && fakeStack.sleepCalls[0] === 500,
  );
  check('first request preceded the sleep (monoT === 0)',
    fakeStack.captured[0]?.monoT === 0,
  );
  check('second request issued AFTER the 500ms sleep',
    fakeStack.captured[1]?.monoT === 500,
  );
}

async function testSinceFilterClientSide(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({
    matcher: (r) => r.url.includes(`/v1/files/${FILE_KEY_A}/comments`),
    json: {
      comments: [
        figmaComment({ id: 'old',  createdAt: '2026-05-04T08:00:00.000Z' }),
        figmaComment({ id: 'edge', createdAt: '2026-05-04T10:00:00.000Z' }),
        figmaComment({ id: 'new',  createdAt: '2026-05-04T12:00:00.000Z' }),
      ],
    },
  });
  const since = new Date('2026-05-04T10:00:00.000Z');
  const out = await adapter.fetchSince(since);
  check('older comment excluded by since',         !out.some((c) => c.externalCommentId === 'old'));
  check('comment at exactly since boundary excluded', !out.some((c) => c.externalCommentId === 'edge'));
  check('newer comment included',                  out.some((c) => c.externalCommentId === 'new'));
}

async function testResolvedExcludedByDefault(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({
    matcher: (r) => r.url.includes(`/v1/files/${FILE_KEY_A}/comments`),
    json: {
      comments: [
        figmaComment({ id: 'open',     createdAt: '2026-05-04T11:00:00.000Z' }),
        figmaComment({ id: 'resolved', createdAt: '2026-05-04T11:30:00.000Z', resolvedAt: '2026-05-04T12:00:00.000Z' }),
      ],
    },
  });
  const out = await adapter.fetchSince(new Date('2026-05-04T00:00:00.000Z'));
  check('resolved comment excluded by default', !out.some((c) => c.externalCommentId === 'resolved'));
  check('open comment kept',                    out.some((c) => c.externalCommentId === 'open'));
}

async function testIncludeResolvedFlag(): Promise<void> {
  const { adapter, responses } = makeAdapter({ includeResolved: true });
  responses.push({
    matcher: (r) => r.url.includes(`/v1/files/${FILE_KEY_A}/comments`),
    json: {
      comments: [
        figmaComment({ id: 'open',     createdAt: '2026-05-04T11:00:00.000Z' }),
        figmaComment({ id: 'resolved', createdAt: '2026-05-04T11:30:00.000Z', resolvedAt: '2026-05-04T12:00:00.000Z' }),
      ],
    },
  });
  const out = await adapter.fetchSince(new Date('2026-05-04T00:00:00.000Z'));
  check('resolved comment included when includeResolved=true', out.some((c) => c.externalCommentId === 'resolved'));
  const resolvedRow = out.find((c) => c.externalCommentId === 'resolved');
  check('context.resolved=true marker set',
    (resolvedRow?.context as { resolved: boolean })?.resolved === true,
  );
}

async function testXFigmaTokenHeaderShape(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push({
    matcher: () => true,
    json: { comments: [] },
  });
  await adapter.fetchSince(new Date('2026-05-04T00:00:00.000Z'));
  const headers = captured[0]?.headers ?? {};
  check('X-Figma-Token header carries the api token',
    headers['X-Figma-Token'] === API_TOKEN,
    `got "${headers['X-Figma-Token'] ?? '<missing>'}"`,
  );
  check('Authorization header NOT set (Bearer path is wrong for Figma)',
    headers['Authorization'] === undefined,
  );
}

async function test401RedactsCredentials(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({
    matcher: () => true,
    status: 401,
    json: { status: 401, err: `Invalid token ${API_TOKEN}` },
  });
  let thrown: unknown = null;
  try {
    await adapter.fetchSince(new Date('2026-05-04T00:00:00.000Z'));
  } catch (err) {
    thrown = err;
  }
  check('401 throws FigmaApiError', thrown instanceof FigmaApiError);
  check('401 carries 401 status', (thrown as FigmaApiError).status === 401);
  const message = String((thrown as Error).message ?? '');
  check('401 message does NOT contain api token', !message.includes(API_TOKEN));
  check('401 message uses generic auth-failure phrasing',
    message.includes('authentication failed'),
  );
}

async function test500RedactsTokenInBody(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({
    matcher: () => true,
    status: 500,
    body: `internal error processing token=${API_TOKEN} for file lookup`,
  });
  let thrown: unknown = null;
  try {
    await adapter.fetchSince(new Date('2026-05-04T00:00:00.000Z'));
  } catch (err) {
    thrown = err;
  }
  check('500 throws FigmaApiError', thrown instanceof FigmaApiError);
  const message = String((thrown as Error).message ?? '');
  check('500 message does NOT contain api token', !message.includes(API_TOKEN));
  check('500 message contains *** redaction marker', message.includes('***'));
}

async function test404OnOneFileWarnsAndContinues(): Promise<void> {
  const responses: MockResponse[] = [];
  const stack = makeFakeFetch(responses);
  const warnings: string[] = [];
  const adapter = new FigmaCommentSourceAdapter({
    apiToken: API_TOKEN,
    fileKeys: [FILE_KEY_A, FILE_KEY_B],
    fetch: stack.fetch,
    sleep: stack.sleep,
    onWarn: (m) => warnings.push(m),
  });
  responses.push(
    {
      matcher: (r) => r.url.includes(`/v1/files/${FILE_KEY_A}/comments`),
      status: 404,
      json: { status: 404, err: 'Not Found' },
    },
    {
      matcher: (r) => r.url.includes(`/v1/files/${FILE_KEY_B}/comments`),
      json: {
        comments: [
          figmaComment({ id: 'c-survivor', createdAt: '2026-05-04T11:00:00.000Z' }),
        ],
      },
    },
  );

  const out = await adapter.fetchSince(new Date('2026-05-04T00:00:00.000Z'));
  check('survivor comment from valid fileKey returned', out.length === 1 && out[0]?.externalCommentId === 'c-survivor');
  check('warning logged for the 404 fileKey', warnings.some((w) => w.includes(FILE_KEY_A)));
  check('warning mentions 404',                warnings.some((w) => w.includes('404')));
}

async function testEmptyFileKeysThrows(): Promise<void> {
  const responses: MockResponse[] = [];
  const stack = makeFakeFetch(responses);
  const adapter = new FigmaCommentSourceAdapter({
    apiToken: API_TOKEN,
    fileKeys: [],
    fetch: stack.fetch,
    sleep: stack.sleep,
  });
  let thrown: unknown = null;
  try {
    await adapter.fetchSince(new Date('2026-05-04T00:00:00.000Z'));
  } catch (err) {
    thrown = err;
  }
  check('empty fileKeys throws', thrown instanceof Error);
  const message = String((thrown as Error).message ?? '');
  check('error names the fileKeys requirement', message.includes('fileKeys'));
}

async function testFigmaUrlConstructed(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({
    matcher: (r) => r.url.includes(`/v1/files/${FILE_KEY_A}/comments`),
    json: {
      comments: [
        figmaComment({ id: 'c-link-A', createdAt: '2026-05-04T11:00:00.000Z', nodeId: '5:678' }),
        figmaComment({ id: 'c-link-B', createdAt: '2026-05-04T11:30:00.000Z' }),
      ],
    },
  });
  const out = await adapter.fetchSince(new Date('2026-05-04T00:00:00.000Z'));
  const withNode = out.find((c) => c.externalCommentId === 'c-link-A');
  const withoutNode = out.find((c) => c.externalCommentId === 'c-link-B');
  const urlWithNode = (withNode?.context as { figmaUrl: string })?.figmaUrl;
  const urlWithoutNode = (withoutNode?.context as { figmaUrl: string })?.figmaUrl;
  check('figmaUrl includes file fileKey', urlWithNode?.includes(FILE_KEY_A) === true);
  check('figmaUrl includes node-id when client_meta.node_id present',
    urlWithNode?.includes('node-id=') === true,
  );
  check('figmaUrl omits node-id when client_meta absent',
    urlWithoutNode !== undefined && !urlWithoutNode.includes('node-id='),
  );
}

// =========================================================================
// Layer B: integration with triage (registry seam + routeProposal)
// =========================================================================

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

async function testTriageIntegration(): Promise<void> {
  // -------- Seed fixtures --------
  // Dedicated namespace for the figma smoke; chosen to avoid colliding with
  // other smokes that share the 88888888-* / 77777777-* prefixes.
  const projectId          = 'f5f5f5f5-1111-1111-1111-111111111111';
  const triageComposerId   = 'f5f5f5f5-2222-2222-2222-222222222222';
  const territoryId        = 'f5f5f5f5-4444-4444-4444-444444444444';

  const seed = new Client({ connectionString: DB_URL });
  await seed.connect();
  // Cleanup from prior runs. contracts is deleted before territories
  // (FK contracts.territory_id -> territories.id).
  await seed.query(`DELETE FROM triage_pending WHERE project_id = $1`, [projectId]);
  await seed.query(`DELETE FROM contracts WHERE project_id = $1`, [projectId]);
  await seed.query(`DELETE FROM contributions WHERE project_id = $1`, [projectId]);
  await seed.query(`DELETE FROM locks WHERE project_id = $1`, [projectId]);
  await seed.query(`DELETE FROM territories WHERE project_id = $1`, [projectId]);
  await seed.query(`DELETE FROM sessions WHERE composer_id = $1`, [triageComposerId]);
  await seed.query(`DELETE FROM composers WHERE project_id = $1`, [projectId]);
  await seed.query(`DELETE FROM projects WHERE id = $1`, [projectId]);

  await seed.query(
    `INSERT INTO projects (id, name, repo_url, template_version)
     VALUES ($1, 'figma-smoke', 'https://example.invalid/figma-smoke', '1.0')`,
    [projectId],
  );
  await seed.query(
    `INSERT INTO composers (id, project_id, email, display_name, discipline, identity_subject)
     VALUES ($1, $2, 'triage-bot@figma-smoke.invalid', 'Triage Bot', 'designer', 'sub-figma-triage')`,
    [triageComposerId, projectId],
  );
  await seed.query(
    `INSERT INTO territories (id, project_id, name, owner_role, review_role, scope_kind, scope_pattern)
     VALUES ($1, $2, 'figma-smoke-terr', 'designer', 'architect', 'design_component', ARRAY['figma-smoke/**'])`,
    [territoryId, projectId],
  );
  await seed.end();

  const client = new AtelierClient({ databaseUrl: DB_URL });
  try {
    const triageSession = await client.createSession({
      projectId,
      composerId: triageComposerId,
      surface: 'passive',
    });

    // Wire the Figma adapter through the public registry seam (the same
    // seam the registry-factory uses) so this test exercises the
    // resolveCommentSourceAdapter('figma') path adopters will use.
    const responses: MockResponse[] = [];
    const stack = makeFakeFetch(responses);
    const adapter = new FigmaCommentSourceAdapter({
      apiToken: API_TOKEN,
      fileKeys: [FILE_KEY_A],
      fetch: stack.fetch,
      sleep: stack.sleep,
    });
    registerCommentSourceAdapter(adapter);
    responses.push({
      matcher: (r) => r.url.includes(`/v1/files/${FILE_KEY_A}/comments`),
      json: {
        comments: [
          figmaComment({
            id:        'figma-cmt-trg-1',
            handle:    'design-reviewer',
            message:   'spacing on this CTA looks tight',
            createdAt: '2026-05-04T11:00:00.000Z',
            nodeId:    '42:99',
          }),
        ],
      },
    });

    const resolved = resolveCommentSourceAdapter('figma');
    check('[B] adapter resolvable from registry by name', resolved.name === 'figma');

    const fetched = await resolved.fetchSince(new Date('2026-05-04T00:00:00.000Z'));
    check('[B] fetchSince returned 1 comment', fetched.length === 1);

    // Route through triage with a high threshold so the heuristic
    // classifier (low confidence on this terse message) routes the row
    // to triage_pending rather than creating a contribution.
    const decision = await routeProposal({
      client,
      comment: fetched[0]!,
      classifierName: 'heuristic-v1',
      projectId,
      triageSessionId: triageSession.id,
      territoryId,
      contentRef: `triage/figma-${fetched[0]!.externalCommentId}.md`,
      threshold: 0.99,
      dryRun: false,
    });
    check('[B] outcome routed_to_human_queue', decision.outcome === 'routed_to_human_queue');
    check('[B] triagePendingId present',       typeof decision.triagePendingId === 'string');

    const pending = await client.triagePendingList({ projectId });
    check('[B] triage_pending list returned 1 row', pending.length === 1);
    check('[B] row.commentSource === figma', pending[0]?.commentSource === 'figma');
    check('[B] row.externalCommentId carried',
      pending[0]?.externalCommentId === 'figma-cmt-trg-1');
    check('[B] row.commentContext.fileKey carried',
      (pending[0]?.commentContext as { fileKey?: string } | undefined)?.fileKey === FILE_KEY_A,
    );
    check('[B] row.commentContext.nodeId carried',
      (pending[0]?.commentContext as { nodeId?: string } | undefined)?.nodeId === '42:99',
    );
  } finally {
    await client.close();
  }
}

// =========================================================================
// Run
// =========================================================================

async function main(): Promise<void> {
  void BASE_URL; // referenced in docs/comments only

  console.log('\n[A] adapter unit tests (mocked fetch)');
  console.log('  single-file fetch:');                  await testSingleFileFetch();
  console.log('  multi-file 500ms gap:');               await testMultiFileFetchWith500msGap();
  console.log('  since filter (client-side):');         await testSinceFilterClientSide();
  console.log('  resolved excluded by default:');       await testResolvedExcludedByDefault();
  console.log('  includeResolved=true honored:');       await testIncludeResolvedFlag();
  console.log('  X-Figma-Token header (NOT Bearer):');  await testXFigmaTokenHeaderShape();
  console.log('  401 redacts credentials:');            await test401RedactsCredentials();
  console.log('  500 redacts token in body:');          await test500RedactsTokenInBody();
  console.log('  404 on one fileKey -> warn+continue:'); await test404OnOneFileWarnsAndContinues();
  console.log('  empty fileKeys throws:');              await testEmptyFileKeysThrows();
  console.log('  figmaUrl construction:');              await testFigmaUrlConstructed();

  console.log('\n[B] integration with triage (routeProposal -> triage_pending)');
  const dbReachable = await tryConnectDb();
  if (!dbReachable) {
    console.log(`  SKIP  no Postgres reachable at ${DB_URL}; bring up local stack via 'supabase start' or set DATABASE_URL`);
  } else {
    await testTriageIntegration();
  }

  console.log('\n=========================================');
  if (failures === 0) console.log('ALL FIGMA ADAPTER CHECKS PASSED');
  else console.log(`${failures} FIGMA ADAPTER CHECK(S) FAILED`);
  console.log('=========================================');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FIGMA SMOKE CRASHED:', err);
  process.exit(2);
});
