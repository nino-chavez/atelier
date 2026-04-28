// External-system adapter interfaces + registry.
//
// All five sync scripts (publish-docs, publish-delivery, mirror-delivery,
// reconcile, triage) interact with external systems through these
// interfaces. The registry binds a name (e.g., "github", "linear") to a
// concrete adapter; scripts look up by name based on `.atelier/config.yaml`.
//
// At M1 only the no-op adapter is registered. Step 4.iv lands the GitHub
// adapter (delivery surface = GitHub Issues + PRs) per scripts/README.md
// step 4.iv. Other adapters (Jira, Linear, Confluence, Notion, Figma)
// are out-of-scope for v1 and are tracked in BRD Epic 10.

// =========================================================================
// Delivery adapter (Jira / Linear / GitHub Issues)
// =========================================================================

export interface DeliveryUpsertInput {
  contributionId: string;
  projectId: string;
  kind: 'implementation' | 'research' | 'design';
  state: 'open' | 'claimed' | 'in_progress' | 'review' | 'merged' | 'rejected';
  traceIds: string[];
  summary: string;
  bodyMarkdown: string;
  externalId?: string | null;
  externalUrl?: string | null;
}

export interface DeliveryUpsertResult {
  externalId: string;
  externalUrl: string;
}

export interface DeliveryPullResult {
  externalId: string;
  externalUrl: string;
  externalState: string;
  assignee: string | null;
  sprint: string | null;
  points: number | null;
  observedAt: string;
}

export interface DeliveryAdapter {
  readonly name: string;
  upsertIssue(input: DeliveryUpsertInput): Promise<DeliveryUpsertResult>;
  pullIssue(externalId: string): Promise<DeliveryPullResult | null>;
  /** Best-effort branch list for branch-reaping per BRD-OPEN-QUESTIONS §24.
   *  Returns refs matching `atelier/*` with last-commit ages. Optional --
   *  adapters that can't enumerate refs return null and reaping is skipped. */
  listManagedBranches?(): Promise<ManagedBranch[] | null>;
  deleteRemoteBranch?(ref: string): Promise<void>;
}

export interface ManagedBranch {
  ref: string;
  lastCommitSha: string;
  lastCommitAt: string;
  hasOpenPr: boolean;
}

// =========================================================================
// Doc adapter (Confluence / Notion)
// =========================================================================

export interface DocPublishInput {
  externalSpaceId: string;
  pageKey: string;
  title: string;
  bodyHtml: string;
  bannerNote: string;
}

export interface DocPublishResult {
  externalUrl: string;
  externalRevision: string;
}

export interface DocAdapter {
  readonly name: string;
  publishPage(input: DocPublishInput): Promise<DocPublishResult>;
}

// =========================================================================
// Comment-source adapter (used by triage to ingest external comments)
// =========================================================================

export interface ExternalComment {
  source: 'github' | 'jira' | 'linear' | 'figma' | 'confluence' | 'notion' | 'manual';
  externalCommentId: string;
  externalAuthor: string;
  text: string;
  context: Record<string, unknown>;
  receivedAt: string;
}

export interface CommentSourceAdapter {
  readonly name: string;
  /** Pulls the latest comments since `since`. Triage uses this in polling
   *  mode at M1; M2 endpoint webhooks replace polling. */
  fetchSince(since: Date): Promise<ExternalComment[]>;
}

// =========================================================================
// Registry
// =========================================================================

interface AdapterRegistry {
  delivery: Map<string, DeliveryAdapter>;
  doc:      Map<string, DocAdapter>;
  comments: Map<string, CommentSourceAdapter>;
}

const registry: AdapterRegistry = {
  delivery: new Map(),
  doc:      new Map(),
  comments: new Map(),
};

export function registerDeliveryAdapter(adapter: DeliveryAdapter): void {
  registry.delivery.set(adapter.name, adapter);
}
export function registerDocAdapter(adapter: DocAdapter): void {
  registry.doc.set(adapter.name, adapter);
}
export function registerCommentSourceAdapter(adapter: CommentSourceAdapter): void {
  registry.comments.set(adapter.name, adapter);
}

export function resolveDeliveryAdapter(name: string): DeliveryAdapter {
  const a = registry.delivery.get(name);
  if (!a) throw new Error(`no delivery adapter registered for "${name}" (registered: ${[...registry.delivery.keys()].join(', ') || 'none'})`);
  return a;
}
export function resolveDocAdapter(name: string): DocAdapter {
  const a = registry.doc.get(name);
  if (!a) throw new Error(`no doc adapter registered for "${name}"`);
  return a;
}
export function resolveCommentSourceAdapter(name: string): CommentSourceAdapter {
  const a = registry.comments.get(name);
  if (!a) throw new Error(`no comment-source adapter registered for "${name}"`);
  return a;
}

// =========================================================================
// No-op adapter (M1 default; logs invocations and returns synthetic ids)
// =========================================================================

export interface NoopInvocation {
  surface: 'delivery' | 'doc' | 'comments';
  method: string;
  args: unknown;
  timestamp: string;
}

const noopInvocations: NoopInvocation[] = [];

export function noopInvocationLog(): readonly NoopInvocation[] {
  return noopInvocations;
}
export function clearNoopInvocations(): void {
  noopInvocations.length = 0;
}

function record(surface: NoopInvocation['surface'], method: string, args: unknown): void {
  noopInvocations.push({ surface, method, args, timestamp: new Date().toISOString() });
}

export const noopDeliveryAdapter: DeliveryAdapter = {
  name: 'noop',
  async upsertIssue(input) {
    record('delivery', 'upsertIssue', input);
    const externalId = input.externalId ?? `noop-${input.contributionId.slice(0, 8)}`;
    return {
      externalId,
      externalUrl: input.externalUrl ?? `noop://delivery/${externalId}`,
    };
  },
  async pullIssue(externalId) {
    record('delivery', 'pullIssue', { externalId });
    return null;
  },
  async listManagedBranches() {
    record('delivery', 'listManagedBranches', {});
    return [];
  },
  async deleteRemoteBranch(ref) {
    record('delivery', 'deleteRemoteBranch', { ref });
  },
};

export const noopDocAdapter: DocAdapter = {
  name: 'noop',
  async publishPage(input) {
    record('doc', 'publishPage', input);
    return {
      externalUrl: `noop://doc/${input.pageKey}`,
      externalRevision: `noop-rev-${Date.now()}`,
    };
  },
};

export const noopCommentSourceAdapter: CommentSourceAdapter = {
  name: 'noop',
  async fetchSince(since) {
    record('comments', 'fetchSince', { since: since.toISOString() });
    return [];
  },
};

// Auto-register the no-op adapters so scripts can run without configuration.
registerDeliveryAdapter(noopDeliveryAdapter);
registerDocAdapter(noopDocAdapter);
registerCommentSourceAdapter(noopCommentSourceAdapter);
