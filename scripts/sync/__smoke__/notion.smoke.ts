#!/usr/bin/env -S npx tsx
//
// Notion doc adapter smoke test. Uses an injected fake `fetch` so the
// adapter can be exercised end-to-end without hitting the live API.
//
// Two layers (mirrors confluence.smoke.ts):
//   [A] Pure adapter tests against mocked fetch (no DB).
//   [B] Integration with publish-docs.publishDoc() through the registry.
//       publish-docs is one-shot and only writes telemetry inside main();
//       there is no doc_sync_state table, so [B] does not require a DB and
//       does not gate behind tryConnectDb. Verification is that the adapter
//       is reachable through the public publishDoc seam.

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NotionDocAdapter,
  NotionApiError,
  htmlToBlocks,
  type NotionAdapterConfig,
} from '../lib/notion.ts';
import {
  registerDocAdapter,
} from '../lib/adapters.ts';
import { publishDoc } from '../publish-docs.ts';

const BASE_URL = 'https://api.notion.com';
const DATABASE_ID = '11111111111111111111111111111111';
const API_TOKEN = 'secret_notion-token-DO-NOT-LEAK-1234';
const NOTION_VERSION = '2022-06-28';

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
      return new Response(JSON.stringify({ object: 'error', status: 500, code: 'no_mock', message: 'no mock matched' }), {
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

function makeAdapter(extra?: Partial<NotionAdapterConfig>) {
  const responses: MockResponse[] = [];
  const dispatch = makeFakeFetch(responses);
  const adapter = new NotionDocAdapter({
    apiToken: API_TOKEN,
    fetch: dispatch.fetch,
    ...(extra ?? {}),
  });
  return { adapter, responses, captured: dispatch.captured };
}

function pageObj(opts: { id: string; title?: string; archived?: boolean; lastEdited?: string }): unknown {
  return {
    object: 'page',
    id: opts.id,
    url: `https://www.notion.so/${opts.id.replace(/-/g, '')}`,
    last_edited_time: opts.lastEdited ?? '2026-05-04T12:00:00.000Z',
    archived: opts.archived ?? false,
  };
}

const PUBLISH_INPUT_BASE = {
  externalSpaceId: DATABASE_ID,
  pageKey: 'docs-test-page',
  title: 'Atelier Test Page',
  bodyHtml: '<h1>Hello</h1><p>body</p>',
  bannerNote: 'Edits here will be overwritten. Atelier is the source of truth.',
};

// =========================================================================
// Layer A: pure adapter tests
// =========================================================================

async function testCreateNewPage(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith(`/v1/databases/${DATABASE_ID}/query`),
      json: { results: [], has_more: false, next_cursor: null },
    },
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/v1/pages'),
      json: pageObj({ id: 'page-uuid-12345', lastEdited: '2026-05-04T13:00:00.000Z' }),
    },
  );

  const result = await adapter.publishPage(PUBLISH_INPUT_BASE);
  check('create returns externalRevision = last_edited_time', result.externalRevision === '2026-05-04T13:00:00.000Z');
  check('create returns externalUrl from page response', result.externalUrl === 'https://www.notion.so/pageuuid12345');

  const query = captured.find((r) => r.method === 'POST' && r.url.includes('/databases/'));
  check('database query POSTed first', query !== undefined);
  const queryBody = query?.body as { filter: { property: string; title: { equals: string } }; page_size: number };
  check('query filter property is "Name"', queryBody?.filter?.property === 'Name');
  check('query filter title equals input title', queryBody?.filter?.title?.equals === PUBLISH_INPUT_BASE.title);

  const create = captured.find((r) => r.method === 'POST' && r.url.endsWith('/v1/pages'));
  check('POST issued to /v1/pages', create !== undefined);
  const createBody = create?.body as {
    parent: { database_id: string };
    properties: { Name: { title: { type: string; text: { content: string } }[] } };
    children: unknown[];
  };
  check('create body has parent.database_id', createBody?.parent?.database_id === DATABASE_ID);
  check('create body sets Name title', createBody?.properties?.Name?.title?.[0]?.text?.content === PUBLISH_INPUT_BASE.title);
  check('create body includes children blocks', Array.isArray(createBody?.children) && createBody.children.length >= 3);

  // First child is the banner paragraph block.
  const firstChild = createBody?.children?.[0] as { type: string; paragraph?: { rich_text: { text: { content: string } }[] } };
  check('first child is a paragraph block (banner)', firstChild?.type === 'paragraph');
  check('banner content is the bannerNote',
    firstChild?.paragraph?.rich_text?.[0]?.text?.content === PUBLISH_INPUT_BASE.bannerNote,
  );
  // Second child is a divider.
  const secondChild = createBody?.children?.[1] as { type: string };
  check('second child is a divider block', secondChild?.type === 'divider');
}

async function testUpdateExistingPageDeleteThenReplace(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  const PAGE_ID = 'page-uuid-existing';
  responses.push(
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith(`/v1/databases/${DATABASE_ID}/query`),
      json: { results: [pageObj({ id: PAGE_ID })], has_more: false, next_cursor: null },
    },
    {
      matcher: (r) => r.method === 'PATCH' && r.url.endsWith(`/v1/pages/${PAGE_ID}`),
      json: pageObj({ id: PAGE_ID, lastEdited: '2026-05-04T14:00:00.000Z' }),
    },
    {
      matcher: (r) => r.method === 'GET' && r.url.includes(`/v1/blocks/${PAGE_ID}/children`),
      json: {
        results: [
          { object: 'block', id: 'block-1', type: 'paragraph', has_children: false },
          { object: 'block', id: 'block-2', type: 'paragraph', has_children: false },
        ],
        has_more: false,
        next_cursor: null,
      },
    },
    {
      matcher: (r) => r.method === 'DELETE' && r.url.endsWith('/v1/blocks/block-1'),
      json: { object: 'block', id: 'block-1', archived: true },
    },
    {
      matcher: (r) => r.method === 'DELETE' && r.url.endsWith('/v1/blocks/block-2'),
      json: { object: 'block', id: 'block-2', archived: true },
    },
    {
      matcher: (r) => r.method === 'PATCH' && r.url.endsWith(`/v1/blocks/${PAGE_ID}/children`),
      json: { results: [], has_more: false, next_cursor: null },
    },
    {
      matcher: (r) => r.method === 'GET' && r.url.endsWith(`/v1/pages/${PAGE_ID}`),
      json: pageObj({ id: PAGE_ID, lastEdited: '2026-05-04T14:30:00.000Z' }),
    },
  );

  const result = await adapter.publishPage(PUBLISH_INPUT_BASE);
  check('update returns externalRevision = refreshed last_edited_time', result.externalRevision === '2026-05-04T14:30:00.000Z');

  // Verify the operation order: query -> patch title -> list children -> delete each -> patch children (append) -> get page.
  const sequence = captured.map((r) => `${r.method} ${r.url.replace(BASE_URL, '')}`);
  const queryIdx     = sequence.findIndex((s) => s.startsWith(`POST /v1/databases/${DATABASE_ID}/query`));
  const titlePatchIdx = sequence.findIndex((s) => s === `PATCH /v1/pages/${PAGE_ID}`);
  const listChildren = sequence.findIndex((s) => s.startsWith(`GET /v1/blocks/${PAGE_ID}/children`));
  const delete1Idx   = sequence.findIndex((s) => s === 'DELETE /v1/blocks/block-1');
  const delete2Idx   = sequence.findIndex((s) => s === 'DELETE /v1/blocks/block-2');
  const appendIdx    = sequence.findIndex((s) => s === `PATCH /v1/blocks/${PAGE_ID}/children`);
  const refreshIdx   = sequence.findIndex((s) => s === `GET /v1/pages/${PAGE_ID}`);

  check('database query happened first', queryIdx === 0);
  check('title PATCH happened before listing children', titlePatchIdx > queryIdx && titlePatchIdx < listChildren);
  check('listed children before deleting them', listChildren > 0 && delete1Idx > listChildren && delete2Idx > listChildren);
  check('appended new children AFTER deleting old', appendIdx > delete2Idx);
  check('refreshed page AFTER appending', refreshIdx > appendIdx);

  // No POST to /v1/pages on the update path.
  const create = captured.find((r) => r.method === 'POST' && r.url.endsWith('/v1/pages'));
  check('no /v1/pages POST issued on update path', create === undefined);

  // The append PATCH carries the banner + divider + bodyHtml-derived blocks.
  const append = captured.find((r) => r.method === 'PATCH' && r.url.endsWith(`/v1/blocks/${PAGE_ID}/children`));
  const appendBody = append?.body as { children: { type: string }[] };
  check('append body has at least banner+divider+bodyHtml blocks', appendBody?.children?.length >= 3);
  check('append body first block is banner paragraph', appendBody?.children?.[0]?.type === 'paragraph');
  check('append body second block is divider', appendBody?.children?.[1]?.type === 'divider');
}

async function testTitleSearchWithCachedHit(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith(`/v1/databases/${DATABASE_ID}/query`),
      json: { results: [], has_more: false, next_cursor: null },
    },
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/v1/pages'),
      json: pageObj({ id: 'page-cache-1' }),
    },
  );
  await adapter.publishPage(PUBLISH_INPUT_BASE);
  // Second publish of the same title should use the cache and skip the database-query call.
  const queryCountBefore = captured.filter((r) => r.url.includes(`/databases/${DATABASE_ID}/query`)).length;

  // Add update-path mocks for the cached pageId.
  responses.push(
    {
      matcher: (r) => r.method === 'PATCH' && r.url.endsWith('/v1/pages/page-cache-1'),
      json: pageObj({ id: 'page-cache-1' }),
    },
    {
      matcher: (r) => r.method === 'GET' && r.url.includes('/v1/blocks/page-cache-1/children'),
      json: { results: [], has_more: false, next_cursor: null },
    },
    {
      matcher: (r) => r.method === 'PATCH' && r.url.endsWith('/v1/blocks/page-cache-1/children'),
      json: { results: [], has_more: false, next_cursor: null },
    },
    {
      matcher: (r) => r.method === 'GET' && r.url.endsWith('/v1/pages/page-cache-1'),
      json: pageObj({ id: 'page-cache-1' }),
    },
  );
  await adapter.publishPage(PUBLISH_INPUT_BASE);
  const queryCountAfter = captured.filter((r) => r.url.includes(`/databases/${DATABASE_ID}/query`)).length;
  check('cached title-lookup skips repeat database query', queryCountAfter === queryCountBefore);
}

async function testHtmlToBlocksConversion(): Promise<void> {
  const html = [
    '<h1>Heading One</h1>',
    '<h2>Heading Two</h2>',
    '<h3>Heading Three</h3>',
    '<p>A paragraph with <strong>bold</strong>, <em>italic</em>, <code>inline code</code>, and a <a href="https://example.com">link</a>.</p>',
    '<ul><li>bullet one</li><li>bullet two</li></ul>',
    '<ol><li>numbered one</li><li>numbered two</li></ol>',
    '<pre><code>line1\nline2</code></pre>',
    '<hr/>',
  ].join('');

  const blocks = htmlToBlocks(html) as { type: string; [k: string]: unknown }[];

  // Map block types in order for sanity checking.
  const types = blocks.map((b) => b.type);
  const expectedHeadings = ['heading_1', 'heading_2', 'heading_3'];
  for (const expected of expectedHeadings) {
    check(`htmlToBlocks emits ${expected}`, types.includes(expected));
  }
  check('htmlToBlocks emits paragraph for <p>', types.includes('paragraph'));
  check('htmlToBlocks emits bulleted_list_item', types.filter((t) => t === 'bulleted_list_item').length === 2);
  check('htmlToBlocks emits numbered_list_item', types.filter((t) => t === 'numbered_list_item').length === 2);
  check('htmlToBlocks emits code block for <pre><code>', types.includes('code'));
  check('htmlToBlocks emits divider for <hr/>', types.includes('divider'));

  // Inline annotations on the paragraph block.
  const para = blocks.find((b) => b.type === 'paragraph') as
    | { paragraph: { rich_text: { text: { content: string; link?: { url: string } }; annotations?: { bold?: boolean; italic?: boolean; code?: boolean } }[] } }
    | undefined;
  const richText = para?.paragraph?.rich_text ?? [];
  const boldRun = richText.find((rt) => rt.annotations?.bold);
  const italicRun = richText.find((rt) => rt.annotations?.italic);
  const codeRun = richText.find((rt) => rt.annotations?.code);
  const linkRun = richText.find((rt) => rt.text.link?.url === 'https://example.com');
  check('inline <strong> -> bold annotation', boldRun?.text?.content === 'bold');
  check('inline <em> -> italic annotation', italicRun?.text?.content === 'italic');
  check('inline <code> -> code annotation', codeRun?.text?.content === 'inline code');
  check('inline <a href> -> link annotation', linkRun !== undefined && linkRun.text.content === 'link');

  // Code block content with newlines preserved.
  const codeBlk = blocks.find((b) => b.type === 'code') as
    | { code: { rich_text: { text: { content: string } }[]; language: string } }
    | undefined;
  check('code block content preserved (line1)', codeBlk?.code?.rich_text?.[0]?.text?.content?.includes('line1') === true);
  check('code block content preserved (line2)', codeBlk?.code?.rich_text?.[0]?.text?.content?.includes('line2') === true);
  check('code block language is "plain text"', codeBlk?.code?.language === 'plain text');
}

async function testNotionVersionHeaderEveryRequest(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith(`/v1/databases/${DATABASE_ID}/query`),
      json: { results: [], has_more: false, next_cursor: null },
    },
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/v1/pages'),
      json: pageObj({ id: 'page-1' }),
    },
  );
  await adapter.publishPage(PUBLISH_INPUT_BASE);

  check('captured at least 2 requests', captured.length >= 2);
  for (const req of captured) {
    const v = req.headers['Notion-Version'] ?? '';
    if (v !== NOTION_VERSION) {
      check(`Notion-Version header on ${req.method} ${req.url}`, false, `got "${v}"`);
      return;
    }
  }
  check('every request carried Notion-Version: 2022-06-28', true);
}

async function testCustomNotionVersionHeader(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter({ notionVersion: '2025-01-01' });
  responses.push(
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith(`/v1/databases/${DATABASE_ID}/query`),
      json: { results: [], has_more: false, next_cursor: null },
    },
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/v1/pages'),
      json: pageObj({ id: 'page-1' }),
    },
  );
  await adapter.publishPage(PUBLISH_INPUT_BASE);
  const customVersionUsed = captured.every((r) => r.headers['Notion-Version'] === '2025-01-01');
  check('overridden notionVersion propagates to all requests', customVersionUsed);
}

async function testMissingDatabaseIdThrows(): Promise<void> {
  const { adapter } = makeAdapter(); // no defaultDatabaseId
  let thrown: unknown = null;
  try {
    await adapter.publishPage({ ...PUBLISH_INPUT_BASE, externalSpaceId: '' });
  } catch (err) {
    thrown = err;
  }
  check('missing-databaseId throws', thrown instanceof Error);
  const message = String((thrown as Error).message ?? '');
  check('error names the databaseId requirement', message.includes('databaseId required'));
}

async function testDatabaseIdFallbackToDefault(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter({ defaultDatabaseId: 'fallback-database-id' });
  responses.push(
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/v1/databases/fallback-database-id/query'),
      json: { results: [], has_more: false, next_cursor: null },
    },
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/v1/pages'),
      json: pageObj({ id: 'page-1' }),
    },
  );
  await adapter.publishPage({ ...PUBLISH_INPUT_BASE, externalSpaceId: '' });

  const query = captured.find((r) => r.url.includes('/v1/databases/fallback-database-id/query'));
  check('query targets defaultDatabaseId when externalSpaceId empty', query !== undefined);
  const create = captured.find((r) => r.method === 'POST' && r.url.endsWith('/v1/pages'));
  const createBody = create?.body as { parent: { database_id: string } };
  check('create body uses defaultDatabaseId as parent', createBody?.parent?.database_id === 'fallback-database-id');
}

async function testAuthorizationHeaderShape(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith(`/v1/databases/${DATABASE_ID}/query`),
      json: { results: [], has_more: false, next_cursor: null },
    },
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/v1/pages'),
      json: pageObj({ id: 'p1' }),
    },
  );
  await adapter.publishPage(PUBLISH_INPUT_BASE);
  const auth = captured[0]?.headers['Authorization'] ?? '';
  check('Authorization header uses Bearer scheme', auth === `Bearer ${API_TOKEN}`);
}

async function test401RedactsCredentials(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({
    matcher: () => true,
    status: 401,
    json: { object: 'error', status: 401, code: 'unauthorized', message: `bad token: ${API_TOKEN}` },
  });

  let thrown: unknown = null;
  try {
    await adapter.publishPage(PUBLISH_INPUT_BASE);
  } catch (err) {
    thrown = err;
  }
  check('401 throws NotionApiError', thrown instanceof NotionApiError);
  check('401 carries 401 status', (thrown as NotionApiError).status === 401);
  const message = String((thrown as Error).message ?? '');
  check('error message does NOT contain api token', !message.includes(API_TOKEN));
  check('error message uses generic phrasing on auth failure', message.includes('authentication failed'));
}

async function test400ParsesNotionErrorShape(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({
    matcher: () => true,
    status: 400,
    json: {
      object: 'error',
      status: 400,
      code: 'validation_error',
      message: 'body.children[0].type should be a Notion block type.',
    },
  });

  let thrown: unknown = null;
  try {
    await adapter.publishPage(PUBLISH_INPUT_BASE);
  } catch (err) {
    thrown = err;
  }
  check('400 throws NotionApiError', thrown instanceof NotionApiError);
  const message = String((thrown as Error).message ?? '');
  check('error message includes Notion error code', message.includes('validation_error'));
  check('error message includes Notion error message', message.includes('Notion block type'));
  check('error message does NOT contain api token', !message.includes(API_TOKEN));
}

async function test500RedactsTokenInBody(): Promise<void> {
  const { adapter, responses } = makeAdapter();
  responses.push({
    matcher: () => true,
    status: 500,
    body: `internal error processing token=${API_TOKEN} for database`,
  });
  let thrown: unknown = null;
  try {
    await adapter.publishPage(PUBLISH_INPUT_BASE);
  } catch (err) {
    thrown = err;
  }
  check('500 throws NotionApiError', thrown instanceof NotionApiError);
  const message = String((thrown as Error).message ?? '');
  check('500 message does NOT contain api token', !message.includes(API_TOKEN));
  check('500 message contains *** redaction marker', message.includes('***'));
}

async function testSkipsArchivedSearchHits(): Promise<void> {
  const { adapter, responses, captured } = makeAdapter();
  responses.push(
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith(`/v1/databases/${DATABASE_ID}/query`),
      json: {
        results: [
          pageObj({ id: 'page-archived', archived: true }),
        ],
        has_more: false,
        next_cursor: null,
      },
    },
    {
      matcher: (r) => r.method === 'POST' && r.url.endsWith('/v1/pages'),
      json: pageObj({ id: 'page-fresh' }),
    },
  );
  await adapter.publishPage(PUBLISH_INPUT_BASE);
  // Should have created a fresh page, not patched the archived one.
  const create = captured.find((r) => r.method === 'POST' && r.url.endsWith('/v1/pages'));
  const patch = captured.find((r) => r.method === 'PATCH' && r.url.endsWith('/v1/pages/page-archived'));
  check('archived search hit ignored; fresh page created', create !== undefined);
  check('archived page NOT patched', patch === undefined);
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
    const headers = (init?.headers ?? {}) as Record<string, string>;
    captured.push({ method, url, body, headers });

    if (method === 'POST' && url.endsWith(`/v1/databases/${DATABASE_ID}/query`)) {
      return new Response(JSON.stringify({ results: [], has_more: false, next_cursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'POST' && url.endsWith('/v1/pages')) {
      const b = body as { properties: { Name: { title: { text: { content: string } }[] } } };
      postedTitle = b.properties?.Name?.title?.[0]?.text?.content ?? null;
      return new Response(
        JSON.stringify({
          object: 'page',
          id: 'page-publishdoc-integration',
          url: 'https://www.notion.so/page-publishdoc-integration',
          last_edited_time: '2026-05-04T15:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ object: 'error', status: 500, code: 'no_mock', message: 'no mock' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const adapter = new NotionDocAdapter({
    apiToken: API_TOKEN,
    fetch: fakeFetch,
  });
  registerDocAdapter(adapter);

  const tmpFile = join(tmpdir(), `atelier-notion-smoke-${process.pid}.md`);
  await fs.writeFile(tmpFile, '# Smoke Page\n\nSome body text.\n', 'utf8');
  try {
    const result = await publishDoc({
      docPath: tmpFile,
      adapterName: 'notion',
      space: DATABASE_ID,
      dryRun: false,
    });

    check('publishDoc returned externalUrl', result.externalUrl === 'https://www.notion.so/page-publishdoc-integration');
    check('publishDoc returned externalRevision (last_edited_time)', result.externalRevision === '2026-05-04T15:00:00.000Z');
    check('title derived from first H1 heading', postedTitle === 'Smoke Page');

    const query = captured.find((r) => r.method === 'POST' && r.url.includes('/v1/databases/'));
    check('publishDoc -> adapter -> database query', query !== undefined);
    check('database query targets the resolved databaseId',
      query !== undefined && query.url.endsWith(`/v1/databases/${DATABASE_ID}/query`));
    check('every request carried Notion-Version header',
      captured.every((r) => r.headers['Notion-Version'] === NOTION_VERSION));
  } finally {
    try { await fs.unlink(tmpFile); } catch { /* ignore */ }
  }
}

// =========================================================================
// Run
// =========================================================================

async function main(): Promise<void> {
  console.log('\n[A] adapter unit tests (mocked fetch)');
  console.log('  create new page:');                      await testCreateNewPage();
  console.log('  update existing page (delete-replace):'); await testUpdateExistingPageDeleteThenReplace();
  console.log('  cached title-lookup short-circuits:');   await testTitleSearchWithCachedHit();
  console.log('  HTML -> blocks conversion:');            await testHtmlToBlocksConversion();
  console.log('  Notion-Version header on every req:');   await testNotionVersionHeaderEveryRequest();
  console.log('  custom notionVersion propagates:');      await testCustomNotionVersionHeader();
  console.log('  missing databaseId throws:');            await testMissingDatabaseIdThrows();
  console.log('  databaseId fallback to default:');       await testDatabaseIdFallbackToDefault();
  console.log('  Authorization header uses Bearer:');     await testAuthorizationHeaderShape();
  console.log('  401 redacts credentials:');              await test401RedactsCredentials();
  console.log('  400 parses Notion error shape:');        await test400ParsesNotionErrorShape();
  console.log('  500 redacts token in body:');            await test500RedactsTokenInBody();
  console.log('  archived search hits skipped:');         await testSkipsArchivedSearchHits();

  console.log('\n[B] integration with publish-docs.publishDoc()');
  await testPublishDocIntegration();

  console.log('\n=========================================');
  if (failures === 0) console.log('ALL NOTION ADAPTER CHECKS PASSED');
  else console.log(`${failures} NOTION ADAPTER CHECK(S) FAILED`);
  console.log('=========================================');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('NOTION SMOKE CRASHED:', err);
  process.exit(2);
});
