// Notion doc adapter.
//
// Implements the DocAdapter interface from `./adapters.ts` against the
// Notion REST API. Used by publish-docs to push canonical Atelier docs as
// rows in a Notion database (Notion's analog to Confluence's Space).
//
// Surface: REST against https://api.notion.com/v1/. Notion is global (no
// tenant subdomain); tenancy is encoded in the integration token.
//
// Auth: `Authorization: Bearer <token>` (different from F1/F3's Basic).
// Plus the `Notion-Version: 2022-06-28` header on every request -- the API
// returns 400 without it, even on otherwise-valid requests. This is the
// most common first-time-Notion-API footgun and is asserted in the smoke.
//
// Configuration (env vars; consumed by the adapter-registry factory):
//   ATELIER_NOTION_API_TOKEN     Internal-integration token from Notion
//                                Settings -> Integrations -> New internal
//                                integration. The integration MUST be added
//                                as a connection on the target database via
//                                the database's "..." menu -> "Add connections",
//                                otherwise the API returns 404 even though the
//                                database exists. Frequent first-time footgun;
//                                runbook calls it out.
//   ATELIER_NOTION_DATABASE_ID   Default database id. Found in the database
//                                URL: https://www.notion.so/<workspace>/<DB_ID>?v=...
//                                The 32-char hex segment is the database id;
//                                Notion accepts either dashed (UUID) or
//                                undashed forms.
//
// Upsert strategy: the DocAdapter contract returns { externalUrl, externalRevision }
// but does NOT take an existing externalId on input -- publish-docs.ts is
// one-shot, so the adapter handles upsert internally via the database
// query API:
//   1. POST /v1/databases/{database_id}/query with a title-equals filter
//      against the "Name" property (Notion's default title-property name).
//   2. If found -> archive existing block children + append fresh blocks
//      (delete-then-replace) so the page URL stays stable across publishes.
//      Optimistically last-write-wins; Notion has no version-number-based
//      concurrency control. If two agents publish the same page in parallel,
//      blocks may interleave -- callers serialize on their side.
//   3. If not found -> POST /v1/pages with the database parent + title
//      property + initial children blocks.
//
// Body format: Notion uses block-based content. There is no "set the entire
// body as HTML" endpoint. The adapter renders bodyHtml into a flat array of
// block objects via a minimal HTML->blocks translator that handles:
//   <h1>/<h2>/<h3>     -> heading_1 / heading_2 / heading_3 blocks
//   <p>                -> paragraph block (with rich_text + annotations)
//   <ul><li>           -> bulleted_list_item blocks (flat; no nesting at v1)
//   <ol><li>           -> numbered_list_item blocks
//   <pre><code>        -> code block (language=plain text)
//   <code> (inline)    -> rich_text with code annotation inside paragraph
//   <strong>/<em>      -> rich_text with bold / italic annotation
//   <a href="...">     -> rich_text with link annotation
//   <hr/>              -> divider block
//   plain text         -> paragraph block
// Tables, images, nested lists, and syntax-highlighted code are out of scope
// at v1 and documented as limitations in the runbook. The bannerNote becomes
// the first block (a paragraph) followed by a divider.
//
// Note on input shape vs publish-docs.ts at v1: same caveat as F3 -- when
// publish-docs passes raw markdown into bodyHtml, the renderer treats the
// content as a single paragraph block. The runbook documents this and the
// fix-forward path (markdown->HTML conversion lands in publish-docs.ts).
//
// Error shape: Notion returns errors with HTTP status >=400 AND a JSON body
// of shape `{ object: 'error', status: N, code: '...', message: '...' }`.
// The request helper parses this shape and surfaces code+message in the
// thrown error (sans token). Falls back to raw text if the body is not JSON.
//
// Testability: the constructor accepts an optional `fetch` impl so the smoke
// test can inject a fake without spinning up an HTTP server.

import type {
  DocAdapter,
  DocPublishInput,
  DocPublishResult,
} from './adapters.ts';

export interface NotionAdapterConfig {
  apiToken: string;
  /** Fallback database id when DocPublishInput.externalSpaceId is empty. */
  defaultDatabaseId?: string;
  /** Notion-Version header. Default '2022-06-28' (the long-stable production version). */
  notionVersion?: string;
  /** Base URL override (test-only). Default https://api.notion.com */
  baseUrl?: string;
  /** Optional fetch override for testing. */
  fetch?: typeof fetch;
}

interface NotionPage {
  id: string;
  url: string;
  last_edited_time: string;
  archived?: boolean;
}

interface NotionDatabaseQueryResult {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  archived?: boolean;
}

interface NotionBlockChildrenResult {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
}

interface NotionErrorBody {
  object: 'error';
  status: number;
  code: string;
  message: string;
}

const DEFAULT_NOTION_VERSION = '2022-06-28';
const DEFAULT_BASE_URL = 'https://api.notion.com';
const DEFAULT_TITLE_PROPERTY = 'Name';

export class NotionDocAdapter implements DocAdapter {
  readonly name = 'notion';
  private readonly apiToken: string;
  private readonly defaultDatabaseId: string | undefined;
  private readonly notionVersion: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  // Lazy cache: databaseId -> (title -> pageId). Populated on first hit per
  // database. Reset on adapter reconstruction (e.g., test isolation).
  private readonly pageIdCache = new Map<string, Map<string, string>>();

  constructor(config: NotionAdapterConfig) {
    this.apiToken = config.apiToken;
    this.defaultDatabaseId = config.defaultDatabaseId;
    this.notionVersion = config.notionVersion ?? DEFAULT_NOTION_VERSION;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  async publishPage(input: DocPublishInput): Promise<DocPublishResult> {
    const databaseId = this.resolveDatabaseId(input.externalSpaceId);
    const blocks = this.renderBlocks(input.bannerNote, input.bodyHtml);

    const existingPageId = await this.findPageByTitle(databaseId, input.title);
    let page: NotionPage;
    if (existingPageId) {
      await this.replacePageContent(existingPageId, input.title, blocks);
      // Refresh page record so we surface the latest last_edited_time.
      page = await this.getPage(existingPageId);
    } else {
      page = await this.createPage(databaseId, input.title, blocks);
      // Cache the new id so a same-process second publish updates instead of
      // creating a duplicate (Notion's title filter sees archived/duplicate
      // rows in some race conditions; the explicit cache is the defensive read).
      this.cachePageId(databaseId, input.title, page.id);
    }

    return {
      externalUrl: page.url,
      externalRevision: page.last_edited_time,
    };
  }

  // ---------- Resolution + caching ----------

  private resolveDatabaseId(inputSpaceId: string): string {
    const candidate = inputSpaceId && inputSpaceId.length > 0 ? inputSpaceId : this.defaultDatabaseId;
    if (!candidate) {
      throw new Error(
        'notion: databaseId required (DocPublishInput.externalSpaceId or constructor defaultDatabaseId)',
      );
    }
    return candidate;
  }

  private cachePageId(databaseId: string, title: string, pageId: string): void {
    let inner = this.pageIdCache.get(databaseId);
    if (!inner) {
      inner = new Map();
      this.pageIdCache.set(databaseId, inner);
    }
    inner.set(title, pageId);
  }

  private getCachedPageId(databaseId: string, title: string): string | undefined {
    return this.pageIdCache.get(databaseId)?.get(title);
  }

  private async findPageByTitle(databaseId: string, title: string): Promise<string | null> {
    const cached = this.getCachedPageId(databaseId, title);
    if (cached) return cached;

    const result = await this.request<NotionDatabaseQueryResult>(
      `/v1/databases/${encodeURIComponent(databaseId)}/query`,
      {
        method: 'POST',
        body: JSON.stringify({
          filter: {
            property: DEFAULT_TITLE_PROPERTY,
            title: { equals: title },
          },
          page_size: 1,
        }),
      },
    );
    // Skip archived pages; if all hits are archived, treat as no-match.
    const hit = result.results.find((p) => !p.archived) ?? null;
    if (hit) {
      this.cachePageId(databaseId, title, hit.id);
      return hit.id;
    }
    return null;
  }

  // ---------- Page CRUD ----------

  private async getPage(pageId: string): Promise<NotionPage> {
    return this.request<NotionPage>(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
  }

  private async createPage(databaseId: string, title: string, children: unknown[]): Promise<NotionPage> {
    return this.request<NotionPage>('/v1/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          [DEFAULT_TITLE_PROPERTY]: {
            title: [{ type: 'text', text: { content: title } }],
          },
        },
        children,
      }),
    });
  }

  /** Delete-then-replace: archive every existing top-level child block, then
   *  append the freshly-rendered blocks. Title is updated via PATCH /pages.
   *  This keeps the page URL stable across publishes (option (b) per the
   *  header comment); the alternative archive-and-recreate (option (a))
   *  would change the URL each publish and break external links. */
  private async replacePageContent(pageId: string, title: string, children: unknown[]): Promise<void> {
    // Update title first so a subsequent search-by-title finds the page.
    await this.request<NotionPage>(`/v1/pages/${encodeURIComponent(pageId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          [DEFAULT_TITLE_PROPERTY]: {
            title: [{ type: 'text', text: { content: title } }],
          },
        },
      }),
    });

    // List + archive existing children. Paginate through start_cursor; Notion
    // returns up to 100 blocks per page by default.
    let cursor: string | null = null;
    do {
      const qs = new URLSearchParams();
      if (cursor) qs.set('start_cursor', cursor);
      qs.set('page_size', '100');
      const list: NotionBlockChildrenResult = await this.request<NotionBlockChildrenResult>(
        `/v1/blocks/${encodeURIComponent(pageId)}/children?${qs.toString()}`,
        { method: 'GET' },
      );
      for (const block of list.results) {
        // DELETE archives the block (Notion's "archive" === soft delete).
        await this.request<NotionBlock>(`/v1/blocks/${encodeURIComponent(block.id)}`, {
          method: 'DELETE',
        });
      }
      cursor = list.has_more ? list.next_cursor : null;
    } while (cursor);

    // Append fresh blocks. Notion limits children to 100 per request; chunk
    // accordingly. Most published docs are well under the limit.
    const CHUNK = 100;
    for (let i = 0; i < children.length; i += CHUNK) {
      const chunk = children.slice(i, i + CHUNK);
      await this.request<NotionBlockChildrenResult>(`/v1/blocks/${encodeURIComponent(pageId)}/children`, {
        method: 'PATCH',
        body: JSON.stringify({ children: chunk }),
      });
    }
  }

  // ---------- HTML -> blocks ----------

  private renderBlocks(bannerNote: string, bodyHtml: string): unknown[] {
    const blocks: unknown[] = [];
    blocks.push(paragraphBlock(bannerNote));
    blocks.push(dividerBlock());
    for (const block of htmlToBlocks(bodyHtml)) blocks.push(block);
    return blocks;
  }

  // ---------- HTTP ----------

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiToken}`,
      'Notion-Version': this.notionVersion,
      'Accept': 'application/json',
      'User-Agent': 'atelier-doc-adapter',
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await this.fetchImpl(url, { ...init, headers });
    if (!res.ok) {
      let detail: string;
      if (res.status === 401 || res.status === 403) {
        detail = 'authentication failed';
      } else {
        const text = await res.text().catch(() => '');
        const parsed = parseNotionError(text);
        if (parsed) {
          detail = `${parsed.code}: ${redactToken(parsed.message, this.apiToken)}`;
        } else {
          detail = redactToken(text, this.apiToken);
        }
      }
      throw new NotionApiError(
        res.status,
        `Notion ${init.method ?? 'GET'} ${path} failed: ${res.status} ${detail}`,
      );
    }
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return undefined as T;
    return (await res.json()) as T;
  }
}

class NotionApiError extends Error {
  override readonly name = 'NotionApiError';
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function parseNotionError(text: string): NotionErrorBody | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.object === 'error' && typeof parsed.code === 'string') {
      return parsed as NotionErrorBody;
    }
  } catch { /* fallthrough */ }
  return null;
}

function redactToken(text: string, token: string): string {
  if (!token || !text.includes(token)) return text;
  return text.split(token).join('***');
}

// =========================================================================
// HTML -> Notion blocks
// =========================================================================

interface RichText {
  type: 'text';
  text: { content: string; link?: { url: string } };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
  };
}

function plainText(content: string): RichText {
  return { type: 'text', text: { content } };
}

function paragraphBlock(content: string): unknown {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: content.length > 0 ? [plainText(content)] : [],
    },
  };
}

function dividerBlock(): unknown {
  return { object: 'block', type: 'divider', divider: {} };
}

function headingBlock(level: 1 | 2 | 3, richText: RichText[]): unknown {
  const type = `heading_${level}` as const;
  return {
    object: 'block',
    type,
    [type]: { rich_text: richText },
  };
}

function paragraphBlockRich(richText: RichText[]): unknown {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: richText },
  };
}

function listItemBlock(kind: 'bulleted_list_item' | 'numbered_list_item', richText: RichText[]): unknown {
  return {
    object: 'block',
    type: kind,
    [kind]: { rich_text: richText },
  };
}

function codeBlock(content: string): unknown {
  return {
    object: 'block',
    type: 'code',
    code: {
      rich_text: [plainText(content)],
      language: 'plain text',
    },
  };
}

/** Minimal HTML -> Notion blocks translator. Operates on a small, fixed
 *  subset of tags listed in the file header. Anything outside the subset
 *  becomes plain-text within a paragraph block. */
export function htmlToBlocks(html: string): unknown[] {
  if (!html || html.trim().length === 0) return [];

  const blocks: unknown[] = [];
  // Tag-based scan. Strategy: find block-level openers (h1/h2/h3, p, ul, ol,
  // pre, hr) at the top level; everything else falls through as a paragraph
  // built from the remaining inline content.
  const blockRegex = /<(h1|h2|h3|p|ul|ol|pre|hr|blockquote)\b([^>]*)>([\s\S]*?)(?:<\/\1>|$)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(html)) !== null) {
    // Plain text between the previous block and this one becomes its own
    // paragraph (typical for markdown that bypassed conversion).
    const between = html.slice(lastIndex, match.index).trim();
    if (between.length > 0) {
      blocks.push(paragraphBlockRich(parseInlineToRichText(stripTags(between))));
    }

    const tag = match[1]!.toLowerCase();
    const inner = match[3] ?? '';

    switch (tag) {
      case 'h1':
        blocks.push(headingBlock(1, parseInlineToRichText(inner)));
        break;
      case 'h2':
        blocks.push(headingBlock(2, parseInlineToRichText(inner)));
        break;
      case 'h3':
        blocks.push(headingBlock(3, parseInlineToRichText(inner)));
        break;
      case 'p':
        blocks.push(paragraphBlockRich(parseInlineToRichText(inner)));
        break;
      case 'blockquote':
        blocks.push(paragraphBlockRich(parseInlineToRichText(inner)));
        break;
      case 'ul': {
        const items = extractListItems(inner);
        for (const item of items) {
          blocks.push(listItemBlock('bulleted_list_item', parseInlineToRichText(item)));
        }
        break;
      }
      case 'ol': {
        const items = extractListItems(inner);
        for (const item of items) {
          blocks.push(listItemBlock('numbered_list_item', parseInlineToRichText(item)));
        }
        break;
      }
      case 'pre': {
        // <pre><code>...</code></pre> is the typical shape; strip the inner
        // <code> wrapper if present and decode entities.
        const codeMatch = inner.match(/^\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*$/i);
        const text = decodeEntities(codeMatch ? codeMatch[1]! : stripTags(inner));
        blocks.push(codeBlock(text));
        break;
      }
      case 'hr':
        blocks.push(dividerBlock());
        break;
    }
    lastIndex = blockRegex.lastIndex;
  }

  const trailing = html.slice(lastIndex).trim();
  if (trailing.length > 0) {
    blocks.push(paragraphBlockRich(parseInlineToRichText(stripTags(trailing))));
  }

  // Empty-html or only-whitespace inputs produce zero blocks. Notion accepts
  // an empty children array; the caller's banner + divider are always present
  // ahead of this in renderBlocks.
  return blocks;
}

/** Inline-content -> RichText[] translator. Handles <a>, <strong>/<b>,
 *  <em>/<i>, and <code>. Plain text passes through with HTML entities
 *  decoded. Returns at least one rich-text node for any non-empty input. */
function parseInlineToRichText(html: string): RichText[] {
  if (!html) return [plainText('')];
  const out: RichText[] = [];
  // Walk the string, emitting plain runs and inline-styled runs alternately.
  const inlineRegex = /<(a|strong|b|em|i|code)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(html)) !== null) {
    const before = html.slice(lastIndex, match.index);
    if (before.length > 0) {
      const decoded = decodeEntities(stripTags(before));
      if (decoded.length > 0) out.push(plainText(decoded));
    }
    const tag = match[1]!.toLowerCase();
    const attrs = match[2] ?? '';
    const inner = decodeEntities(stripTags(match[3] ?? ''));
    if (inner.length === 0) {
      // skip empty styled spans
    } else if (tag === 'a') {
      const hrefMatch = attrs.match(/\bhref\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i);
      const href = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2] ?? '') : '';
      out.push({
        type: 'text',
        text: href ? { content: inner, link: { url: href } } : { content: inner },
      });
    } else if (tag === 'strong' || tag === 'b') {
      out.push({ type: 'text', text: { content: inner }, annotations: { bold: true } });
    } else if (tag === 'em' || tag === 'i') {
      out.push({ type: 'text', text: { content: inner }, annotations: { italic: true } });
    } else if (tag === 'code') {
      out.push({ type: 'text', text: { content: inner }, annotations: { code: true } });
    }
    lastIndex = inlineRegex.lastIndex;
  }
  const tail = html.slice(lastIndex);
  if (tail.length > 0) {
    const decoded = decodeEntities(stripTags(tail));
    if (decoded.length > 0) out.push(plainText(decoded));
  }
  if (out.length === 0) out.push(plainText(decodeEntities(stripTags(html))));
  return out;
}

function extractListItems(inner: string): string[] {
  const items: string[] = [];
  const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRegex.exec(inner)) !== null) {
    items.push(m[1]!);
  }
  return items;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export { NotionApiError };
