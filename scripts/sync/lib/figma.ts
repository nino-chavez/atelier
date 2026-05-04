// Figma comment-source adapter.
//
// Implements the CommentSourceAdapter interface from `./adapters.ts` against
// the Figma REST API. Used by triage to ingest design comments left on
// Figma frames so they flow through the same classifier -> drafter ->
// triage_pending pipeline as comments from GitHub / Jira / Linear.
//
// Per ADR-019, Figma is a feedback surface, not the design source-of-truth.
// This adapter is intentionally read-only -- it pulls comments out of Figma
// for triage and never writes back. There is no Figma-equivalent of
// `publish-docs`; design components live in the prototype.
//
// Surface: REST against `https://api.figma.com/v1/`. Figma is a single
// global API (no tenant subdomain).
//
// Auth: `X-Figma-Token: <token>` header. NOT `Authorization: Bearer ...`,
// NOT Basic. This is the most common first-time-Figma-API footgun --
// every other adapter in this directory uses Bearer or Basic, and Figma
// silently 403s on a `Authorization: Bearer ...` header. The smoke test
// asserts `X-Figma-Token` is present and Bearer/Basic are absent on every
// captured fetch.
//
// Configuration (env vars; consumed by the adapter-registry factory):
//   ATELIER_FIGMA_API_TOKEN    Personal access token from Figma's Account
//                              settings -> Personal access tokens -> Create
//                              new token. Tokens grant read access to all
//                              files the user can see; there is no scope
//                              granularity at v1.
//   ATELIER_FIGMA_FILE_KEYS    Comma-separated list of Figma `fileKey`s to
//                              poll. The fileKey is the segment in
//                              https://www.figma.com/file/<fileKey>/<name>.
//                              One adapter instance polls multiple files;
//                              each `fetchSince` call fans out across them.
//
// Pull strategy: Figma's `GET /v1/files/{file_key}/comments` does NOT support
// a `since` server-side filter. The adapter fetches ALL comments per file
// each poll and filters client-side by `created_at > since`. For typical
// files (<1000 comments) this is fine; the runbook documents the cost for
// adopters with huge files.
//
// Rate limit: Figma allows 2 requests per second per token. With multiple
// fileKeys configured the adapter serializes requests and sleeps 500ms
// between them. A single-file poll has zero added latency; an N-file poll
// adds (N-1) * 500ms. For typical N (1-5) this is invisible; for adopters
// with dozens of fileKeys, polling cadence at the operator side dominates.
//
// Resolved comments: skipped by default (`resolved_at != null`). The
// triage pipeline is for unresolved feedback that hasn't been acted on;
// resolved comments would create noise in the queue. The constructor
// exposes an `includeResolved` flag for adopters who want them.
//
// Error shape: Figma returns errors with HTTP status >= 400 and either a
// JSON body of shape `{ status: N, err: 'message' }` or a plain-text body.
// The request helper parses the JSON shape, surfacing the `err` text in
// the thrown error (sans token). 401/403 collapse to a generic
// "authentication failed" message so the token never appears in logs.
//
// Multi-file fault tolerance: a 404 on one fileKey (typo, deleted file,
// permission revoked) does NOT kill the whole poll. The adapter logs a
// warning to stderr and continues with the remaining fileKeys. Other
// errors (5xx, auth, rate limit) propagate.
//
// Testability: the constructor accepts an optional `fetch` impl AND an
// optional `sleep` impl so the smoke test can inject deterministic
// timing without burning real wall-clock seconds.

import type {
  CommentSourceAdapter,
  ExternalComment,
} from './adapters.ts';

export interface FigmaAdapterConfig {
  apiToken: string;
  /** File keys to poll on every `fetchSince` call. Adapter throws on
   *  fetchSince when this is empty -- a configured-but-no-files adapter
   *  is almost certainly an env-var typo. */
  fileKeys: string[];
  /** Include resolved comments. Default false. */
  includeResolved?: boolean;
  /** Base URL override (test-only). Default `https://api.figma.com`. */
  baseUrl?: string;
  /** Optional fetch override for testing. */
  fetch?: typeof fetch;
  /** Optional sleep override for testing. Receives milliseconds, returns a
   *  promise. Default uses setTimeout. The smoke replaces this so multi-file
   *  delay assertions land in <100ms instead of 500ms per gap. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional warning sink for testing. Default console.warn. */
  onWarn?: (message: string) => void;
}

interface FigmaCommentUser {
  id: string;
  handle: string;
}

interface FigmaClientMeta {
  node_id?: string | null;
  node_offset?: { x: number; y: number } | null;
}

interface FigmaComment {
  id: string;
  user: FigmaCommentUser;
  message: string;
  created_at: string;
  resolved_at: string | null;
  parent_id: string | null;
  client_meta: FigmaClientMeta | null;
  // The API echoes file_key on each comment when present. We also know the
  // fileKey from the request URL, so the adapter prefers the request-URL
  // value to avoid trusting the response body.
  file_key?: string;
}

interface FigmaCommentsResponse {
  comments: FigmaComment[];
}

interface FigmaErrorBody {
  status: number;
  err: string;
}

const DEFAULT_BASE_URL = 'https://api.figma.com';
const DEFAULT_INTER_REQUEST_DELAY_MS = 500;

export class FigmaCommentSourceAdapter implements CommentSourceAdapter {
  readonly name = 'figma';
  private readonly apiToken: string;
  private readonly fileKeys: readonly string[];
  private readonly includeResolved: boolean;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onWarn: (message: string) => void;

  constructor(config: FigmaAdapterConfig) {
    this.apiToken = config.apiToken;
    this.fileKeys = [...config.fileKeys];
    this.includeResolved = config.includeResolved ?? false;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.sleep = config.sleep ?? defaultSleep;
    this.onWarn = config.onWarn ?? ((m) => console.warn(m));
  }

  async fetchSince(since: Date): Promise<ExternalComment[]> {
    if (this.fileKeys.length === 0) {
      throw new Error('figma: fileKeys is empty (configure ATELIER_FIGMA_FILE_KEYS)');
    }

    const all: ExternalComment[] = [];
    for (let i = 0; i < this.fileKeys.length; i += 1) {
      const fileKey = this.fileKeys[i]!;
      if (i > 0) {
        // Serialize requests at 2 req/sec per token. Single-file poll is
        // unaffected; multi-file polls pay (N-1) * 500ms.
        await this.sleep(DEFAULT_INTER_REQUEST_DELAY_MS);
      }

      let response: FigmaCommentsResponse | null;
      try {
        response = await this.fetchFileComments(fileKey);
      } catch (err) {
        if (err instanceof FigmaApiError && err.status === 404) {
          this.onWarn(
            `figma: fileKey "${fileKey}" returned 404 (deleted, typo, or permission revoked); skipping`,
          );
          continue;
        }
        throw err;
      }
      if (!response) continue;

      for (const c of response.comments) {
        // Created-since filter is client-side because the API has no
        // server-side `since` parameter.
        const created = Date.parse(c.created_at);
        if (Number.isNaN(created) || created <= since.getTime()) continue;
        if (!this.includeResolved && c.resolved_at !== null) continue;
        all.push(toExternalComment(c, fileKey));
      }
    }

    // Stable ordering for downstream processing + smoke determinism.
    all.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    return all;
  }

  // ---------- HTTP ----------

  private async fetchFileComments(fileKey: string): Promise<FigmaCommentsResponse | null> {
    const path = `/v1/files/${encodeURIComponent(fileKey)}/comments?as_md=true`;
    return this.request<FigmaCommentsResponse>(path, { method: 'GET' });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T | null> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'X-Figma-Token': this.apiToken,
      'Accept': 'application/json',
      'User-Agent': 'atelier-comment-adapter',
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await this.fetchImpl(url, { ...init, headers });
    if (!res.ok) {
      let detail: string;
      if (res.status === 401 || res.status === 403) {
        detail = 'authentication failed';
      } else {
        const text = await res.text().catch(() => '');
        const parsed = parseFigmaError(text);
        if (parsed) {
          detail = redactToken(parsed.err, this.apiToken);
        } else {
          detail = redactToken(text, this.apiToken);
        }
      }
      throw new FigmaApiError(
        res.status,
        `Figma ${init.method ?? 'GET'} ${path} failed: ${res.status} ${detail}`,
      );
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return null;
    return (await res.json()) as T;
  }
}

class FigmaApiError extends Error {
  override readonly name = 'FigmaApiError';
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function parseFigmaError(text: string): FigmaErrorBody | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && typeof parsed.err === 'string') {
      return { status: typeof parsed.status === 'number' ? parsed.status : 0, err: parsed.err };
    }
  } catch { /* fallthrough */ }
  return null;
}

function redactToken(text: string, token: string): string {
  if (!token || !text.includes(token)) return text;
  return text.split(token).join('***');
}

function toExternalComment(c: FigmaComment, fileKey: string): ExternalComment {
  const nodeId = c.client_meta?.node_id ?? null;
  const figmaUrl = nodeId
    ? `https://www.figma.com/file/${fileKey}?node-id=${encodeURIComponent(nodeId)}#${encodeURIComponent(c.id)}`
    : `https://www.figma.com/file/${fileKey}#${encodeURIComponent(c.id)}`;

  return {
    source: 'figma',
    externalCommentId: c.id,
    externalAuthor: c.user.handle,
    text: c.message,
    context: {
      fileKey,
      nodeId,
      parentCommentId: c.parent_id ?? null,
      figmaUrl,
      resolved: c.resolved_at !== null,
    },
    receivedAt: c.created_at,
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { FigmaApiError };
