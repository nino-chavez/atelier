// GitHub delivery adapter.
//
// Implements the DeliveryAdapter interface from `./adapters.ts` against
// GitHub Issues + branch APIs. Used by publish-delivery to upsert issues
// reflecting contribution state, by mirror-delivery to pull current
// external state, and by reconcile to enumerate + delete stale
// `atelier/*` branches.
//
// Configuration (env vars at M1; .atelier/config.yaml at M2):
//   ATELIER_GITHUB_TOKEN  Personal access token / GH App token (issues:rw, contents:rw)
//   ATELIER_GITHUB_OWNER  Repo owner (user or org)
//   ATELIER_GITHUB_REPO   Repo name
//
// Testability: the constructor accepts an optional `fetch` impl so the
// smoke test can inject a fake without spinning up an HTTP server.

import type {
  DeliveryAdapter,
  DeliveryUpsertInput,
  DeliveryUpsertResult,
  DeliveryPullResult,
  ManagedBranch,
} from './adapters.ts';

export interface GitHubAdapterConfig {
  token: string;
  owner: string;
  repo: string;
  /** Branch prefix to manage. Default 'atelier/'. */
  branchPrefix?: string;
  /** Optional fetch override for testing. */
  fetch?: typeof fetch;
  /** Base URL override (for GitHub Enterprise or test mocks). Default https://api.github.com */
  baseUrl?: string;
}

interface GitHubIssue {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  state_reason: 'completed' | 'not_planned' | 'reopened' | null;
  title: string;
  body: string | null;
  labels: { name: string }[];
  assignee: { login: string } | null;
  milestone: { title: string } | null;
  updated_at: string;
}

interface GitHubRef {
  ref: string;          // e.g., refs/heads/atelier/<contribution-id>
  object: { sha: string; type: string };
}

interface GitHubCommit {
  sha: string;
  committer: { date: string } | null;
  commit: { committer: { date: string } | null };
}

interface GitHubPull {
  number: number;
  state: 'open' | 'closed';
  head: { ref: string };
}

export class GitHubDeliveryAdapter implements DeliveryAdapter {
  readonly name = 'github';
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly branchPrefix: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(config: GitHubAdapterConfig) {
    this.token = config.token;
    this.owner = config.owner;
    this.repo = config.repo;
    this.branchPrefix = config.branchPrefix ?? 'atelier/';
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.baseUrl = (config.baseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  }

  async upsertIssue(input: DeliveryUpsertInput): Promise<DeliveryUpsertResult> {
    const body = this.renderBody(input);
    const labels = this.renderLabels(input);
    const ghState = this.mapState(input.state);

    if (input.externalId) {
      const issueNumber = Number(input.externalId);
      const updated = await this.request<GitHubIssue>(`/repos/${this.owner}/${this.repo}/issues/${issueNumber}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: this.renderTitle(input),
          body,
          state: ghState.state,
          state_reason: ghState.stateReason,
          labels: labels,
        }),
      });
      return {
        externalId: String(updated.number),
        externalUrl: updated.html_url,
      };
    }

    const created = await this.request<GitHubIssue>(`/repos/${this.owner}/${this.repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title: this.renderTitle(input),
        body,
        labels,
      }),
    });

    // If the contribution is already past 'open', close immediately so the
    // issue reflects current state. GitHub's create endpoint doesn't accept
    // state on creation; PATCH after.
    if (ghState.state === 'closed') {
      const closed = await this.request<GitHubIssue>(
        `/repos/${this.owner}/${this.repo}/issues/${created.number}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ state: 'closed', state_reason: ghState.stateReason }),
        },
      );
      return { externalId: String(closed.number), externalUrl: closed.html_url };
    }

    return { externalId: String(created.number), externalUrl: created.html_url };
  }

  async pullIssue(externalId: string): Promise<DeliveryPullResult | null> {
    const issueNumber = Number(externalId);
    if (!Number.isInteger(issueNumber)) return null;
    try {
      const issue = await this.request<GitHubIssue>(
        `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`,
        { method: 'GET' },
      );
      return {
        externalId: String(issue.number),
        externalUrl: issue.html_url,
        externalState: issue.state_reason ? `${issue.state}:${issue.state_reason}` : issue.state,
        assignee: issue.assignee?.login ?? null,
        sprint: issue.milestone?.title ?? null,
        points: extractPoints(issue.labels),
        observedAt: issue.updated_at,
      };
    } catch (err) {
      if (isHttpStatus(err, 404)) return null;
      throw err;
    }
  }

  async listManagedBranches(): Promise<ManagedBranch[]> {
    // GitHub's `/git/matching-refs/heads/<prefix>` returns refs with prefix.
    const refs = await this.request<GitHubRef[]>(
      `/repos/${this.owner}/${this.repo}/git/matching-refs/heads/${encodeURIComponent(this.branchPrefix)}`,
      { method: 'GET' },
    );

    // Open-PR enumeration: one call returns every open PR; build a set
    // keyed on head.ref so per-branch lookup is O(1) instead of N.
    const openPrs = await this.request<GitHubPull[]>(
      `/repos/${this.owner}/${this.repo}/pulls?state=open&per_page=100`,
      { method: 'GET' },
    );
    const openPrRefs = new Set(openPrs.map((p) => p.head.ref));

    const out: ManagedBranch[] = [];
    for (const r of refs) {
      const branch = r.ref.replace(/^refs\/heads\//, '');
      // Per-branch commit fetch -- N+1 in the worst case. For AI-speed
      // bounded scale (hundreds of branches/week) this is acceptable; if
      // it ever becomes a hot path, switch to GraphQL with a paged batch.
      const commit = await this.request<GitHubCommit>(
        `/repos/${this.owner}/${this.repo}/git/commits/${r.object.sha}`,
        { method: 'GET' },
      );
      const lastCommitAt =
        commit.commit?.committer?.date ?? commit.committer?.date ?? new Date(0).toISOString();
      out.push({
        ref: branch,
        lastCommitSha: r.object.sha,
        lastCommitAt,
        hasOpenPr: openPrRefs.has(branch),
      });
    }
    return out;
  }

  async deleteRemoteBranch(ref: string): Promise<void> {
    await this.request<void>(
      `/repos/${this.owner}/${this.repo}/git/refs/heads/${encodeURIComponent(ref).replace(/%2F/g, '/')}`,
      { method: 'DELETE' },
    );
  }

  // ---------- Mapping helpers ----------

  private renderTitle(input: DeliveryUpsertInput): string {
    const tracePart = input.traceIds.length > 0 ? `[${input.traceIds.join(', ')}] ` : '';
    return `${tracePart}${input.summary}`.slice(0, 256);
  }

  private renderBody(input: DeliveryUpsertInput): string {
    const lines: string[] = [];
    lines.push('<!-- atelier-managed; do not edit this body manually -->');
    lines.push('');
    lines.push(input.bodyMarkdown);
    lines.push('');
    lines.push('---');
    lines.push(`Atelier contribution: \`${input.contributionId}\``);
    lines.push(`Project: \`${input.projectId}\``);
    lines.push(`Kind: \`${input.kind}\` | State: \`${input.state}\``);
    lines.push(`Trace IDs: ${input.traceIds.map((t) => `\`${t}\``).join(', ') || '(none)'}`);
    return lines.join('\n');
  }

  private renderLabels(input: DeliveryUpsertInput): string[] {
    const labels = [
      'atelier',
      `atelier/kind:${input.kind}`,
      `atelier/state:${input.state}`,
      ...input.traceIds.map((t) => `atelier/trace:${t}`),
    ];
    return labels;
  }

  private mapState(state: DeliveryUpsertInput['state']): {
    state: 'open' | 'closed';
    stateReason: 'completed' | 'not_planned' | null;
  } {
    switch (state) {
      case 'merged':
        return { state: 'closed', stateReason: 'completed' };
      case 'rejected':
        return { state: 'closed', stateReason: 'not_planned' };
      default:
        return { state: 'open', stateReason: null };
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'atelier-delivery-adapter',
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await this.fetchImpl(url, { ...init, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new GitHubHttpError(res.status, `GitHub ${init.method ?? 'GET'} ${path} failed: ${res.status} ${text}`);
      throw err;
    }
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return undefined as T;
    return (await res.json()) as T;
  }
}

class GitHubHttpError extends Error {
  override readonly name = 'GitHubHttpError';
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function isHttpStatus(err: unknown, status: number): boolean {
  return err instanceof GitHubHttpError && err.status === status;
}

function extractPoints(labels: { name: string }[]): number | null {
  for (const l of labels) {
    const m = l.name.match(/^points:(\d+)$/);
    if (m && m[1]) return Number(m[1]);
  }
  return null;
}

export { GitHubHttpError };
