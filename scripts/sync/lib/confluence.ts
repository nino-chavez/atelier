// Confluence Cloud doc adapter.
//
// Implements the DocAdapter interface from `./adapters.ts` against Confluence
// Cloud's REST API. Used by publish-docs to push canonical Atelier docs to a
// Confluence space.
//
// Surface: REST against /wiki/rest/api/content. Title-search for upsert,
// POST to create, PUT to update with monotonically incremented version.number.
//
// Auth: Basic <base64(email:apiToken)> -- same shape as the Jira adapter.
// An operator with a Jira Cloud token already has a credential usable here
// (Atlassian Account tokens span Jira + Confluence on the same tenant).
//
// Configuration (env vars; consumed by the adapter-registry factory):
//   ATELIER_CONFLUENCE_BASE_URL   Wiki base, e.g., https://acme.atlassian.net/wiki
//                                 (note the /wiki suffix -- Confluence is a
//                                 separate product surface from Jira).
//   ATELIER_CONFLUENCE_EMAIL      Atlassian account email (Basic-auth username).
//   ATELIER_CONFLUENCE_API_TOKEN  API token from id.atlassian.com.
//   ATELIER_CONFLUENCE_SPACE_KEY  Optional default space key. Used when the
//                                 caller does not pass --space; otherwise the
//                                 explicit DocPublishInput.externalSpaceId wins.
//
// Upsert strategy: the DocAdapter contract returns { externalUrl, externalRevision }
// but does NOT take an existing externalId on input -- publish-docs.ts is
// one-shot, so the adapter handles upsert internally:
//   1. GET /rest/api/content?spaceKey=K&title=T&expand=version  -> existing?
//   2. If found -> PUT /rest/api/content/{id} with version.number = current + 1
//   3. If not found -> POST /rest/api/content
// On 409 (version conflict from a concurrent writer), re-fetch and retry up
// to three total attempts, then surface the conflict.
//
// Body format: input.bodyHtml is forwarded verbatim as Confluence Storage
// Format (a subset of XHTML). Simple HTML elements (p, h1..h6, ul, ol, li,
// a, strong, em, code, pre, blockquote) round-trip into storage format
// without translation. Tables, images, and code blocks with syntax
// highlighting need <ac:structured-macro> wrappers and are out of scope at
// v1 -- see docs/user/integrations/confluence.md for the limitation callout.
//
// Note on input shape vs publish-docs.ts at v1: publish-docs currently passes
// markdown into bodyHtml ("Markdown -> HTML conversion is a v1.x concern"
// per the comment in publish-docs.ts). When that lands, this adapter renders
// correctly without code change. Until then, markdown content surfaces as
// literal text in the published Confluence page; the runbook documents this.
//
// Testability: the constructor accepts an optional `fetch` impl so the smoke
// test can inject a fake without spinning up an HTTP server.

import type {
  DocAdapter,
  DocPublishInput,
  DocPublishResult,
} from './adapters.ts';

export interface ConfluenceAdapterConfig {
  /** Wiki base URL, e.g., https://acme.atlassian.net/wiki. Trailing slash optional. */
  baseUrl: string;
  email: string;
  apiToken: string;
  /** Fallback space key when DocPublishInput.externalSpaceId is empty. */
  defaultSpaceKey?: string;
  /** Optional fetch override for testing. */
  fetch?: typeof fetch;
}

interface ConfluenceContent {
  id: string;
  type: string;
  title: string;
  version: { number: number };
  _links: {
    webui?: string;
    base?: string;
    self?: string;
  };
}

interface ConfluenceContentSearch {
  results: ConfluenceContent[];
  size: number;
}

const MAX_VERSION_RETRY = 3;

export class ConfluenceDocAdapter implements DocAdapter {
  readonly name = 'confluence';
  private readonly baseUrl: string;
  private readonly email: string;
  private readonly apiToken: string;
  private readonly defaultSpaceKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ConfluenceAdapterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.email = config.email;
    this.apiToken = config.apiToken;
    this.defaultSpaceKey = config.defaultSpaceKey;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  async publishPage(input: DocPublishInput): Promise<DocPublishResult> {
    const spaceKey = this.resolveSpaceKey(input.externalSpaceId);
    const storageBody = this.renderStorageBody(input.bannerNote, input.bodyHtml);

    let lastConflict: ConfluenceHttpError | null = null;
    for (let attempt = 1; attempt <= MAX_VERSION_RETRY; attempt++) {
      const existing = await this.findPageByTitle(spaceKey, input.title);
      try {
        const page = existing
          ? await this.updatePage(existing, input.title, storageBody)
          : await this.createPage(spaceKey, input.title, storageBody);
        return {
          externalUrl: this.pageWebUrl(page),
          externalRevision: String(page.version.number),
        };
      } catch (err) {
        if (err instanceof ConfluenceHttpError && err.status === 409) {
          lastConflict = err;
          // Re-fetch existing version on the next loop iteration, then retry.
          continue;
        }
        throw err;
      }
    }
    throw lastConflict ?? new ConfluenceHttpError(
      409,
      `Confluence version conflict after ${MAX_VERSION_RETRY} attempts`,
    );
  }

  // ---------- Mapping helpers ----------

  private resolveSpaceKey(inputSpaceId: string): string {
    const candidate = inputSpaceId && inputSpaceId.length > 0 ? inputSpaceId : this.defaultSpaceKey;
    if (!candidate) {
      throw new Error(
        'confluence: spaceKey required (DocPublishInput.externalSpaceId or constructor defaultSpaceKey)',
      );
    }
    return candidate;
  }

  private renderStorageBody(bannerNote: string, bodyHtml: string): string {
    // Banner first as a paragraph + horizontal rule, then bodyHtml verbatim.
    // The bannerNote is XML-escaped so any reserved chars survive into
    // storage format; bodyHtml is forwarded as-is per the adapter contract
    // (caller is responsible for storage-format-compatible HTML).
    const escapedBanner = escapeXml(bannerNote);
    return `<p>${escapedBanner}</p><hr/>${bodyHtml}`;
  }

  private async findPageByTitle(spaceKey: string, title: string): Promise<ConfluenceContent | null> {
    const qs = new URLSearchParams();
    qs.set('spaceKey', spaceKey);
    qs.set('title', title);
    qs.set('expand', 'version');
    qs.set('limit', '1');
    const search = await this.request<ConfluenceContentSearch>(
      `/rest/api/content?${qs.toString()}`,
      { method: 'GET' },
    );
    return search.results[0] ?? null;
  }

  private async createPage(spaceKey: string, title: string, storageBody: string): Promise<ConfluenceContent> {
    return this.request<ConfluenceContent>('/rest/api/content', {
      method: 'POST',
      body: JSON.stringify({
        type: 'page',
        title,
        space: { key: spaceKey },
        body: {
          storage: {
            value: storageBody,
            representation: 'storage',
          },
        },
      }),
    });
  }

  private async updatePage(
    existing: ConfluenceContent,
    title: string,
    storageBody: string,
  ): Promise<ConfluenceContent> {
    const nextVersion = existing.version.number + 1;
    return this.request<ConfluenceContent>(`/rest/api/content/${encodeURIComponent(existing.id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        id: existing.id,
        type: 'page',
        title,
        version: { number: nextVersion },
        body: {
          storage: {
            value: storageBody,
            representation: 'storage',
          },
        },
      }),
    });
  }

  private pageWebUrl(page: ConfluenceContent): string {
    const webui = page._links.webui ?? '';
    const linkBase = page._links.base ?? this.baseUrl;
    return `${linkBase}${webui}`;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
    const headers: Record<string, string> = {
      'Authorization': `Basic ${auth}`,
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
        detail = redactCredentials(text, this.apiToken, auth);
      }
      throw new ConfluenceHttpError(
        res.status,
        `Confluence ${init.method ?? 'GET'} ${path} failed: ${res.status} ${detail}`,
      );
    }
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return undefined as T;
    return (await res.json()) as T;
  }
}

class ConfluenceHttpError extends Error {
  override readonly name = 'ConfluenceHttpError';
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function redactCredentials(text: string, token: string, basicAuth: string): string {
  let out = text;
  if (token && out.includes(token)) out = out.split(token).join('***');
  if (basicAuth && out.includes(basicAuth)) out = out.split(basicAuth).join('***');
  return out;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export { ConfluenceHttpError };
