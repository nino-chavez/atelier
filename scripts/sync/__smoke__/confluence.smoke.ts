#!/usr/bin/env -S npx tsx
//
// Confluence doc adapter smoke test. Uses an injected fake `fetch` so the
// adapter can be exercised end-to-end without hitting the live API.
//
// Two layers (mirrors jira.smoke.ts / linear.smoke.ts):
//   [A] Pure adapter tests against mocked fetch (no DB).
//   [B] Integration with publish-docs.publishDoc() through the registry.
//       publish-docs is one-shot and only writes telemetry inside main();
//       there is no doc_sync_state table, so [B] does not require a DB and
//       does not gate behind tryConnectDb. The verification is that the
//       adapter is reachable through the public publishDoc seam and that
//       captured fetch traffic matches the expected sequence.

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConfluenceDocAdapter,
  ConfluenceHttpError,
  type ConfluenceAdapterConfig,
} from '../lib/confluence.ts';
import {
  registerDocAdapter,
} from '../lib/adapters.ts';
import { publishDoc } from '../publish-docs.ts';

const BASE_URL = 'https://atelier-test.atlassian.net/wiki';
const SPACE_KEY = 'ATL';
const EMAIL = 'smoke@atelier.test';
const API_TOKEN = 'confluence-test-api-token-do-not-leak';

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
  /** Set true to consume only once; subsequent matching requests fall through. */
  once?: boolean;
}

function makeFakeFetch(responses: MockResponse[]) {
  const captured: CapturedRequest[] = [];
  const consumed = new WeakSet<MockResponse>();
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const req: CapturedRequest = { method, url, body, headers };
    captured.push(req);

    const match = responses.find((r) => (!r.once || !consumed.has(r)) && r.matcher(req));
    if (!match) {
      return new Response(JSON.stringify({ message: 'no mock matched' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (match.once) consumed.add(match);
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

function makeAdapter(extra?: Partial<ConfluenceAdapterConfig>) {
  const responses: MockResponse[] = [];
  const dispatch = makeFakeFetch(responses);
  const adapter = new ConfluenceDocAdapter({
    baseUrl: BASE_URL,
    email: EMAIL,
    apiToken: API_TOKEN,
    fetch: dispatch.fetch,
    ...(extra ?? {}),
  });
  return { adapter, responses, captured: dispatch.captured };
}

// Builds a Confluence content object suitable as a search hit or POST/PUT response.
function contentObj(opts: { id: string; title: string; version: number; spaceKey?: string }): unknown {
  const space = opts.spaceKey ?? SPACE_KEY;
  return {
    id: opts.id,
    type: 'page',
    title: opts.title,
    version: { number: opts.version },
    _links: {
      webui: `/spaces/${space}/pages/${opts.id}/${encodeURIComponent(opts.title.replace(/\s+/g, '+'))}`,
      base: BASE_URL,
      self: `${BASE_URL}/rest/api/content/${opts.id}`,
    },
  };
}

// =========================================================================
// Layer A: pure adapter tests
// =========================================================================

const PUBLISH_INPUT_BASE = {
  externalSpaceId: SPACE_KEY,
  pageKey: 'docs-test-page',
  title: 'Atelier Test Page',
  bodyHtml: '<h1>Hello</h1><p>body</p>',
  bannerNote: 'Edits here will be overwritten. Atelier is the source of truth.',
};

async function testCreateNewPage(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'GET' && r.url.includes('/rest/api/content?'),
      json: { results: [], size: 0 },
    },
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/rest/api/content'),
      json: contentObj({ id: '12345', title: PUBLISH_INPUT_BASE.title, version: 1 }),
      status: 200,
    },
  );

  const result = await adapter.publishPage(PUBLISH_INPUT_BASE);
  check('create returns externalRevision = "1"', result.externalRevision === '1');
  check(
    'create returns externalUrl = base + webui',
    result.externalUrl === `${BASE_URL}/spaces/${SPACE_KEY}/pages/12345/${encodeURIComponent(PUBLISH_INPUT_BASE.title.replace(/\s+/g, '+'))}`,
  );

  const search = captured.find((r) => r.method === 'GET' && r.url.includes('/rest/api/content?'));
  check('title-search GET issued first', search !== undefined);
  check('title-search includes spaceKey', search !== undefined && search.url.includes(`spaceKey=${SPACE_KEY}`));
  // URLSearchParams uses '+' for spaces (form-urlencoded), not %20 — accepted by Confluence.
  check('title-search includes title query', search !== undefined && search.url.includes('title=Atelier+Test+Page'));
  check('title-search expands version', search !== undefined && search.url.includes('expand=version'));

  const post = captured.find((r) => r.method === 'POST' && r.url.endsWith('/rest/api/content'));
  check('POST issued to /rest/api/content', post !== undefined);
  const postBody = post?.body as {
    type: string;
    title: string;
    space: { key: string };
    body: { storage: { value: string; representation: string } };
  };
  check('POST body type=page', postBody?.type === 'page');
  check('POST body carries title', postBody?.title === PUBLISH_INPUT_BASE.title);
  check('POST body carries spaceKey', postBody?.space?.key === SPACE_KEY);
  check('POST body uses storage representation', postBody?.body?.storage?.representation === 'storage');
  check('storage value contains banner as <p>', postBody?.body?.storage?.value?.includes('<p>Edits here will be overwritten'));
  check('storage value contains <hr/>', postBody?.body?.storage?.value?.includes('<hr/>'));
  check('storage value contains bodyHtml verbatim', postBody?.body?.storage?.value?.includes('<h1>Hello</h1><p>body</p>'));

  // Authorization shape.
  const auth = post?.headers['Authorization'] ?? '';
  check('POST Authorization header uses Basic scheme', auth.startsWith('Basic '));
}

async function testUpdateExistingPage(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'GET' && r.url.includes('/rest/api/content?'),
      json: { results: [contentObj({ id: '777', title: PUBLISH_INPUT_BASE.title, version: 4 })], size: 1 },
    },
    {
      matcher: (r) => r.method === 'PUT' && r.url.endsWith('/rest/api/content/777'),
      json: contentObj({ id: '777', title: PUBLISH_INPUT_BASE.title, version: 5 }),
    },
  );

  const result = await adapter.publishPage(PUBLISH_INPUT_BASE);
  check('update returns externalRevision = "5"', result.externalRevision === '5');

  const put = captured.find((r) => r.method === 'PUT');
  check('PUT issued to existing page', put !== undefined);
  const putBody = put?.body as { id: string; type: string; title: string; version: { number: number }; body: unknown };
  check('PUT body version.number = current+1', putBody?.version?.number === 5);
  check('PUT body carries id', putBody?.id === '777');
  check('PUT body carries title', putBody?.title === PUBLISH_INPUT_BASE.title);

  const post = captured.find((r) => r.method === 'POST');
  check('no POST issued on update path', post === undefined);
}

async function testCqlTitleSearchRoundTrip(): Promise<void> {
  // Verify the title-search request shape is well-formed for non-trivial titles.
  const { adapter, responses, captured } = makeAdapter();
  const trickyTitle = 'Hello & "World"';
  responses.push(
    {
      matcher: (r) => r.method === 'GET' && r.url.includes('/rest/api/content?'),
      json: { results: [], size: 0 },
    },
    {
      matcher: (r) => r.method === 'POST',
      json: contentObj({ id: '1', title: trickyTitle, version: 1 }),
    },
  );
  await adapter.publishPage({ ...PUBLISH_INPUT_BASE, title: trickyTitle });

  const search = captured.find((r) => r.method === 'GET' && r.url.includes('/rest/api/content?'));
  check('title-search URL preserves URL-encoded title', search !== undefined && search.url.includes('title=Hello+%26+%22World%22'));
  check('title-search URL is well-formed (single ?)', search !== undefined && (search.url.match(/\?/g)?.length === 1));
}

async function test409ConflictThenSuccess(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  // First search: page exists at version 1.
  responses.push({
    matcher: (r) => r.method === 'GET' && r.url.includes('/rest/api/content?'),
    json: { results: [contentObj({ id: '42', title: PUBLISH_INPUT_BASE.title, version: 1 })], size: 1 },
    once: true,
  });
  // First PUT: 409 conflict.
  responses.push({
    matcher: (r) => r.method === 'PUT' && r.url.endsWith('/rest/api/content/42'),
    status: 409,
    json: { message: 'Version mismatch' },
    once: true,
  });
  // Second search: page is now at version 2 (concurrent writer bumped it).
  responses.push({
    matcher: (r) => r.method === 'GET' && r.url.includes('/rest/api/content?'),
    json: { results: [contentObj({ id: '42', title: PUBLISH_INPUT_BASE.title, version: 2 })], size: 1 },
    once: true,
  });
  // Second PUT: success at version 3.
  responses.push({
    matcher: (r) => r.method === 'PUT' && r.url.endsWith('/rest/api/content/42'),
    json: contentObj({ id: '42', title: PUBLISH_INPUT_BASE.title, version: 3 }),
    once: true,
  });

  const result = await adapter.publishPage(PUBLISH_INPUT_BASE);
  check('retry succeeded; externalRevision = "3"', result.externalRevision === '3');

  const puts = captured.filter((r) => r.method === 'PUT');
  check('two PUT requests issued (initial + retry)', puts.length === 2);
  const firstPut  = puts[0]?.body as { version: { number: number } } | undefined;
  const secondPut = puts[1]?.body as { version: { number: number } } | undefined;
  check('first PUT body version.number = 2 (current 1 + 1)', firstPut?.version?.number === 2);
  // current at first known fetch was 1; after retry the body has version=3 (= 1 + 2).
  check('second PUT body version.number = 3 (current+2 from now-stale value)', secondPut?.version?.number === 3);
}

async function test409ConflictExhaustsRetries(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  // Always return version 1 on search and always 409 on PUT.
  responses.push({
    matcher: (r) => r.method === 'GET' && r.url.includes('/rest/api/content?'),
    json: { results: [contentObj({ id: '99', title: PUBLISH_INPUT_BASE.title, version: 1 })], size: 1 },
  });
  responses.push({
    matcher: (r) => r.method === 'PUT' && r.url.endsWith('/rest/api/content/99'),
    status: 409,
    json: { message: 'Version mismatch' },
  });

  let thrown: unknown = null;
  try {
    await adapter.publishPage(PUBLISH_INPUT_BASE);
  } catch (err) {
    thrown = err;
  }
  check('publishPage throws after 3 failed attempts', thrown instanceof ConfluenceHttpError);
  const status = (thrown as ConfluenceHttpError).status;
  check('thrown error carries 409 status', status === 409);
}

async function testBodyRendering(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'GET',
      json: { results: [], size: 0 },
    },
    {
      matcher: (r) => r.method === 'POST',
      json: contentObj({ id: '1', title: 'Body Test', version: 1 }),
    },
  );
  await adapter.publishPage({
    ...PUBLISH_INPUT_BASE,
    title: 'Body Test',
    bannerNote: 'A & B <c> "d"',
    bodyHtml: '<p>raw &amp; safe</p>',
  });
  const post = captured.find((r) => r.method === 'POST');
  const value = (post?.body as { body: { storage: { value: string } } })?.body?.storage?.value ?? '';
  check('bannerNote `&` is XML-escaped to &amp;', value.includes('A &amp; B'));
  check('bannerNote `<` is XML-escaped to &lt;', value.includes('&lt;c&gt;'));
  check('bannerNote `"` is XML-escaped to &quot;', value.includes('&quot;d&quot;'));
  check('bodyHtml passes through verbatim (already-encoded entities preserved)', value.includes('<p>raw &amp; safe</p>'));
  check('banner appears before <hr/>', value.indexOf('A &amp; B') < value.indexOf('<hr/>'));
  check('<hr/> appears before bodyHtml', value.indexOf('<hr/>') < value.indexOf('<p>raw'));
}

async function testSpaceKeyFallbackToDefault(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter({ defaultSpaceKey: 'FALLBACK' });
  responses.push(
    {
      matcher: (r) => r.method === 'GET',
      json: { results: [], size: 0 },
    },
    {
      matcher: (r) => r.method === 'POST',
      json: contentObj({ id: '1', title: PUBLISH_INPUT_BASE.title, version: 1, spaceKey: 'FALLBACK' }),
    },
  );

  await adapter.publishPage({ ...PUBLISH_INPUT_BASE, externalSpaceId: '' });

  const search = captured.find((r) => r.method === 'GET');
  check('title-search uses defaultSpaceKey when externalSpaceId empty', search !== undefined && search.url.includes('spaceKey=FALLBACK'));
  const post = captured.find((r) => r.method === 'POST');
  const postBody = post?.body as { space: { key: string } };
  check('POST body uses defaultSpaceKey', postBody?.space?.key === 'FALLBACK');
}

async function testMissingSpaceKeyThrows(): Promise<void> {
  const { adapter } = makeAdapter(); // no defaultSpaceKey
  let thrown: unknown = null;
  try {
    await adapter.publishPage({ ...PUBLISH_INPUT_BASE, externalSpaceId: '' });
  } catch (err) {
    thrown = err;
  }
  check('missing-spaceKey throws', thrown instanceof Error);
  const message = String((thrown as Error).message ?? '');
  check('error names the spaceKey requirement', message.includes('spaceKey required'));
}

async function test401RedactsCredentials(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({
    matcher: () => true,
    status: 401,
    json: { message: `Unauthorized; token=${API_TOKEN}` },
  });

  let thrown: unknown = null;
  try {
    await adapter.publishPage(PUBLISH_INPUT_BASE);
  } catch (err) {
    thrown = err;
  }
  check('401 throws ConfluenceHttpError', thrown instanceof ConfluenceHttpError);
  check('401 carries 401 status', (thrown as ConfluenceHttpError).status === 401);
  const message = String((thrown as Error).message ?? '');
  check('error message does NOT contain api token', !message.includes(API_TOKEN));
  // Confirm the encoded Basic-auth value is also absent from the message.
  const encodedAuth = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');
  check('error message does NOT contain encoded basic-auth value', !message.includes(encodedAuth));
  check('error message uses generic phrasing', message.includes('authentication failed'));
}

async function test500RedactsCredentialsInBody(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({
    matcher: () => true,
    status: 500,
    body: `internal error processing apikey=${API_TOKEN} for space ${SPACE_KEY}`,
  });
  let thrown: unknown = null;
  try {
    await adapter.publishPage(PUBLISH_INPUT_BASE);
  } catch (err) {
    thrown = err;
  }
  check('500 throws ConfluenceHttpError', thrown instanceof ConfluenceHttpError);
  const message = String((thrown as Error).message ?? '');
  check('500 message does NOT contain api token', !message.includes(API_TOKEN));
  check('500 message contains *** redaction marker', message.includes('***'));
}

// =========================================================================
// Layer B: integration with publish-docs.publishDoc()
// =========================================================================

async function testPublishDocIntegration(): Promise<void> {
  const captured: CapturedRequest[] = [];
  let postedTitle: string | null = null;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    captured.push({ method, url, body, headers: {} });

    if (method === 'GET' && url.includes('/rest/api/content?')) {
      return new Response(JSON.stringify({ results: [], size: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'POST' && url.endsWith('/rest/api/content')) {
      const b = body as { title: string };
      postedTitle = b.title;
      return new Response(
        JSON.stringify({
          id: '88888',
          type: 'page',
          title: b.title,
          version: { number: 1 },
          _links: {
            webui: `/spaces/${SPACE_KEY}/pages/88888/${encodeURIComponent(b.title.replace(/\s+/g, '+'))}`,
            base: BASE_URL,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ message: 'no mock' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  // Register the Confluence adapter with the mock fetch through the shared registry.
  const adapter = new ConfluenceDocAdapter({
    baseUrl: BASE_URL,
    email: EMAIL,
    apiToken: API_TOKEN,
    fetch: fakeFetch,
  });
  registerDocAdapter(adapter);

  // Write a temp markdown file -- publishDoc reads from disk.
  const tmpFile = join(tmpdir(), `atelier-confluence-smoke-${process.pid}.md`);
  await fs.writeFile(tmpFile, '# Smoke Page\n\nSome body text.\n', 'utf8');
  try {
    const result = await publishDoc({
      docPath: tmpFile,
      adapterName: 'confluence',
      space: SPACE_KEY,
      dryRun: false,
    });

    check('publishDoc returned externalUrl', typeof result.externalUrl === 'string' && result.externalUrl.startsWith(`${BASE_URL}/spaces/${SPACE_KEY}/pages/88888/`));
    check('publishDoc returned externalRevision', result.externalRevision === '1');
    check('title derived from first H1 heading', postedTitle === 'Smoke Page');

    const search = captured.find((r) => r.method === 'GET' && r.url.includes('/rest/api/content?'));
    check('publishDoc -> adapter -> GET title-search request', search !== undefined);
    check('search URL carries the resolved spaceKey', search !== undefined && search.url.includes(`spaceKey=${SPACE_KEY}`));
    const post = captured.find((r) => r.method === 'POST');
    check('publishDoc -> adapter -> POST create request', post !== undefined);
    const value = (post?.body as { body: { storage: { value: string } } })?.body?.storage?.value ?? '';
    check('storage body has banner prepended', value.includes('Atelier is the source of truth'));
    check('storage body has <hr/> separator', value.includes('<hr/>'));
    check('storage body contains the doc body markdown verbatim', value.includes('Some body text.'));
  } finally {
    try { await fs.unlink(tmpFile); } catch { /* ignore */ }
  }
}

// =========================================================================
// Run
// =========================================================================

async function main(): Promise<void> {
  console.log('\n[A] adapter unit tests (mocked fetch)');
  console.log('  create new page:');                 await testCreateNewPage();
  console.log('  update existing page:');            await testUpdateExistingPage();
  console.log('  CQL/title-search round-trip:');     await testCqlTitleSearchRoundTrip();
  console.log('  409 conflict then success retry:'); await test409ConflictThenSuccess();
  console.log('  409 conflict exhausts retries:');   await test409ConflictExhaustsRetries();
  console.log('  body rendering (banner + body):');  await testBodyRendering();
  console.log('  spaceKey fallback to default:');    await testSpaceKeyFallbackToDefault();
  console.log('  missing spaceKey throws:');         await testMissingSpaceKeyThrows();
  console.log('  401 redacts credentials:');         await test401RedactsCredentials();
  console.log('  500 redacts credentials in body:'); await test500RedactsCredentialsInBody();

  console.log('\n[B] integration with publish-docs.publishDoc()');
  await testPublishDocIntegration();

  console.log('\n=========================================');
  if (failures === 0) console.log('ALL CONFLUENCE ADAPTER CHECKS PASSED');
  else console.log(`${failures} CONFLUENCE ADAPTER CHECK(S) FAILED`);
  console.log('=========================================');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('CONFLUENCE SMOKE CRASHED:', err);
  process.exit(2);
});
