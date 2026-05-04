// Jira Cloud delivery adapter.
//
// Implements the DeliveryAdapter interface from `./adapters.ts` against
// Jira Cloud's REST API. Used by publish-delivery to upsert issues
// reflecting contribution state and by mirror-delivery to pull current
// external state.
//
// API version choice: v2 for issue create/update bodies. Jira Cloud v3
// requires the Atlassian Document Format (ADF) for the `description`
// field (a JSON tree, not plain text or wiki markup); v2 still accepts
// wiki markup / plain strings, which keeps the adapter body shape close
// to the GitHub adapter without the ADF tax. v3 endpoints are used only
// where a feature is v3-only (none at v1; revisit if a future field
// requires it).
//
// Configuration (env vars; consumed by the adapter-registry factory):
//   ATELIER_JIRA_BASE_URL   Cloud site URL, e.g., https://acme.atlassian.net
//   ATELIER_JIRA_EMAIL      Atlassian account email (Basic-auth username)
//   ATELIER_JIRA_API_TOKEN  API token issued at id.atlassian.com/manage-profile/security/api-tokens
//
// The project key (e.g., "ATL") is supplied through .atelier/config.yaml
// (`integrations.delivery_tracker.project_key`) and threaded through the
// constructor, not the environment.
//
// Branch-list / branch-delete: not applicable. Jira has no source-control
// surface. listManagedBranches and deleteRemoteBranch are intentionally
// not implemented; reconcile.ts already skips reaping when an adapter
// omits these optional methods.
//
// Workflows: Jira issue workflows are project-configurable, so target
// statuses are mapped by name (case-insensitive) against the live
// transitions list. When no transition matches, the adapter logs a
// warning and leaves the issue in its current status.
//
// Testability: the constructor accepts an optional `fetch` impl so the
// smoke test can inject a fake without spinning up an HTTP server.

import type {
  DeliveryAdapter,
  DeliveryUpsertInput,
  DeliveryUpsertResult,
  DeliveryPullResult,
} from './adapters.ts';

export interface JiraAdapterConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  /** Issue type for newly-created issues. Default 'Task'. */
  issueType?: string;
  /** Sprint custom field id. Jira-admin specific; default 'customfield_10020'
   *  (the most common value for Cloud sites that have an active Scrum board). */
  sprintFieldId?: string;
  /** Story Points custom field id. Default 'customfield_10016' (typical Cloud
   *  default for Jira Software). Override when the project uses a different id. */
  pointsFieldId?: string;
  /** Optional fetch override for testing. */
  fetch?: typeof fetch;
}

interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    status: { name: string };
    assignee: { displayName: string } | null;
    updated: string;
    labels: string[];
    [customField: string]: unknown;
  };
}

interface JiraCreateResponse {
  id: string;
  key: string;
  self: string;
}

interface JiraTransition {
  id: string;
  name: string;
  to: { id: string; name: string };
}

interface JiraTransitionsResponse {
  transitions: JiraTransition[];
}

interface JiraSprintField {
  id?: number;
  name?: string;
  state?: string;
}

const STATE_TO_STATUS_NAME: Record<DeliveryUpsertInput['state'], string[]> = {
  // Multi-name candidates per state -- the adapter walks them in order and
  // uses the first transition whose target status matches (case-insensitive).
  // Adopters with custom workflows can rename a status to match one of these
  // candidates rather than fork the adapter.
  open:        ['To Do', 'Open', 'Backlog'],
  claimed:     ['To Do', 'Selected for Development', 'Open'],
  in_progress: ['In Progress'],
  review:      ['In Review', 'Review', 'Code Review'],
  merged:      ['Done', 'Closed', 'Resolved'],
  rejected:    ['Rejected', "Won't Do", 'Closed', 'Done'],
};

export class JiraDeliveryAdapter implements DeliveryAdapter {
  readonly name = 'jira';
  private readonly baseUrl: string;
  private readonly email: string;
  private readonly apiToken: string;
  private readonly projectKey: string;
  private readonly issueType: string;
  private readonly sprintFieldId: string;
  private readonly pointsFieldId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: JiraAdapterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.email = config.email;
    this.apiToken = config.apiToken;
    this.projectKey = config.projectKey;
    this.issueType = config.issueType ?? 'Task';
    this.sprintFieldId = config.sprintFieldId ?? 'customfield_10020';
    this.pointsFieldId = config.pointsFieldId ?? 'customfield_10016';
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  async upsertIssue(input: DeliveryUpsertInput): Promise<DeliveryUpsertResult> {
    const summary  = this.renderTitle(input);
    const description = this.renderBody(input);
    const labels   = this.renderLabels(input);

    let key: string;
    let externalUrl: string;

    if (input.externalId) {
      key = input.externalId;
      // PUT /rest/api/2/issue/{key} updates fields. project + issuetype are
      // immutable on update; only mutable fields go through.
      await this.request<void>(`/rest/api/2/issue/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({
          fields: {
            summary,
            description,
            labels,
          },
        }),
      });
      externalUrl = this.issueBrowseUrl(key);
    } else {
      const created = await this.request<JiraCreateResponse>('/rest/api/2/issue', {
        method: 'POST',
        body: JSON.stringify({
          fields: {
            project:    { key: this.projectKey },
            issuetype:  { name: this.issueType },
            summary,
            description,
            labels,
          },
        }),
      });
      key = created.key;
      externalUrl = this.issueBrowseUrl(key);
    }

    // Apply state transition. Workflows are project-configurable, so we look
    // up available transitions from the issue and pick the first whose target
    // status matches the candidate names for this state.
    await this.transitionToState(key, input.state);

    return { externalId: key, externalUrl };
  }

  async pullIssue(externalId: string): Promise<DeliveryPullResult | null> {
    try {
      // Request the specific custom fields by id so a project that strips
      // unrequested fields still returns sprint + points.
      const fieldsParam = ['summary', 'status', 'assignee', 'updated', 'labels', this.sprintFieldId, this.pointsFieldId].join(',');
      const issue = await this.request<JiraIssue>(
        `/rest/api/2/issue/${encodeURIComponent(externalId)}?fields=${encodeURIComponent(fieldsParam)}`,
        { method: 'GET' },
      );
      return {
        externalId: issue.key,
        externalUrl: this.issueBrowseUrl(issue.key),
        externalState: issue.fields.status?.name ?? 'Unknown',
        assignee: issue.fields.assignee?.displayName ?? null,
        sprint: extractSprint(issue.fields[this.sprintFieldId]),
        points: extractPoints(issue.fields[this.pointsFieldId]),
        observedAt: issue.fields.updated,
      };
    } catch (err) {
      if (isHttpStatus(err, 404)) return null;
      throw err;
    }
  }

  // ---------- Mapping helpers ----------

  private renderTitle(input: DeliveryUpsertInput): string {
    const tracePart = input.traceIds.length > 0 ? `[${input.traceIds.join(', ')}] ` : '';
    return `${tracePart}${input.summary}`.slice(0, 256);
  }

  private renderBody(input: DeliveryUpsertInput): string {
    const lines: string[] = [];
    lines.push('atelier-managed; do not edit this body manually');
    lines.push('');
    lines.push(input.bodyMarkdown);
    lines.push('');
    lines.push('----');
    lines.push(`Atelier contribution: {{${input.contributionId}}}`);
    lines.push(`Project: {{${input.projectId}}}`);
    lines.push(`Kind: {{${input.kind}}} | State: {{${input.state}}}`);
    const traces = input.traceIds.map((t) => `{{${t}}}`).join(', ') || '(none)';
    lines.push(`Trace IDs: ${traces}`);
    return lines.join('\n');
  }

  private renderLabels(input: DeliveryUpsertInput): string[] {
    // Jira labels reject whitespace; the GitHub-mirroring shape already
    // satisfies that constraint (no spaces inside any label).
    return [
      'atelier',
      `atelier/kind:${input.kind}`,
      `atelier/state:${input.state}`,
      ...input.traceIds.map((t) => `atelier/trace:${t}`),
    ];
  }

  private async transitionToState(issueKey: string, state: DeliveryUpsertInput['state']): Promise<void> {
    const candidates = STATE_TO_STATUS_NAME[state].map((s) => s.toLowerCase());
    const list = await this.request<JiraTransitionsResponse>(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`,
      { method: 'GET' },
    );

    let chosen: JiraTransition | undefined;
    for (const candidate of candidates) {
      chosen = list.transitions.find((t) => t.to.name.toLowerCase() === candidate);
      if (chosen) break;
    }

    if (!chosen) {
      // eslint-disable-next-line no-console
      console.warn(
        `[jira] no workflow transition matches state="${state}" for issue ${issueKey}; ` +
        `available targets: ${list.transitions.map((t) => t.to.name).join(', ') || '(none)'}. ` +
        `Issue left in its current status.`,
      );
      return;
    }

    await this.request<void>(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`,
      {
        method: 'POST',
        body: JSON.stringify({ transition: { id: chosen.id } }),
      },
    );
  }

  private issueBrowseUrl(key: string): string {
    return `${this.baseUrl}/browse/${key}`;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
    const headers: Record<string, string> = {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      'User-Agent': 'atelier-delivery-adapter',
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await this.fetchImpl(url, { ...init, headers });
    if (!res.ok) {
      // Never include the Authorization header value or the API token in
      // error messages. 401/403 carry a generic phrase.
      let detail = '';
      if (res.status === 401 || res.status === 403) {
        detail = 'authentication failed';
      } else {
        const text = await res.text().catch(() => '');
        detail = redactCredentials(text, this.apiToken, auth);
      }
      throw new JiraHttpError(
        res.status,
        `Jira ${init.method ?? 'GET'} ${path} failed: ${res.status} ${detail}`,
      );
    }
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return undefined as T;
    return (await res.json()) as T;
  }
}

class JiraHttpError extends Error {
  override readonly name = 'JiraHttpError';
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function isHttpStatus(err: unknown, status: number): boolean {
  return err instanceof JiraHttpError && err.status === status;
}

function redactCredentials(text: string, token: string, basicAuth: string): string {
  let out = text;
  if (token && out.includes(token)) out = out.split(token).join('***');
  if (basicAuth && out.includes(basicAuth)) out = out.split(basicAuth).join('***');
  return out;
}

function extractSprint(raw: unknown): string | null {
  // Jira returns sprint as either an array of objects (Cloud, modern) or
  // an array of GreenHopper-encoded strings (legacy). Handle both shapes.
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const head = raw[0];
  if (typeof head === 'string') {
    const match = head.match(/name=([^,]+)/);
    return match ? match[1]! : null;
  }
  if (head && typeof head === 'object') {
    const obj = head as JiraSprintField;
    return obj.name ?? null;
  }
  return null;
}

function extractPoints(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return null;
}

export { JiraHttpError };
