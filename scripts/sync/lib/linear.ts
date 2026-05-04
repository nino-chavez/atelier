// Linear delivery adapter.
//
// Implements the DeliveryAdapter interface from `./adapters.ts` against
// Linear's GraphQL API. Used by publish-delivery to upsert issues
// reflecting contribution state and by mirror-delivery to pull current
// external state.
//
// Surface: Linear is GraphQL-only. A single endpoint
// (POST https://api.linear.app/graphql) handles every operation through
// mutations and queries. There are no per-resource REST paths and no
// transitions API (Linear sets state directly via stateId).
//
// Scoping: Linear scopes issues to a Team, not a Project. Linear's
// "Project" concept is a separate cross-team grouping that this adapter
// surfaces back through `pullIssue` as the `sprint` field (its closest
// equivalent to Jira sprints; called out in the runbook as approximate).
// The constructor takes a `teamId`, not a "project key".
//
// Auth: Authorization: <apiKey>. *No Bearer prefix* for Linear personal
// API keys -- this is a frequent footgun for adopters used to Bearer
// schemes (GitHub, OAuth). Linear personal keys are sent verbatim as
// the Authorization header value.
//
// Configuration (env vars; consumed by the adapter-registry factory):
//   ATELIER_LINEAR_API_KEY   Personal API key from Linear Settings -> API
//   ATELIER_LINEAR_TEAM_ID   Team UUID. Find via:
//       query { teams { nodes { id name key } } }
//
// State + label resolution: workflow states and labels are project-bound
// entities, not free-form values. The adapter caches name->id maps for
// both at first use (one query each per adapter instance), then resolves
// Atelier states + labels by name. If a state name does not match, the
// adapter logs a warning and omits stateId in the mutation (Linear keeps
// the existing state). If a label name does not match, the adapter logs
// a warning and omits the label.
//
// Auto-creating labels is intentionally NOT done here. Adopters
// pre-create the label set in the Linear UI; the runbook lists the
// exact names to copy-paste.
//
// Branch-list / branch-delete: not applicable. Linear has no
// source-control surface. listManagedBranches and deleteRemoteBranch are
// intentionally not implemented; reconcile.ts already skips reaping
// when an adapter omits these optional methods.
//
// Errors: Linear returns HTTP 200 OK with `{ errors: [...] }` on
// application errors (typical GraphQL behavior). The request helper
// MUST check `body.errors` even on 200 and throw -- relying on `res.ok`
// alone silently swallows real failures.
//
// Testability: the constructor accepts an optional `fetch` impl so the
// smoke test can inject a fake without spinning up an HTTP server.

import type {
  DeliveryAdapter,
  DeliveryUpsertInput,
  DeliveryUpsertResult,
  DeliveryPullResult,
} from './adapters.ts';

export interface LinearAdapterConfig {
  apiKey: string;
  teamId: string;
  /** Optional fetch override for testing. */
  fetch?: typeof fetch;
  /** Base URL override (for self-hosted Linear, test mocks). Default https://api.linear.app/graphql */
  baseUrl?: string;
}

interface LinearIssue {
  id: string;
  identifier: string;
  url: string;
  state: { id: string; name: string } | null;
  assignee: { name: string } | null;
  project: { name: string } | null;
  estimate: number | null;
  updatedAt: string;
}

interface LinearGraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
}

interface IssueCreatePayload {
  issueCreate: { success: boolean; issue: LinearIssue };
}
interface IssueUpdatePayload {
  issueUpdate: { success: boolean; issue: LinearIssue };
}
interface IssueQueryPayload {
  issue: LinearIssue | null;
}
interface WorkflowStatesPayload {
  workflowStates: { nodes: { id: string; name: string }[] };
}
interface IssueLabelsPayload {
  issueLabels: { nodes: { id: string; name: string }[] };
}

const STATE_TO_LINEAR_NAME: Record<DeliveryUpsertInput['state'], string[]> = {
  // Multi-name candidates; first match wins. Adopters with custom
  // workflows can rename a Linear state to match one of these candidates
  // rather than fork the adapter.
  open:        ['Backlog', 'Todo'],
  claimed:     ['Todo', 'Backlog'],
  in_progress: ['In Progress'],
  review:      ['In Review', 'Review'],
  merged:      ['Done', 'Completed'],
  rejected:    ['Cancelled', 'Canceled'],
};

export class LinearDeliveryAdapter implements DeliveryAdapter {
  readonly name = 'linear';
  private readonly apiKey: string;
  private readonly teamId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  // Lazy caches; populated on first upsert. Reset on adapter
  // reconstruction (e.g., test isolation).
  private stateNameToId: Map<string, string> | null = null;
  private labelNameToId: Map<string, string> | null = null;

  constructor(config: LinearAdapterConfig) {
    this.apiKey = config.apiKey;
    this.teamId = config.teamId;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.baseUrl = (config.baseUrl ?? 'https://api.linear.app/graphql').replace(/\/+$/, '');
  }

  async upsertIssue(input: DeliveryUpsertInput): Promise<DeliveryUpsertResult> {
    const stateId = await this.resolveStateId(input.state);
    const labelIds = await this.resolveLabelIds(this.renderLabels(input));
    const title = this.renderTitle(input);
    const description = this.renderBody(input);

    if (input.externalId) {
      const updateInput: Record<string, unknown> = {
        title,
        description,
        labelIds,
      };
      if (stateId) updateInput.stateId = stateId;
      const data = await this.graphql<IssueUpdatePayload>(
        `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
           issueUpdate(id: $id, input: $input) {
             success
             issue { id identifier url state { id name } }
           }
         }`,
        { id: input.externalId, input: updateInput },
      );
      const issue = data.issueUpdate.issue;
      return { externalId: issue.id, externalUrl: issue.url };
    }

    const createInput: Record<string, unknown> = {
      teamId: this.teamId,
      title,
      description,
      labelIds,
    };
    if (stateId) createInput.stateId = stateId;
    const data = await this.graphql<IssueCreatePayload>(
      `mutation IssueCreate($input: IssueCreateInput!) {
         issueCreate(input: $input) {
           success
           issue { id identifier url state { id name } }
         }
       }`,
      { input: createInput },
    );
    const issue = data.issueCreate.issue;
    return { externalId: issue.id, externalUrl: issue.url };
  }

  async pullIssue(externalId: string): Promise<DeliveryPullResult | null> {
    const data = await this.graphql<IssueQueryPayload>(
      `query Issue($id: String!) {
         issue(id: $id) {
           id
           identifier
           url
           state    { name }
           assignee { name }
           project  { name }
           estimate
           updatedAt
         }
       }`,
      { id: externalId },
    );
    const issue = data.issue;
    if (issue === null) return null;
    return {
      externalId: issue.id,
      externalUrl: issue.url,
      externalState: issue.state?.name ?? 'Unknown',
      assignee: issue.assignee?.name ?? null,
      sprint: issue.project?.name ?? null,
      points: typeof issue.estimate === 'number' ? issue.estimate : null,
      observedAt: issue.updatedAt,
    };
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
    return [
      'atelier',
      `atelier/kind:${input.kind}`,
      `atelier/state:${input.state}`,
      ...input.traceIds.map((t) => `atelier/trace:${t}`),
    ];
  }

  private async resolveStateId(state: DeliveryUpsertInput['state']): Promise<string | null> {
    if (!this.stateNameToId) {
      const data = await this.graphql<WorkflowStatesPayload>(
        `query WorkflowStates($teamId: ID!) {
           workflowStates(filter: { team: { id: { eq: $teamId } } }) {
             nodes { id name }
           }
         }`,
        { teamId: this.teamId },
      );
      this.stateNameToId = new Map(
        data.workflowStates.nodes.map((n) => [n.name.toLowerCase(), n.id]),
      );
    }

    const candidates = STATE_TO_LINEAR_NAME[state];
    for (const candidate of candidates) {
      const id = this.stateNameToId.get(candidate.toLowerCase());
      if (id) return id;
    }

    // eslint-disable-next-line no-console
    console.warn(
      `[linear] no workflow state matches Atelier state="${state}"; ` +
      `available: ${[...this.stateNameToId.keys()].join(', ') || '(none)'}. ` +
      `Issue state will not be changed.`,
    );
    return null;
  }

  private async resolveLabelIds(names: string[]): Promise<string[]> {
    if (!this.labelNameToId) {
      const data = await this.graphql<IssueLabelsPayload>(
        `query IssueLabels($teamId: ID!) {
           issueLabels(filter: { team: { id: { eq: $teamId } } }) {
             nodes { id name }
           }
         }`,
        { teamId: this.teamId },
      );
      this.labelNameToId = new Map(
        data.issueLabels.nodes.map((n) => [n.name.toLowerCase(), n.id]),
      );
    }

    const ids: string[] = [];
    const missing: string[] = [];
    for (const name of names) {
      const id = this.labelNameToId.get(name.toLowerCase());
      if (id) ids.push(id);
      else missing.push(name);
    }

    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[linear] ${missing.length} label(s) not found in team and will be omitted: ${missing.join(', ')}. ` +
        `Pre-create them in the Linear UI per docs/user/integrations/linear.md.`,
      );
    }
    return ids;
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl, {
      method: 'POST',
      headers: {
        // Linear personal API keys: NO Bearer prefix.
        'Authorization': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'atelier-delivery-adapter',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      // 401 / 403 / 5xx -- response body may echo headers in dev,
      // never include the API key. Use generic phrasing on auth errors.
      let detail: string;
      if (res.status === 401 || res.status === 403) {
        detail = 'authentication failed';
      } else {
        const text = await res.text().catch(() => '');
        detail = redactApiKey(text, this.apiKey);
      }
      throw new LinearGraphQLError(
        res.status,
        `Linear GraphQL ${res.status}: ${detail}`,
        [],
      );
    }

    const body = (await res.json()) as LinearGraphQLResponse<T>;
    if (body.errors && body.errors.length > 0) {
      const messages = body.errors
        .map((e) => redactApiKey(e.message, this.apiKey))
        .join('; ');
      throw new LinearGraphQLError(200, `Linear GraphQL errors: ${messages}`, body.errors);
    }
    if (!body.data) {
      throw new LinearGraphQLError(200, 'Linear GraphQL returned no data and no errors', []);
    }
    return body.data;
  }
}

class LinearGraphQLError extends Error {
  override readonly name = 'LinearGraphQLError';
  constructor(
    readonly status: number,
    message: string,
    readonly graphqlErrors: { message: string; extensions?: Record<string, unknown> }[],
  ) {
    super(message);
  }
}

function redactApiKey(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.includes(apiKey) ? text.split(apiKey).join('***') : text;
}

export { LinearGraphQLError };
