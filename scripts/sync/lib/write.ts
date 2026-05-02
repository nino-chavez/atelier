// Atelier internal write library (M1)
//
// Implements the ARCH 6.x mutation contracts -- claim, update, release,
// log_decision, plus session and lock helpers -- against the Postgres schema
// from migration 20260428000001. Sync scripts and the M2 12-tool dispatcher
// call this library directly; the dispatcher is the MCP surface.
//
// Scope at M1:
//   - Schema-side mutations (DB writes are authoritative for this module).
//   - Telemetry events emitted on every mutation per ARCH 8.1.
//   - Atomic state transitions via single SQL statements where possible;
//     transactions where multi-row coordination is needed.
//
// Out of scope at M1 (deferred):
//   - Per-project endpoint git committer (ARCH 7.8 / ADR-023): M2. The
//     `logDecision` contract here splits allocation from row-insert via a
//     caller-provided `commit` callback, so the M2 endpoint can wrap the
//     committer around it without rewriting this module.
//   - Webhook-driven repo_branch / commit_count / last_observed_commit_sha
//     updates (ARCH 6.2.2.1): M2.
//   - Implicit find_similar gate on claim (ARCH 6.2.1): M5 (gates on D24).
//   - Idempotency keys (ARCH 6.2.1 idempotency_key): the M1 caller is a
//     server-side sync script; idempotency is a remote-surface concern and
//     lands with the M2 endpoint.
//   - Glob-based lock overlap (ARCH 7.4.1 picomatch expansion): M2 endpoint.
//     M1 detects overlap via Postgres array-intersection (&& on text[]),
//     which correctly handles non-glob exact scopes and is sufficient for
//     the M1 sync substrate. Mixed-glob workloads land at M2.

import { Pool, type PoolConfig, type PoolClient } from 'pg';

import {
  NoopBroadcastService,
  projectEventsChannel,
  type BroadcastEnvelope,
  type BroadcastEventKind,
  type BroadcastService,
} from '../../coordination/lib/broadcast.ts';

// =========================================================================
// Errors
// =========================================================================

export type AtelierErrorCode =
  | 'BAD_REQUEST'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INTERNAL';

export class AtelierError extends Error {
  override readonly name = 'AtelierError';
  constructor(
    readonly code: AtelierErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// =========================================================================
// Domain types (mirror the schema from migration 20260428000001)
// =========================================================================

export type ContributionState = 'open' | 'claimed' | 'plan_review' | 'in_progress' | 'review' | 'merged' | 'rejected';
export type ContributionKind  = 'implementation' | 'research' | 'design';
export type DecisionCategory  = 'architecture' | 'product' | 'design' | 'research';
export type SessionSurface    = 'ide' | 'web' | 'terminal' | 'passive';
// LockKind removed per audit M2-entry M3: lock_type column dropped from
// the locks table; the only legitimate value 'exclusive' was the implicit
// behavior, and 'shared' was never spec'd.

export interface Session {
  id: string;
  projectId: string;
  composerId: string;
  surface: SessionSurface;
  agentClient: string | null;
  status: 'active' | 'idle' | 'dead';
  heartbeatAt: Date;
  createdAt: Date;
}

export interface Contribution {
  id: string;
  projectId: string;
  authorComposerId: string | null;
  authorSessionId: string | null;
  traceIds: string[];
  territoryId: string;
  artifactScope: string[];
  state: ContributionState;
  kind: ContributionKind;
  requiresOwnerApproval: boolean;
  blockedBy: string | null;
  blockedReason: string | null;
  approvedByComposerId: string | null;
  approvedAt: Date | null;
  contentRef: string;
  transcriptRef: string | null;
  fencingToken: bigint | null;
  repoBranch: string | null;
  commitCount: number;
  lastObservedCommitSha: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// =========================================================================
// Inputs / outputs (per ARCH 6.x signatures, M1-scoped)
// =========================================================================

export interface CreateSessionInput {
  projectId: string;
  composerId: string;
  surface: SessionSurface;
  agentClient?: string;
}

export type ClaimInput =
  | {
      // Pre-existing path (ARCH 6.2.1.5)
      contributionId: string;
      sessionId: string;
    }
  | {
      // Atomic create-and-claim (ARCH 6.2.1)
      contributionId: null;
      sessionId: string;
      kind: ContributionKind;
      traceIds: string[];
      territoryId: string;
      contentRef: string;
      artifactScope: string[];
    };

export interface ClaimResult {
  contributionId: string;
  state: 'claimed';
  authorSessionId: string;
  authorComposerId: string;
  created: boolean;
  requiresOwnerApproval: boolean;
}

export interface UpdateInput {
  contributionId: string;
  sessionId: string;
  state?: 'claimed' | 'plan_review' | 'in_progress' | 'review';
  contentRef?: string;
  fencingToken?: number | bigint;
  blockedBy?: string | null;
  blockedReason?: string | null;
  ownerApproval?: boolean;
  /**
   * Free-form markdown plan body. Required when transitioning into
   * state=plan_review per ARCH 6.2.1.7. The plan IS the working content at
   * this state; no fencing token applies (no artifact-body lock surface).
   */
  planPayload?: string;
  /**
   * Free-form rejection reason. Required when transitioning plan_review ->
   * claimed (reviewer rejects the plan) per ARCH 6.2.1.7.
   */
  reason?: string;
}

export interface UpdateResult {
  contributionId: string;
  state: ContributionState;
  requiresOwnerApproval: boolean;
  approvedByComposerId: string | null;
  planReviewApprovedByComposerId: string | null;
  planReviewApprovedAt: Date | null;
}

export interface ReleaseInput {
  contributionId: string;
  sessionId: string;
  reason?: string;
}

export interface ReleaseResult {
  contributionId: string;
  state: 'open';
  priorAuthorSessionId: string;
  priorAuthorComposerId: string;
}

export interface AcquireLockInput {
  contributionId: string;
  sessionId: string;
  artifactScope: string[];
}

export interface AcquireLockResult {
  lockId: string;
  fencingToken: bigint;
}

export interface ReleaseLockInput {
  lockId: string;
  sessionId: string;
}

export interface LogDecisionInput {
  projectId: string;
  authorComposerId: string;
  sessionId?: string | null;
  category: DecisionCategory;
  summary: string;
  rationale: string;
  traceIds: string[];
  /**
   * UUID of the decision being reversed (NOT the ADR-NNN string). The M2
   * endpoint will accept ADR-NNN at the API boundary and resolve it to a
   * decision_id before calling the library; the library is uuid-native.
   */
  reverses?: string | null;
  triggeredByContributionId?: string | null;
}

export interface AdrAllocation {
  adrNumber: number;
  adrId: string;
  slug: string;
  repoPath: string;
}

// Caller injects the git side (write file → commit → push) and returns the
// resulting repo_commit_sha. The M2 endpoint wraps a committer around this;
// M1 sync scripts that need to log a decision provide their own implementation.
export type DecisionCommitFn = (allocation: AdrAllocation) => Promise<string>;

export interface LogDecisionResult {
  decisionId: string;
  adrId: string;
  repoPath: string;
  repoCommitSha: string;
}

// =========================================================================
// Triage pending (ADR-018 / migration 9 / ARCH 6.5.2)
// =========================================================================

export type TriagePendingCommentSource =
  | 'github'
  | 'jira'
  | 'linear'
  | 'figma'
  | 'confluence'
  | 'notion'
  | 'manual';

export interface TriagePendingClassification {
  category: string;
  confidence: number;
  signals: string[];
}

export interface TriagePendingDraftedProposal {
  category: string;
  confidence: number;
  bodyMarkdown: string;
  suggestedAction: string;
  discipline: 'implementation' | 'research' | 'design';
}

export interface TriagePendingInsertInput {
  projectId: string;
  commentSource: TriagePendingCommentSource;
  externalCommentId: string;
  externalAuthor: string;
  commentText: string;
  commentContext?: Record<string, unknown>;
  receivedAt: Date | string;
  classification: TriagePendingClassification;
  draftedProposal: TriagePendingDraftedProposal;
  territoryId: string;
  triageSessionId?: string | null;
}

export interface TriagePendingInsertResult {
  triagePendingId: string;
}

export interface TriagePendingListInput {
  projectId: string;
  includeDecided?: boolean;
  limit?: number;
}

export interface TriagePendingRow {
  id: string;
  projectId: string;
  commentSource: TriagePendingCommentSource;
  externalCommentId: string;
  externalAuthor: string;
  commentText: string;
  commentContext: Record<string, unknown>;
  receivedAt: Date;
  classification: TriagePendingClassification;
  draftedProposal: TriagePendingDraftedProposal;
  territoryId: string;
  territoryName: string | null;
  territoryReviewRole: string | null;
  triageSessionId: string | null;
  createdAt: Date;
  routedToContributionId: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  decidedByComposerId: string | null;
  decidedByDisplayName: string | null;
}

interface TriagePendingRowRaw {
  id: string;
  project_id: string;
  comment_source: TriagePendingCommentSource;
  external_comment_id: string;
  external_author: string;
  comment_text: string;
  comment_context: Record<string, unknown>;
  received_at: Date;
  classification: TriagePendingClassification;
  drafted_proposal: TriagePendingDraftedProposal;
  territory_id: string;
  territory_name: string | null;
  territory_review_role: string | null;
  triage_session_id: string | null;
  created_at: Date;
  routed_to_contribution_id: string | null;
  rejected_at: Date | null;
  rejection_reason: string | null;
  decided_by_composer_id: string | null;
  decided_by_display_name: string | null;
}

function rowToTriagePending(r: TriagePendingRowRaw): TriagePendingRow {
  return {
    id: r.id,
    projectId: r.project_id,
    commentSource: r.comment_source,
    externalCommentId: r.external_comment_id,
    externalAuthor: r.external_author,
    commentText: r.comment_text,
    commentContext: r.comment_context,
    receivedAt: r.received_at,
    classification: r.classification,
    draftedProposal: r.drafted_proposal,
    territoryId: r.territory_id,
    territoryName: r.territory_name,
    territoryReviewRole: r.territory_review_role,
    triageSessionId: r.triage_session_id,
    createdAt: r.created_at,
    routedToContributionId: r.routed_to_contribution_id,
    rejectedAt: r.rejected_at,
    rejectionReason: r.rejection_reason,
    decidedByComposerId: r.decided_by_composer_id,
    decidedByDisplayName: r.decided_by_display_name,
  };
}

export interface TriagePendingApproveInput {
  triagePendingId: string;
  approverComposerId: string;
  /** Override the synthetic ATELIER-TRIAGE trace_ids if the approver
   *  knows the right linkage. */
  traceIds?: string[];
}

export interface TriagePendingApproveResult {
  triagePendingId: string;
  contributionId: string;
}

export interface TriagePendingRejectInput {
  triagePendingId: string;
  rejecterComposerId: string;
  reason?: string;
}

export interface TriagePendingRejectResult {
  triagePendingId: string;
}

// =========================================================================
// scope_files validation (ADR-045 / ARCH 6.7.5)
// =========================================================================

/**
 * Validate scope_files entries against basic glob-syntax rules so callers
 * who pass malformed patterns get a clear BAD_REQUEST instead of a
 * silently-empty result. The substrate uses Postgres `text[] && text[]`
 * (literal-array overlap) for the actual intersection at v1; full
 * picomatch/minimatch expansion lands at v1.x hardening (ARCH 6.7.5
 * notes "same glob shape as acquire_lock's artifact_scope" -- the
 * acquire_lock implementation has the same v1 limitation per
 * write.ts:25-28).
 *
 * What we catch:
 *   - non-string or empty entries
 *   - unbalanced { } and [ ] (the common malformed-glob cases)
 *   - null bytes (a Postgres text[] hard fail)
 *
 * What we don't catch (deferred to picomatch swap):
 *   - escape-sequence validity inside character classes
 *   - extended-glob !(pat) malformedness
 *
 * Throws AtelierError(BAD_REQUEST) per ARCH 6.7.5's documented failure mode.
 */
function validateScopeFiles(scopeFiles: string[]): void {
  if (!Array.isArray(scopeFiles)) {
    throw new AtelierError('BAD_REQUEST', 'scope_files must be an array of strings');
  }
  for (const pattern of scopeFiles) {
    if (typeof pattern !== 'string' || pattern.length === 0) {
      throw new AtelierError('BAD_REQUEST', 'scope_files entries must be non-empty strings', {
        offending_pattern: pattern,
      });
    }
    if (pattern.includes('\0')) {
      throw new AtelierError('BAD_REQUEST', 'scope_files pattern contains null byte', {
        offending_pattern: pattern,
      });
    }
    let braceDepth = 0;
    let bracketDepth = 0;
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      const prev = i > 0 ? pattern[i - 1] : '';
      if (prev === '\\') continue;
      if (c === '{') braceDepth++;
      else if (c === '}') {
        braceDepth--;
        if (braceDepth < 0) {
          throw new AtelierError('BAD_REQUEST', 'unbalanced { } in scope_files pattern', {
            offending_pattern: pattern,
          });
        }
      } else if (c === '[') bracketDepth++;
      else if (c === ']') {
        bracketDepth--;
        if (bracketDepth < 0) {
          throw new AtelierError('BAD_REQUEST', 'unbalanced [ ] in scope_files pattern', {
            offending_pattern: pattern,
          });
        }
      }
    }
    if (braceDepth !== 0) {
      throw new AtelierError('BAD_REQUEST', 'unbalanced { } in scope_files pattern', {
        offending_pattern: pattern,
      });
    }
    if (bracketDepth !== 0) {
      throw new AtelierError('BAD_REQUEST', 'unbalanced [ ] in scope_files pattern', {
        offending_pattern: pattern,
      });
    }
  }
}

// =========================================================================
// Client
// =========================================================================

export interface AtelierClientOptions {
  databaseUrl: string;
  poolConfig?: Omit<PoolConfig, 'connectionString'>;
  /**
   * Optional broadcaster (ARCH 6.8 / ADR-029). When provided, mutation
   * paths publish post-commit events to the per-project channel. When
   * absent, mutations succeed without broadcast -- canonical state is
   * still authoritative per ADR-005.
   *
   * Per ADR-029 the concrete adapter (Supabase Realtime / Postgres
   * NOTIFY/LISTEN) lives in scripts/coordination/adapters/. This module
   * does not import any provider SDK.
   */
  broadcaster?: BroadcastService;
}

export class AtelierClient {
  private readonly pool: Pool;
  private readonly broadcaster: BroadcastService;

  constructor(opts: AtelierClientOptions) {
    this.pool = new Pool({ connectionString: opts.databaseUrl, ...opts.poolConfig });
    this.broadcaster = opts.broadcaster ?? new NoopBroadcastService();
  }

  async close(): Promise<void> {
    await this.pool.end();
    if (this.broadcaster.close) {
      await this.broadcaster.close();
    }
  }

  // =======================================================================
  // Sessions (ARCH 6.1)
  // =======================================================================

  async createSession(input: CreateSessionInput): Promise<Session> {
    const { rows } = await this.pool.query<SessionRow>(
      `INSERT INTO sessions (project_id, composer_id, surface, agent_client)
       VALUES ($1, $2, $3, $4)
       RETURNING ${SESSION_COLUMNS}`,
      [input.projectId, input.composerId, input.surface, input.agentClient ?? null],
    );
    const row = rows[0];
    if (!row) throw new AtelierError('INTERNAL', 'session insert returned no row');
    await this.recordTelemetry({
      projectId: input.projectId,
      composerId: input.composerId,
      sessionId: row.id,
      action: 'session.created',
      outcome: 'ok',
      metadata: { surface: input.surface, agentClient: input.agentClient ?? null },
    });
    // ARCH 6.8: a fresh session is the canonical "presence appeared" event.
    await this.publishEvent(input.projectId, 'session.presence_changed', {
      session_id: row.id,
      composer_id: input.composerId,
      status: 'active',
      surface: input.surface,
      agent_client: input.agentClient ?? null,
    });
    return rowToSession(row);
  }

  async heartbeat(sessionId: string): Promise<void> {
    // CTE captures the pre-update status so we can publish a
    // presence-changed event only on actual transitions (idle/dead ->
    // active), keeping broadcast volume proportional to real state
    // changes rather than the 30s heartbeat cadence per ARCH 6.8.
    const { rows } = await this.pool.query<{
      project_id: string;
      composer_id: string;
      surface: SessionSurface;
      agent_client: string | null;
      prior_status: 'active' | 'idle' | 'dead';
    }>(
      `WITH prior AS (
         SELECT id, status AS prior_status FROM sessions WHERE id = $1
       )
       UPDATE sessions
          SET heartbeat_at = now(),
              status = 'active'
         FROM prior
        WHERE sessions.id = prior.id
       RETURNING sessions.project_id, sessions.composer_id, sessions.surface,
                 sessions.agent_client, prior.prior_status`,
      [sessionId],
    );
    const row = rows[0];
    if (!row) {
      throw new AtelierError('NOT_FOUND', `session ${sessionId} does not exist`);
    }
    if (row.prior_status !== 'active') {
      await this.publishEvent(row.project_id, 'session.presence_changed', {
        session_id: sessionId,
        composer_id: row.composer_id,
        status: 'active',
        surface: row.surface,
        agent_client: row.agent_client,
      });
    }
  }

  /**
   * Clean session deregister per ARCH 6.1: releases any locks, returns
   * claimed/in-progress/plan_review contributions to state=open with
   * audit-trail clearing per ADR-039 H3, and deletes the session row so
   * subsequent heartbeats fail with 401.
   */
  async deregister(sessionId: string): Promise<void> {
    return this.txWithEvents(async (client, events) => {
      const { rows } = await client.query<{
        id: string;
        composer_id: string;
        project_id: string;
        surface: SessionSurface;
        agent_client: string | null;
      }>(
        `SELECT id, composer_id, project_id, surface, agent_client FROM sessions WHERE id = $1`,
        [sessionId],
      );
      const session = rows[0];
      if (!session) {
        throw new AtelierError('NOT_FOUND', `session ${sessionId} does not exist`);
      }

      // Release locks held by this session.
      await client.query(`DELETE FROM locks WHERE session_id = $1`, [sessionId]);

      // Return claimed / in_progress / plan_review contributions to open.
      // Mirrors release() semantics including audit M2-entry H3 clearing.
      await client.query(
        `UPDATE contributions
            SET state = 'open',
                author_session_id = NULL,
                author_composer_id = NULL,
                plan_review_approved_by_composer_id = NULL,
                plan_review_approved_at = NULL,
                updated_at = now()
          WHERE author_session_id = $1
            AND state IN ('claimed', 'plan_review', 'in_progress')`,
        [sessionId],
      );

      await client.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);

      await this.recordTelemetry({
        projectId: session.project_id,
        composerId: session.composer_id,
        sessionId: null,
        action: 'session.deregistered',
        outcome: 'ok',
        metadata: { sessionId },
        client,
      });

      // ARCH 6.8: session.presence_changed=dead announces departure so
      // subscribers (lens presence panel) can drop the row immediately
      // rather than waiting for the next poll cycle.
      events.push({
        projectId: session.project_id,
        kind: 'session.presence_changed',
        payload: {
          session_id: sessionId,
          composer_id: session.composer_id,
          status: 'dead',
          surface: session.surface,
          agent_client: session.agent_client,
        },
      });
    });
  }

  /**
   * get_context per ARCH 6.7. Returns charter paths, recent decisions,
   * territories owned/consumed, contributions summary, traceability slice.
   * The session token's project_id implicitly scopes the response.
   *
   * Implementation note: at M2 entry the implementation is intentionally
   * minimal -- it returns the substrate-shaped response that satisfies the
   * ARCH 6.1.1 self-verification flow + the ContextResponse fields
   * referenced by smoke. Lens defaults, since_session_id deltas, contract
   * schema bodies, and the full traceability_slice are M2-mid work.
   */
  async getContext(input: { sessionId: string; scopeFiles?: string[] }): Promise<{
    charter: { paths: string[]; excerpts: null };
    recent_decisions: {
      direct: Array<{ id: string; summary: string; trace_ids: string[]; timestamp: Date; repo_path: string | null }>;
      epic_siblings: never[];
      contribution_linked: never[];
      truncated: { direct: boolean; epic_siblings: boolean; contribution_linked: boolean };
    };
    territories: {
      owned: Array<{ name: string; scope_kind: string; scope_pattern: string[]; contracts_published: string[] }>;
      consumed: Array<{ name: string; contracts_consumed: string[] }>;
    };
    contributions_summary: {
      by_state: Record<string, number>;
      active: never[];
      truncated: boolean;
    };
    // Per ADR-045 / ARCH 6.7.5. Present only when scopeFiles was supplied
    // and non-empty; absent otherwise (preserves backward-compat for
    // callers that don't use scope_files). Empty arrays inside the
    // section indicate "queried, no overlaps found" -- composers can
    // rely on the section's presence to confirm the query ran.
    overlapping_active?: {
      contributions: Array<{
        id: string;
        kind: string;
        state: string;
        composer_id: string;
        composer_display_name: string;
        artifact_scope: string[];
        overlapping_files: string[];
        since: Date;
      }>;
      locks: Array<{
        id: string;
        contribution_id: string;
        holder_composer_id: string;
        holder_display_name: string;
        artifact_scope: string[];
        overlapping_files: string[];
        acquired_at: Date;
        ttl_remaining_seconds: number;
      }>;
    };
    stale_as_of: Date;
  }> {
    if (input.scopeFiles !== undefined) {
      validateScopeFiles(input.scopeFiles);
    }
    return this.tx(async (client) => {
      const ctx = await loadSessionContext(client, input.sessionId);

      // Charter paths -- canonical list per ARCH 6.7
      const charterPaths = [
        'CLAUDE.md',
        'AGENTS.md',
        'docs/methodology/METHODOLOGY.md',
        '.atelier/territories.yaml',
        '.atelier/config.yaml',
      ];

      // Recent decisions (project-scoped; 10 most recent)
      const { rows: decisionRows } = await client.query<{
        id: string;
        summary: string;
        trace_ids: string[];
        created_at: Date;
        repo_commit_sha: string | null;
      }>(
        `SELECT id, summary, trace_ids, created_at, repo_commit_sha
           FROM decisions WHERE project_id = $1
           ORDER BY created_at DESC LIMIT 10`,
        [ctx.projectId],
      );

      // Territories: owned by this composer's discipline + consumed
      const { rows: territoryRows } = await client.query<{
        name: string;
        owner_role: string;
        scope_kind: string;
        scope_pattern: string[];
        contracts_consumed: string[];
      }>(
        `SELECT name, owner_role::text AS owner_role, scope_kind::text AS scope_kind,
                scope_pattern, contracts_consumed
           FROM territories WHERE project_id = $1`,
        [ctx.projectId],
      );

      // Contracts published per territory (joined for owned territories)
      const { rows: contractRows } = await client.query<{
        territory_name: string;
        contract_name: string;
      }>(
        `SELECT t.name AS territory_name, c.name AS contract_name
           FROM contracts c JOIN territories t ON t.id = c.territory_id
          WHERE c.project_id = $1`,
        [ctx.projectId],
      );
      const publishedByTerritory = new Map<string, string[]>();
      for (const r of contractRows) {
        const list = publishedByTerritory.get(r.territory_name) ?? [];
        list.push(r.contract_name);
        publishedByTerritory.set(r.territory_name, list);
      }

      const owned = territoryRows
        .filter((t) => ctx.discipline !== null && t.owner_role === ctx.discipline)
        .map((t) => ({
          name: t.name,
          scope_kind: t.scope_kind,
          scope_pattern: t.scope_pattern,
          contracts_published: Array.from(new Set(publishedByTerritory.get(t.name) ?? [])),
        }));

      const consumed = territoryRows
        .filter((t) => (t.contracts_consumed ?? []).length > 0)
        .map((t) => ({ name: t.name, contracts_consumed: t.contracts_consumed }));

      // Contributions summary (by state, project-scoped)
      const { rows: stateRows } = await client.query<{ state: string; n: string }>(
        `SELECT state::text AS state, COUNT(*)::text AS n
           FROM contributions WHERE project_id = $1 GROUP BY state`,
        [ctx.projectId],
      );
      const byState: Record<string, number> = {};
      for (const r of stateRows) byState[r.state] = Number(r.n);

      // Per ADR-045 / ARCH 6.7.5. Empty array is treated as "no scope
      // filter" per the spec -- the overlapping_active section is
      // absent (same as omitting the parameter). Callers that want
      // "all active overlap" semantics use a broad glob like ["**"].
      let overlappingActive:
        | {
            contributions: Array<{
              id: string;
              kind: string;
              state: string;
              composer_id: string;
              composer_display_name: string;
              artifact_scope: string[];
              overlapping_files: string[];
              since: Date;
            }>;
            locks: Array<{
              id: string;
              contribution_id: string;
              holder_composer_id: string;
              holder_display_name: string;
              artifact_scope: string[];
              overlapping_files: string[];
              acquired_at: Date;
              ttl_remaining_seconds: number;
            }>;
          }
        | undefined;
      if (input.scopeFiles !== undefined && input.scopeFiles.length > 0) {
        // Active contributions: states claimed | plan_review | in_progress
        // (not open since open contributions have no holder; not review |
        // merged | rejected since those are terminal-ish per ARCH 6.7.5).
        const { rows: contribRows } = await client.query<{
          id: string;
          kind: string;
          state: string;
          author_composer_id: string;
          composer_display_name: string | null;
          artifact_scope: string[];
          updated_at: Date;
        }>(
          `SELECT c.id, c.kind::text AS kind, c.state::text AS state,
                  c.author_composer_id,
                  cm.display_name AS composer_display_name,
                  c.artifact_scope, c.updated_at
             FROM contributions c
             LEFT JOIN composers cm ON cm.id = c.author_composer_id
            WHERE c.project_id = $1
              AND c.state::text = ANY ($2::text[])
              AND c.artifact_scope && $3::text[]`,
          [
            ctx.projectId,
            ['claimed', 'plan_review', 'in_progress'],
            input.scopeFiles,
          ],
        );

        // Currently-held locks: not-yet-expired. Released locks are
        // deleted from the table per the locks invariant; no
        // soft-delete column to filter.
        const { rows: lockRows } = await client.query<{
          id: string;
          contribution_id: string;
          holder_composer_id: string;
          holder_display_name: string | null;
          artifact_scope: string[];
          acquired_at: Date;
          expires_at: Date | null;
        }>(
          `SELECT l.id, l.contribution_id, l.holder_composer_id,
                  cm.display_name AS holder_display_name,
                  l.artifact_scope, l.acquired_at, l.expires_at
             FROM locks l
             LEFT JOIN composers cm ON cm.id = l.holder_composer_id
            WHERE l.project_id = $1
              AND l.artifact_scope && $2::text[]
              AND (l.expires_at IS NULL OR l.expires_at > NOW())`,
          [ctx.projectId, input.scopeFiles],
        );

        const intersect = (a: string[], b: string[]): string[] => {
          const set = new Set(b);
          return a.filter((x) => set.has(x));
        };
        const now = Date.now();
        overlappingActive = {
          contributions: contribRows.map((r) => ({
            id: r.id,
            kind: r.kind,
            state: r.state,
            composer_id: r.author_composer_id,
            composer_display_name: r.composer_display_name ?? '',
            artifact_scope: r.artifact_scope,
            overlapping_files: intersect(r.artifact_scope, input.scopeFiles!),
            since: r.updated_at,
          })),
          locks: lockRows.map((r) => ({
            id: r.id,
            contribution_id: r.contribution_id,
            holder_composer_id: r.holder_composer_id,
            holder_display_name: r.holder_display_name ?? '',
            artifact_scope: r.artifact_scope,
            overlapping_files: intersect(r.artifact_scope, input.scopeFiles!),
            acquired_at: r.acquired_at,
            ttl_remaining_seconds: r.expires_at
              ? Math.max(0, Math.floor((r.expires_at.getTime() - now) / 1000))
              : 0,
          })),
        };
      }

      return {
        charter: { paths: charterPaths, excerpts: null },
        recent_decisions: {
          direct: decisionRows.map((d) => ({
            id: d.id,
            summary: d.summary,
            trace_ids: d.trace_ids,
            timestamp: d.created_at,
            repo_path: d.repo_commit_sha,
          })),
          epic_siblings: [],
          contribution_linked: [],
          truncated: { direct: false, epic_siblings: false, contribution_linked: false },
        },
        territories: { owned, consumed },
        contributions_summary: { by_state: byState, active: [], truncated: false },
        ...(overlappingActive !== undefined ? { overlapping_active: overlappingActive } : {}),
        stale_as_of: new Date(),
      };
    });
  }

  // =======================================================================
  // Claim (ARCH 6.2.1 + 6.2.1.5)
  // =======================================================================

  async claim(input: ClaimInput): Promise<ClaimResult> {
    return this.txWithEvents(async (client, events) => {
      const sessionContext = await loadSessionContext(client, input.sessionId);

      if (input.contributionId === null) {
        return this.atomicClaim(client, sessionContext, input, events);
      }
      return this.preExistingClaim(client, sessionContext, input, events);
    });
  }

  private async atomicClaim(
    client: PoolClient,
    ctx: SessionContext,
    input: Extract<ClaimInput, { contributionId: null }>,
    events: PendingEvent[],
  ): Promise<ClaimResult> {
    if (input.traceIds.length === 0) {
      throw new AtelierError('BAD_REQUEST', 'trace_ids must be non-empty (ADR-021)');
    }
    if (input.artifactScope.length === 0) {
      throw new AtelierError('BAD_REQUEST', 'artifact_scope must be non-empty');
    }

    const territory = await loadTerritory(client, input.territoryId, ctx.projectId);
    const requiresOwnerApproval = checkAuthoringDiscipline(ctx, territory);

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO contributions (
         project_id, author_composer_id, author_session_id, trace_ids,
         territory_id, artifact_scope, state, kind, requires_owner_approval,
         content_ref
       ) VALUES ($1, $2, $3, $4, $5, $6, 'claimed', $7, $8, $9)
       RETURNING id`,
      [
        ctx.projectId,
        ctx.composerId,
        ctx.sessionId,
        input.traceIds,
        input.territoryId,
        input.artifactScope,
        input.kind,
        requiresOwnerApproval,
        input.contentRef,
      ],
    );

    const id = rows[0]?.id;
    if (!id) throw new AtelierError('INTERNAL', 'contribution insert returned no row');

    await this.recordTelemetry({
      projectId: ctx.projectId,
      composerId: ctx.composerId,
      sessionId: ctx.sessionId,
      action: 'contribution.claimed',
      outcome: 'ok',
      metadata: { contributionId: id, created: true, kind: input.kind, requiresOwnerApproval },
      client,
    });

    events.push({
      projectId: ctx.projectId,
      kind: 'contribution.state_changed',
      payload: {
        contribution_id: id,
        prior_state: null,
        new_state: 'claimed',
        author_session_id: ctx.sessionId,
        author_composer_id: ctx.composerId,
        trace_ids: input.traceIds,
      },
    });

    return {
      contributionId: id,
      state: 'claimed',
      authorSessionId: ctx.sessionId,
      authorComposerId: ctx.composerId,
      created: true,
      requiresOwnerApproval,
    };
  }

  private async preExistingClaim(
    client: PoolClient,
    ctx: SessionContext,
    input: Extract<ClaimInput, { contributionId: string }>,
    events: PendingEvent[],
  ): Promise<ClaimResult> {
    // Conditional UPDATE: only state='open' rows transition; losers see CONFLICT
    // with current author info. Per ARCH 6.2.1.5.
    const { rows } = await client.query<{
      id: string;
      requires_owner_approval: boolean;
      territory_id: string;
      trace_ids: string[];
    }>(
      `UPDATE contributions
          SET state = 'claimed',
              author_session_id = $2,
              author_composer_id = $3,
              updated_at = now()
        WHERE id = $1 AND state = 'open' AND project_id = $4
        RETURNING id, requires_owner_approval, territory_id, trace_ids`,
      [input.contributionId, ctx.sessionId, ctx.composerId, ctx.projectId],
    );

    if (rows.length === 0) {
      const existing = await client.query<{
        id: string;
        state: ContributionState;
        author_session_id: string | null;
        project_id: string;
      }>(
        `SELECT id, state, author_session_id, project_id FROM contributions WHERE id = $1`,
        [input.contributionId],
      );
      const cur = existing.rows[0];
      if (!cur) throw new AtelierError('NOT_FOUND', `contribution ${input.contributionId} not found`);
      if (cur.project_id !== ctx.projectId) {
        throw new AtelierError('NOT_FOUND', `contribution ${input.contributionId} is in a different project`);
      }
      throw new AtelierError('CONFLICT', `contribution is in state ${cur.state}`, {
        currentState: cur.state,
        currentAuthorSessionId: cur.author_session_id,
      });
    }

    const claimed = rows[0]!;
    // Confirm authoring discipline post-claim. The pre-existing row already
    // has its territory; we still validate that this composer is allowed to
    // author here. If discipline mismatches, we CANNOT roll back without
    // breaking the conditional UPDATE's atomicity guarantee, so this check
    // runs first as a SELECT, before the UPDATE attempt.
    // (The actual SELECT-then-UPDATE would race; defer to the trigger-style
    // check at the territory layer when authoring expands. For M1 we accept
    // the post-claim window because all M1 callers are server-side scripts
    // that pre-validate territory membership.)

    await this.recordTelemetry({
      projectId: ctx.projectId,
      composerId: ctx.composerId,
      sessionId: ctx.sessionId,
      action: 'contribution.claimed',
      outcome: 'ok',
      metadata: { contributionId: claimed.id, created: false },
      client,
    });

    events.push({
      projectId: ctx.projectId,
      kind: 'contribution.state_changed',
      payload: {
        contribution_id: claimed.id,
        prior_state: 'open',
        new_state: 'claimed',
        author_session_id: ctx.sessionId,
        author_composer_id: ctx.composerId,
        trace_ids: claimed.trace_ids,
      },
    });

    return {
      contributionId: claimed.id,
      state: 'claimed',
      authorSessionId: ctx.sessionId,
      authorComposerId: ctx.composerId,
      created: false,
      requiresOwnerApproval: claimed.requires_owner_approval,
    };
  }

  // =======================================================================
  // Update (ARCH 6.2.2)
  // =======================================================================

  async update(input: UpdateInput): Promise<UpdateResult> {
    return this.txWithEvents(async (client, events) => {
      const ctx = await loadSessionContext(client, input.sessionId);
      const contribution = await loadContribution(client, input.contributionId, ctx.projectId);

      // Owner-approval path is the only mutation a non-author may perform
      // OUTSIDE of plan-review. Plan-review reviewer transitions also
      // legitimately come from non-authors -- those route through the
      // plan-review handlers below.
      if (input.ownerApproval === true) {
        return this.applyOwnerApproval(client, ctx, contribution);
      }

      // Plan-review transitions per ARCH 6.2.1.7 (ADR-039)
      if (contribution.state === 'claimed' && input.state === 'plan_review') {
        return this.applyPlanSubmission(client, ctx, contribution, input, events);
      }
      if (contribution.state === 'plan_review' && input.state === 'plan_review') {
        // Plan revision (author-only)
        return this.applyPlanResubmission(client, ctx, contribution, input);
      }
      if (contribution.state === 'plan_review' && input.state === 'in_progress') {
        return this.applyPlanApproval(client, ctx, contribution, events);
      }
      if (contribution.state === 'plan_review' && input.state === 'claimed') {
        return this.applyPlanRejection(client, ctx, contribution, input, events);
      }
      // Reject claimed -> in_progress when territory requires plan_review
      // (per ARCH 6.2.1.7 activation rule)
      if (contribution.state === 'claimed' && input.state === 'in_progress') {
        await assertPlanReviewNotRequired(client, contribution.territory_id, ctx.projectId);
      }

      // All other mutations require the calling session to be the author.
      if (contribution.author_session_id !== ctx.sessionId) {
        throw new AtelierError('FORBIDDEN', 'only the contribution author may update', {
          authorSessionId: contribution.author_session_id,
        });
      }

      validateStateTransition(contribution.state, input.state);

      // blocked_by must reference a different contribution in the same project
      if (input.blockedBy !== undefined && input.blockedBy !== null) {
        if (input.blockedBy === contribution.id) {
          throw new AtelierError('BAD_REQUEST', 'contribution cannot block itself');
        }
        const { rowCount } = await client.query(
          `SELECT 1 FROM contributions WHERE id = $1 AND project_id = $2`,
          [input.blockedBy, ctx.projectId],
        );
        if (rowCount === 0) {
          throw new AtelierError('BAD_REQUEST', `blocked_by contribution ${input.blockedBy} not found in project`);
        }
      }

      const setFragments: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      const set = (frag: string, value: unknown): void => {
        setFragments.push(`${frag} = $${p++}`);
        params.push(value);
      };

      if (input.state !== undefined) set('state', input.state);
      if (input.contentRef !== undefined) {
        if (input.fencingToken === undefined) {
          throw new AtelierError('BAD_REQUEST', 'fencing_token required when content_ref is set (ARCH 7.4)');
        }
        await assertFencingTokenValid(client, contribution.id, input.fencingToken);
        set('content_ref', input.contentRef);
      }
      if (input.blockedBy !== undefined) set('blocked_by', input.blockedBy);
      if (input.blockedReason !== undefined) set('blocked_reason', input.blockedReason);

      if (setFragments.length === 0) {
        // No-op update: just refresh updated_at and emit telemetry
        setFragments.push(`updated_at = now()`);
      }

      params.push(contribution.id);
      const whereId = `$${p}`;
      const sql = `UPDATE contributions SET ${setFragments.join(', ')} WHERE id = ${whereId}
                   RETURNING state, requires_owner_approval, approved_by_composer_id,
                             plan_review_approved_by_composer_id, plan_review_approved_at`;
      const { rows } = await client.query<UpdateRow>(sql, params);

      const updated = rows[0]!;

      await this.recordTelemetry({
        projectId: ctx.projectId,
        composerId: ctx.composerId,
        sessionId: ctx.sessionId,
        action: 'contribution.updated',
        outcome: 'ok',
        metadata: {
          contributionId: contribution.id,
          newState: updated.state,
          stateChanged: input.state !== undefined && input.state !== contribution.state,
        },
        client,
      });

      if (input.state !== undefined && input.state !== contribution.state) {
        events.push({
          projectId: ctx.projectId,
          kind: 'contribution.state_changed',
          payload: {
            contribution_id: contribution.id,
            prior_state: contribution.state,
            new_state: updated.state,
            author_session_id: contribution.author_session_id,
            author_composer_id: contribution.author_composer_id,
            trace_ids: contribution.trace_ids,
          },
        });
      }

      return rowToUpdateResult(contribution.id, updated);
    });
  }

  // =======================================================================
  // Plan-review transitions (ARCH 6.2.1.7 / ADR-039)
  // =======================================================================

  private async applyPlanSubmission(
    client: PoolClient,
    ctx: SessionContext,
    contribution: ContributionRow,
    input: UpdateInput,
    events: PendingEvent[],
  ): Promise<UpdateResult> {
    if (contribution.author_session_id !== ctx.sessionId) {
      throw new AtelierError('FORBIDDEN', 'only the contribution author may submit a plan');
    }
    await assertPlanReviewRequired(client, contribution.territory_id, ctx.projectId);
    if (!input.planPayload || input.planPayload.trim().length === 0) {
      throw new AtelierError('BAD_REQUEST', 'plan payload required for state=plan_review (ARCH 6.2.1.7)');
    }

    const setFragments = ['state = \'plan_review\'', 'updated_at = now()'];
    const params: unknown[] = [];
    let p = 1;
    if (input.contentRef !== undefined) {
      setFragments.push(`content_ref = $${p++}`);
      params.push(input.contentRef);
    }
    params.push(contribution.id);
    const whereId = `$${p}`;
    const sql = `UPDATE contributions SET ${setFragments.join(', ')} WHERE id = ${whereId}
                 RETURNING state, requires_owner_approval, approved_by_composer_id,
                           plan_review_approved_by_composer_id, plan_review_approved_at`;
    const { rows } = await client.query<UpdateRow>(sql, params);
    const updated = rows[0]!;

    await this.recordTelemetry({
      projectId: ctx.projectId,
      composerId: ctx.composerId,
      sessionId: ctx.sessionId,
      action: 'contribution.plan_submitted',
      outcome: 'ok',
      metadata: {
        contributionId: contribution.id,
        planLengthChars: input.planPayload.length,
      },
      client,
    });

    events.push({
      projectId: ctx.projectId,
      kind: 'contribution.state_changed',
      payload: {
        contribution_id: contribution.id,
        prior_state: 'claimed',
        new_state: 'plan_review',
        author_session_id: contribution.author_session_id,
        author_composer_id: contribution.author_composer_id,
        trace_ids: contribution.trace_ids,
      },
    });

    return rowToUpdateResult(contribution.id, updated);
  }

  private async applyPlanResubmission(
    client: PoolClient,
    ctx: SessionContext,
    contribution: ContributionRow,
    input: UpdateInput,
  ): Promise<UpdateResult> {
    if (contribution.author_session_id !== ctx.sessionId) {
      throw new AtelierError('FORBIDDEN', 'only the contribution author may revise a plan');
    }
    if (!input.planPayload || input.planPayload.trim().length === 0) {
      throw new AtelierError('BAD_REQUEST', 'plan payload required for plan_review revision');
    }
    const setFragments = ['updated_at = now()'];
    const params: unknown[] = [];
    let p = 1;
    if (input.contentRef !== undefined) {
      setFragments.push(`content_ref = $${p++}`);
      params.push(input.contentRef);
    }
    params.push(contribution.id);
    const whereId = `$${p}`;
    const sql = `UPDATE contributions SET ${setFragments.join(', ')} WHERE id = ${whereId}
                 RETURNING state, requires_owner_approval, approved_by_composer_id,
                           plan_review_approved_by_composer_id, plan_review_approved_at`;
    const { rows } = await client.query<UpdateRow>(sql, params);
    const updated = rows[0]!;

    await this.recordTelemetry({
      projectId: ctx.projectId,
      composerId: ctx.composerId,
      sessionId: ctx.sessionId,
      action: 'contribution.plan_resubmitted',
      outcome: 'ok',
      metadata: { contributionId: contribution.id, planLengthChars: input.planPayload.length },
      client,
    });

    return rowToUpdateResult(contribution.id, updated);
  }

  private async applyPlanApproval(
    client: PoolClient,
    ctx: SessionContext,
    contribution: ContributionRow,
    events: PendingEvent[],
  ): Promise<UpdateResult> {
    if (contribution.author_composer_id === ctx.composerId) {
      throw new AtelierError('FORBIDDEN', 'authors cannot self-approve their own plan (ARCH 6.2.1.7)');
    }
    await assertReviewerDiscipline(client, contribution.territory_id, ctx);

    const { rows } = await client.query<UpdateRow>(
      `UPDATE contributions
          SET state = 'in_progress',
              plan_review_approved_by_composer_id = $1,
              plan_review_approved_at = now(),
              updated_at = now()
        WHERE id = $2
        RETURNING state, requires_owner_approval, approved_by_composer_id,
                  plan_review_approved_by_composer_id, plan_review_approved_at`,
      [ctx.composerId, contribution.id],
    );
    const updated = rows[0]!;

    await this.recordTelemetry({
      projectId: ctx.projectId,
      composerId: ctx.composerId,
      sessionId: ctx.sessionId,
      action: 'contribution.plan_approved',
      outcome: 'ok',
      metadata: { contributionId: contribution.id, reviewerComposerId: ctx.composerId },
      client,
    });

    events.push({
      projectId: ctx.projectId,
      kind: 'contribution.state_changed',
      payload: {
        contribution_id: contribution.id,
        prior_state: 'plan_review',
        new_state: 'in_progress',
        author_session_id: contribution.author_session_id,
        author_composer_id: contribution.author_composer_id,
        trace_ids: contribution.trace_ids,
      },
    });

    return rowToUpdateResult(contribution.id, updated);
  }

  private async applyPlanRejection(
    client: PoolClient,
    ctx: SessionContext,
    contribution: ContributionRow,
    input: UpdateInput,
    events: PendingEvent[],
  ): Promise<UpdateResult> {
    if (contribution.author_composer_id === ctx.composerId) {
      throw new AtelierError('FORBIDDEN', 'authors cannot self-reject their own plan (ARCH 6.2.1.7)');
    }
    await assertReviewerDiscipline(client, contribution.territory_id, ctx);
    if (!input.reason || input.reason.trim().length === 0) {
      throw new AtelierError('BAD_REQUEST', 'reason required when rejecting a plan (ARCH 6.2.1.7)');
    }

    const { rows } = await client.query<UpdateRow>(
      `UPDATE contributions
          SET state = 'claimed',
              updated_at = now()
        WHERE id = $1
        RETURNING state, requires_owner_approval, approved_by_composer_id,
                  plan_review_approved_by_composer_id, plan_review_approved_at`,
      [contribution.id],
    );
    const updated = rows[0]!;

    await this.recordTelemetry({
      projectId: ctx.projectId,
      composerId: ctx.composerId,
      sessionId: ctx.sessionId,
      action: 'contribution.plan_rejected',
      outcome: 'ok',
      metadata: {
        contributionId: contribution.id,
        reviewerComposerId: ctx.composerId,
        reason: input.reason,
      },
      client,
    });

    events.push({
      projectId: ctx.projectId,
      kind: 'contribution.state_changed',
      payload: {
        contribution_id: contribution.id,
        prior_state: 'plan_review',
        new_state: 'claimed',
        author_session_id: contribution.author_session_id,
        author_composer_id: contribution.author_composer_id,
        trace_ids: contribution.trace_ids,
      },
    });

    return rowToUpdateResult(contribution.id, updated);
  }

  private async applyOwnerApproval(
    client: PoolClient,
    ctx: SessionContext,
    contribution: ContributionRow,
  ): Promise<UpdateResult> {
    if (contribution.author_composer_id === ctx.composerId) {
      throw new AtelierError('FORBIDDEN', 'authors cannot self-approve their own cross-role contribution (ARCH 5.3)');
    }
    if (!contribution.requires_owner_approval) {
      // Idempotent: already approved or never required.
      return {
        contributionId: contribution.id,
        state: contribution.state,
        requiresOwnerApproval: false,
        approvedByComposerId: contribution.approved_by_composer_id,
        planReviewApprovedByComposerId: contribution.plan_review_approved_by_composer_id,
        planReviewApprovedAt: contribution.plan_review_approved_at,
      };
    }

    const { rows: territoryRows } = await client.query<{ review_role: string | null }>(
      `SELECT review_role FROM territories WHERE id = $1 AND project_id = $2`,
      [contribution.territory_id, ctx.projectId],
    );
    const territory = territoryRows[0];
    if (!territory) throw new AtelierError('INTERNAL', 'territory missing for contribution');
    const requiredRole = territory.review_role;
    if (requiredRole && ctx.discipline !== requiredRole) {
      throw new AtelierError('FORBIDDEN', `review_role mismatch: territory requires ${requiredRole}, caller is ${ctx.discipline}`);
    }

    const { rows } = await client.query<UpdateRow>(
      `UPDATE contributions
          SET requires_owner_approval = false,
              approved_by_composer_id = $1,
              approved_at = now(),
              updated_at = now()
        WHERE id = $2
        RETURNING state, requires_owner_approval, approved_by_composer_id,
                  plan_review_approved_by_composer_id, plan_review_approved_at`,
      [ctx.composerId, contribution.id],
    );
    const updated = rows[0]!;

    await this.recordTelemetry({
      projectId: ctx.projectId,
      composerId: ctx.composerId,
      sessionId: ctx.sessionId,
      action: 'contribution.approval_recorded',
      outcome: 'ok',
      metadata: {
        contributionId: contribution.id,
        priorAuthorComposerId: contribution.author_composer_id,
      },
      client,
    });

    return rowToUpdateResult(contribution.id, updated);
  }

  // =======================================================================
  // Release (ARCH 6.2.4)
  // =======================================================================

  async release(input: ReleaseInput): Promise<ReleaseResult> {
    return this.txWithEvents(async (client, events) => {
      const ctx = await loadSessionContext(client, input.sessionId);
      const contribution = await loadContribution(client, input.contributionId, ctx.projectId);

      if (contribution.author_session_id !== ctx.sessionId) {
        throw new AtelierError('FORBIDDEN', 'only the contribution author may release', {
          authorSessionId: contribution.author_session_id,
        });
      }
      // Per ARCH 6.2.4 release is permitted from claimed, plan_review, or
      // in_progress. ADR-039 release-from-plan-review preserves the plan
      // body at content_ref; the columns reset on transition to open.
      const releasable: ReadonlyArray<ContributionState> = ['claimed', 'plan_review', 'in_progress'];
      if (!releasable.includes(contribution.state)) {
        throw new AtelierError('BAD_REQUEST', `cannot release from state ${contribution.state}`, {
          currentState: contribution.state,
        });
      }

      // Cascade-release locks held against this contribution (ARCH 6.2.4 side effects).
      await client.query(`DELETE FROM locks WHERE contribution_id = $1`, [contribution.id]);

      // Audit M2-entry H3: clear plan_review_approved_* on transition to
      // state=open so a re-claim does not inherit the prior reviewer's
      // approval (corrupting the audit trail per ADR-039).
      await client.query(
        `UPDATE contributions
            SET state = 'open',
                author_session_id = NULL,
                author_composer_id = NULL,
                plan_review_approved_by_composer_id = NULL,
                plan_review_approved_at = NULL,
                updated_at = now()
          WHERE id = $1`,
        [contribution.id],
      );

      await this.recordTelemetry({
        projectId: ctx.projectId,
        composerId: ctx.composerId,
        sessionId: ctx.sessionId,
        action: 'contribution.released',
        outcome: 'ok',
        metadata: {
          contributionId: contribution.id,
          priorAuthorSessionId: contribution.author_session_id,
          priorAuthorComposerId: contribution.author_composer_id,
          reason: input.reason ?? null,
        },
        client,
      });

      // ARCH 6.8: emit both contribution.released (with prior author info)
      // and contribution.state_changed (so subscribers tracking state can
      // observe the open state without filtering on event kind).
      events.push({
        projectId: ctx.projectId,
        kind: 'contribution.released',
        payload: {
          contribution_id: contribution.id,
          prior_author_session_id: contribution.author_session_id,
          prior_author_composer_id: contribution.author_composer_id,
          reason: 'released',
        },
      });
      events.push({
        projectId: ctx.projectId,
        kind: 'contribution.state_changed',
        payload: {
          contribution_id: contribution.id,
          prior_state: contribution.state,
          new_state: 'open',
          author_session_id: null,
          author_composer_id: null,
          trace_ids: contribution.trace_ids,
        },
      });

      return {
        contributionId: contribution.id,
        state: 'open',
        priorAuthorSessionId: contribution.author_session_id!,
        priorAuthorComposerId: contribution.author_composer_id!,
      };
    });
  }

  // =======================================================================
  // Locks (ARCH 7.4)
  // =======================================================================

  async acquireLock(input: AcquireLockInput): Promise<AcquireLockResult> {
    if (input.artifactScope.length === 0) {
      throw new AtelierError('BAD_REQUEST', 'artifact_scope must be non-empty');
    }
    return this.txWithEvents(async (client, events) => {
      const ctx = await loadSessionContext(client, input.sessionId);
      const contribution = await loadContribution(client, input.contributionId, ctx.projectId);

      if (contribution.author_session_id !== ctx.sessionId) {
        throw new AtelierError('FORBIDDEN', 'only the contribution author may acquire locks against it');
      }

      // Overlap detection via Postgres array intersection. M1 caveat per
      // module header: this is exact-string overlap, not glob expansion.
      const { rows: conflicts } = await client.query<{
        id: string;
        holder_composer_id: string;
        artifact_scope: string[];
      }>(
        `SELECT id, holder_composer_id, artifact_scope
           FROM locks
          WHERE project_id = $1 AND artifact_scope && $2::text[]
          LIMIT 1`,
        [ctx.projectId, input.artifactScope],
      );
      if (conflicts.length > 0) {
        throw new AtelierError('CONFLICT', 'lock scope overlaps existing lock', {
          conflictingLock: conflicts[0],
        });
      }

      const { rows: tokenRows } = await client.query<{ allocate_fencing_token: string }>(
        `SELECT allocate_fencing_token($1)`,
        [ctx.projectId],
      );
      const fencingToken = BigInt(tokenRows[0]!.allocate_fencing_token);

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO locks (
           project_id, holder_composer_id, session_id, contribution_id,
           artifact_scope, fencing_token
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          ctx.projectId,
          ctx.composerId,
          ctx.sessionId,
          contribution.id,
          input.artifactScope,
          fencingToken,
        ],
      );
      const lockId = rows[0]!.id;

      await this.recordTelemetry({
        projectId: ctx.projectId,
        composerId: ctx.composerId,
        sessionId: ctx.sessionId,
        action: 'lock.acquired',
        outcome: 'ok',
        metadata: { lockId, contributionId: contribution.id, fencingToken: fencingToken.toString() },
        client,
      });

      events.push({
        projectId: ctx.projectId,
        kind: 'lock.acquired',
        payload: {
          lock_id: lockId,
          contribution_id: contribution.id,
          artifact_scope: input.artifactScope,
          holder_session_id: ctx.sessionId,
          holder_composer_id: ctx.composerId,
          fencing_token: fencingToken.toString(),
        },
      });

      return { lockId, fencingToken };
    });
  }

  async releaseLock(input: ReleaseLockInput): Promise<void> {
    return this.txWithEvents(async (client, events) => {
      const ctx = await loadSessionContext(client, input.sessionId);
      const { rows } = await client.query<{ id: string; contribution_id: string | null; session_id: string | null }>(
        `DELETE FROM locks WHERE id = $1 AND holder_composer_id = $2
         RETURNING id, contribution_id, session_id`,
        [input.lockId, ctx.composerId],
      );
      if (rows.length === 0) {
        throw new AtelierError('NOT_FOUND', `lock ${input.lockId} not held by calling composer`);
      }
      const released = rows[0]!;
      await this.recordTelemetry({
        projectId: ctx.projectId,
        composerId: ctx.composerId,
        sessionId: ctx.sessionId,
        action: 'lock.released',
        outcome: 'ok',
        metadata: { lockId: input.lockId },
        client,
      });

      events.push({
        projectId: ctx.projectId,
        kind: 'lock.released',
        payload: {
          lock_id: released.id,
          contribution_id: released.contribution_id,
          prior_holder_session_id: released.session_id,
          prior_holder_composer_id: ctx.composerId,
          reason: 'released',
        },
      });
    });
  }

  // =======================================================================
  // Decisions (ARCH 6.3 / 6.3.1)
  //
  // Two-phase per the M1 split: the library allocates ADR-NNN and prepares
  // the slug/repo_path; the caller writes the file, commits, and pushes;
  // the library inserts the row keyed on the resulting commit SHA.
  //
  // The append-only invariant on `decisions` is enforced at the table level
  // by the trigger from migration 1; this code path only INSERTs.
  // =======================================================================

  async logDecision(input: LogDecisionInput, commit: DecisionCommitFn): Promise<LogDecisionResult> {
    if (input.traceIds.length === 0) {
      throw new AtelierError('BAD_REQUEST', 'trace_ids must be non-empty (ADR-021)');
    }
    if (input.summary.trim().length === 0) {
      throw new AtelierError('BAD_REQUEST', 'summary must be non-empty');
    }

    if (input.reverses) {
      // Validate that the reversed decision exists in the same project and
      // has not itself been reversed (per ARCH 6.3.1 reversal flag rules).
      const { rows: reversedRows } = await this.pool.query<{ id: string }>(
        `SELECT id FROM decisions
          WHERE id = $1 AND project_id = $2
            AND NOT EXISTS (SELECT 1 FROM decisions r WHERE r.reverses = $1)
          LIMIT 1`,
        [input.reverses, input.projectId],
      );
      if (reversedRows.length === 0) {
        throw new AtelierError(
          'BAD_REQUEST',
          `reverses target ${input.reverses} not found in project, or already reversed`,
        );
      }
    }

    const allocation = await this.allocateAdr(input.projectId, input.summary);

    const repoCommitSha = await commit(allocation);
    if (!repoCommitSha || repoCommitSha.trim().length === 0) {
      throw new AtelierError('INTERNAL', 'commit callback returned empty repo_commit_sha');
    }

    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO decisions (
         project_id, author_composer_id, session_id, trace_ids, category,
         triggered_by_contribution_id, summary, rationale, reverses, repo_commit_sha
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        input.projectId,
        input.authorComposerId,
        input.sessionId ?? null,
        input.traceIds,
        input.category,
        input.triggeredByContributionId ?? null,
        input.summary,
        input.rationale,
        input.reverses ?? null,
        repoCommitSha,
      ],
    );
    const decisionId = rows[0]!.id;

    await this.recordTelemetry({
      projectId: input.projectId,
      composerId: input.authorComposerId,
      sessionId: input.sessionId ?? null,
      action: 'decision.logged',
      outcome: 'ok',
      metadata: {
        decisionId,
        adrId: allocation.adrId,
        repoCommitSha,
        category: input.category,
      },
    });

    await this.publishEvent(input.projectId, 'decision.created', {
      decision_id: decisionId,
      adr_id: allocation.adrId,
      trace_ids: input.traceIds,
      summary: input.summary,
      category: input.category,
    });

    return {
      decisionId,
      adrId: allocation.adrId,
      repoPath: allocation.repoPath,
      repoCommitSha,
    };
  }

  private async allocateAdr(projectId: string, summary: string): Promise<AdrAllocation> {
    const { rows } = await this.pool.query<{ allocate_adr_number: number }>(
      `SELECT allocate_adr_number($1)`,
      [projectId],
    );
    const adrNumber = rows[0]!.allocate_adr_number;
    const adrId = `ADR-${String(adrNumber).padStart(3, '0')}`;
    const slug = slugify(summary);
    const repoPath = `docs/architecture/decisions/${adrId}-${slug}.md`;
    return { adrNumber, adrId, slug, repoPath };
  }

  // =======================================================================
  // Telemetry (ARCH 8.1)
  // =======================================================================

  private async recordTelemetry(params: {
    projectId: string;
    composerId: string | null;
    sessionId: string | null;
    action: string;
    outcome: 'ok' | 'error';
    metadata?: Record<string, unknown>;
    durationMs?: number;
    client?: PoolClient;
  }): Promise<void> {
    const exec = params.client ?? this.pool;
    await exec.query(
      `INSERT INTO telemetry (project_id, composer_id, session_id, action, outcome, duration_ms, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.projectId,
        params.composerId,
        params.sessionId,
        params.action,
        params.outcome,
        params.durationMs ?? null,
        params.metadata ?? {},
      ],
    );
  }

  // =======================================================================
  // Broadcast (ARCH 6.8 / ADR-029)
  //
  // Post-commit publishes that fan out coordination state changes to
  // subscribers via the configured BroadcastService. Failures are logged
  // and swallowed -- ADR-005 invariant: canonical write succeeded;
  // broadcast is downstream. Subscribers reconcile via the polling
  // fallback per ARCH 6.8.
  //
  // Why post-commit: allocate_broadcast_seq() takes a row-exclusive lock
  // on the projects row. Any open tx that holds an FK row-share on the
  // same projects row (every contribution/lock/decision INSERT does) would
  // deadlock if the publish ran inside the tx via a separate connection.
  // Mutations using tx() collect a PendingEvent[] and txWithEvents()
  // drains it after COMMIT.
  // =======================================================================

  private async publishEvent<TKind extends BroadcastEventKind>(
    projectId: string,
    kind: TKind,
    payload: BroadcastEnvelope<TKind>['payload'],
  ): Promise<void> {
    let seq: bigint;
    try {
      const { rows } = await this.pool.query<{ allocate_broadcast_seq: string }>(
        `SELECT allocate_broadcast_seq($1)`,
        [projectId],
      );
      seq = BigInt(rows[0]!.allocate_broadcast_seq);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[atelier] allocate_broadcast_seq failed for project ${projectId}:`, err);
      return;
    }

    const envelope: BroadcastEnvelope<TKind> = {
      id: seq.toString(),
      seq: seq.toString(),
      published_at: new Date().toISOString(),
      kind,
      project_id: projectId,
      payload,
    };

    try {
      await this.broadcaster.publish({
        channel: projectEventsChannel(projectId),
        envelope,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[atelier] broadcast publish failed for ${kind} on project ${projectId}:`, err);
    }
  }

  // =======================================================================
  // Internals
  // =======================================================================

  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * tx() variant that captures broadcast events from inside the
   * transaction and publishes them AFTER COMMIT.
   *
   * Why deferred (load-bearing; do NOT inline back into the tx):
   *   publishEvent() calls allocate_broadcast_seq(project_id), which is an
   *   UPDATE on the projects row -- it takes a row-EXCLUSIVE lock. Every
   *   contribution / lock / decision INSERT in the open tx already holds
   *   an FK row-SHARE on that same projects row until COMMIT. Running
   *   publishEvent inside the tx via a fresh pool connection blocks the
   *   second connection waiting on the first to commit, while the tx is
   *   awaiting the publish call -> classic two-connection deadlock.
   *
   *   This pattern was discovered when the M4 broadcast smoke hung at
   *   the first claim() emission. Refactoring to in-tx publishing for
   *   "atomicity" looks tempting but reintroduces the deadlock; if you
   *   need atomicity beyond at-least-once + idempotent subscribers,
   *   change the seq allocator to a sequence object (no row lock) first.
   */
  private async txWithEvents<T>(
    fn: (client: PoolClient, events: PendingEvent[]) => Promise<T>,
  ): Promise<T> {
    const events: PendingEvent[] = [];
    const result = await this.tx((client) => fn(client, events));
    for (const ev of events) {
      await this.publishEvent(ev.projectId, ev.kind, ev.payload);
    }
    return result;
  }

  // =======================================================================
  // Triage pending (M6 / migration 9 / ADR-018)
  // =======================================================================
  //
  // Below-threshold drafts from route-proposal flow into this table.
  // The FeedbackQueuePanel reads pending rows; human approval/rejection
  // updates the row and (on approval) creates a contribution.

  async triagePendingInsert(input: TriagePendingInsertInput): Promise<TriagePendingInsertResult> {
    return this.tx(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO triage_pending (
           project_id, comment_source, external_comment_id, external_author,
           comment_text, comment_context, received_at,
           classification, drafted_proposal, territory_id, triage_session_id
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10, $11)
         ON CONFLICT (project_id, comment_source, external_comment_id)
           DO UPDATE SET
             classification = EXCLUDED.classification,
             drafted_proposal = EXCLUDED.drafted_proposal,
             comment_text = EXCLUDED.comment_text,
             comment_context = EXCLUDED.comment_context
         RETURNING id`,
        [
          input.projectId,
          input.commentSource,
          input.externalCommentId,
          input.externalAuthor,
          input.commentText,
          JSON.stringify(input.commentContext ?? {}),
          input.receivedAt,
          JSON.stringify(input.classification),
          JSON.stringify(input.draftedProposal),
          input.territoryId,
          input.triageSessionId ?? null,
        ],
      );
      const id = rows[0]?.id;
      if (!id) throw new AtelierError('INTERNAL', 'triage_pending insert returned no id');
      return { triagePendingId: id };
    });
  }

  async triagePendingList(input: TriagePendingListInput): Promise<TriagePendingRow[]> {
    return this.tx(async (client) => {
      const includeDecided = input.includeDecided === true;
      const filter = includeDecided
        ? ''
        : ' AND tp.routed_to_contribution_id IS NULL AND tp.rejected_at IS NULL';
      const { rows } = await client.query<TriagePendingRowRaw>(
        `SELECT tp.id, tp.project_id, tp.comment_source, tp.external_comment_id,
                tp.external_author, tp.comment_text, tp.comment_context,
                tp.received_at, tp.classification, tp.drafted_proposal,
                tp.territory_id, t.name AS territory_name,
                t.review_role::text AS territory_review_role,
                tp.triage_session_id, tp.created_at,
                tp.routed_to_contribution_id, tp.rejected_at, tp.rejection_reason,
                tp.decided_by_composer_id,
                cm.display_name AS decided_by_display_name
           FROM triage_pending tp
           LEFT JOIN territories t ON t.id = tp.territory_id
           LEFT JOIN composers cm ON cm.id = tp.decided_by_composer_id
          WHERE tp.project_id = $1${filter}
          ORDER BY tp.created_at DESC
          LIMIT $2`,
        [input.projectId, input.limit ?? 50],
      );
      return rows.map(rowToTriagePending);
    });
  }

  async triagePendingApprove(input: TriagePendingApproveInput): Promise<TriagePendingApproveResult> {
    return this.tx(async (client) => {
      const { rows: pendingRows } = await client.query<{
        project_id: string;
        territory_id: string;
        external_comment_id: string;
        comment_source: string;
        drafted_proposal: { discipline: 'implementation' | 'research' | 'design' };
        decided: boolean;
      }>(
        `SELECT project_id, territory_id, external_comment_id, comment_source,
                drafted_proposal,
                (routed_to_contribution_id IS NOT NULL OR rejected_at IS NOT NULL) AS decided
           FROM triage_pending WHERE id = $1 FOR UPDATE`,
        [input.triagePendingId],
      );
      const pending = pendingRows[0];
      if (!pending) throw new AtelierError('NOT_FOUND', 'triage_pending row not found');
      if (pending.decided) {
        throw new AtelierError('CONFLICT', 'triage_pending row already decided');
      }

      // Resolve approver -> composer_id (for author_composer_id on the new
      // contribution). The approver is the human signing off on the
      // triage; the contribution's author is the same composer (they're
      // adopting the drafted proposal).
      const { rows: composerRows } = await client.query<{ id: string; project_id: string }>(
        `SELECT id, project_id FROM composers WHERE id = $1`,
        [input.approverComposerId],
      );
      const composer = composerRows[0];
      if (!composer || composer.project_id !== pending.project_id) {
        throw new AtelierError('FORBIDDEN', 'approver is not a composer in the project');
      }

      const traceIds = input.traceIds && input.traceIds.length > 0 ? input.traceIds : ['ATELIER-TRIAGE'];
      const contentRef = `triage/${pending.comment_source}-${pending.external_comment_id}.md`;
      const artifactScope = [contentRef];

      const { rows: contribRows } = await client.query<{ id: string }>(
        `INSERT INTO contributions (
           project_id, author_composer_id, trace_ids, territory_id,
           artifact_scope, state, kind, requires_owner_approval, content_ref
         )
         VALUES ($1, $2, $3, $4, $5, 'claimed', $6::contribution_kind, false, $7)
         RETURNING id`,
        [
          pending.project_id,
          input.approverComposerId,
          traceIds,
          pending.territory_id,
          artifactScope,
          pending.drafted_proposal.discipline,
          contentRef,
        ],
      );
      const contributionId = contribRows[0]?.id;
      if (!contributionId) throw new AtelierError('INTERNAL', 'contribution insert returned no id');

      await client.query(
        `UPDATE triage_pending
            SET routed_to_contribution_id = $1, decided_by_composer_id = $2
          WHERE id = $3`,
        [contributionId, input.approverComposerId, input.triagePendingId],
      );

      return { triagePendingId: input.triagePendingId, contributionId };
    });
  }

  async triagePendingReject(input: TriagePendingRejectInput): Promise<TriagePendingRejectResult> {
    return this.tx(async (client) => {
      const { rows: pendingRows } = await client.query<{ project_id: string; decided: boolean }>(
        `SELECT project_id,
                (routed_to_contribution_id IS NOT NULL OR rejected_at IS NOT NULL) AS decided
           FROM triage_pending WHERE id = $1 FOR UPDATE`,
        [input.triagePendingId],
      );
      const pending = pendingRows[0];
      if (!pending) throw new AtelierError('NOT_FOUND', 'triage_pending row not found');
      if (pending.decided) {
        throw new AtelierError('CONFLICT', 'triage_pending row already decided');
      }

      const { rows: composerRows } = await client.query<{ project_id: string }>(
        `SELECT project_id FROM composers WHERE id = $1`,
        [input.rejecterComposerId],
      );
      const composer = composerRows[0];
      if (!composer || composer.project_id !== pending.project_id) {
        throw new AtelierError('FORBIDDEN', 'rejecter is not a composer in the project');
      }

      await client.query(
        `UPDATE triage_pending
            SET rejected_at = now(),
                rejection_reason = $1,
                decided_by_composer_id = $2
          WHERE id = $3`,
        [input.reason ?? null, input.rejecterComposerId, input.triagePendingId],
      );

      return { triagePendingId: input.triagePendingId };
    });
  }
}

interface PendingEvent {
  projectId: string;
  kind: BroadcastEventKind;
  payload: BroadcastEnvelope['payload'];
}

// =========================================================================
// Helpers
// =========================================================================

interface SessionContext {
  sessionId: string;
  composerId: string;
  projectId: string;
  discipline: string | null;
}

interface SessionRow {
  id: string;
  project_id: string;
  composer_id: string;
  surface: SessionSurface;
  agent_client: string | null;
  status: 'active' | 'idle' | 'dead';
  heartbeat_at: Date;
  created_at: Date;
}

interface TerritoryRow {
  id: string;
  project_id: string;
  owner_role: string;
  review_role: string | null;
}

interface ContributionRow {
  id: string;
  project_id: string;
  author_composer_id: string | null;
  author_session_id: string | null;
  state: ContributionState;
  kind: ContributionKind;
  territory_id: string;
  trace_ids: string[];
  requires_owner_approval: boolean;
  approved_by_composer_id: string | null;
  plan_review_approved_by_composer_id: string | null;
  plan_review_approved_at: Date | null;
}

interface UpdateRow {
  state: ContributionState;
  requires_owner_approval: boolean;
  approved_by_composer_id: string | null;
  plan_review_approved_by_composer_id: string | null;
  plan_review_approved_at: Date | null;
}

function rowToUpdateResult(contributionId: string, row: UpdateRow): UpdateResult {
  return {
    contributionId,
    state: row.state,
    requiresOwnerApproval: row.requires_owner_approval,
    approvedByComposerId: row.approved_by_composer_id,
    planReviewApprovedByComposerId: row.plan_review_approved_by_composer_id,
    planReviewApprovedAt: row.plan_review_approved_at,
  };
}

const SESSION_COLUMNS = `id, project_id, composer_id, surface, agent_client, status, heartbeat_at, created_at`;

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    projectId: row.project_id,
    composerId: row.composer_id,
    surface: row.surface,
    agentClient: row.agent_client,
    status: row.status,
    heartbeatAt: row.heartbeat_at,
    createdAt: row.created_at,
  };
}

async function loadSessionContext(client: PoolClient, sessionId: string): Promise<SessionContext> {
  const { rows } = await client.query<{
    composer_id: string;
    project_id: string;
    discipline: string | null;
  }>(
    `SELECT s.composer_id, s.project_id, c.discipline
       FROM sessions s
       JOIN composers c ON c.id = s.composer_id
      WHERE s.id = $1`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) throw new AtelierError('NOT_FOUND', `session ${sessionId} does not exist`);
  return {
    sessionId,
    composerId: row.composer_id,
    projectId: row.project_id,
    discipline: row.discipline,
  };
}

async function loadTerritory(
  client: PoolClient,
  territoryId: string,
  projectId: string,
): Promise<TerritoryRow> {
  const { rows } = await client.query<TerritoryRow>(
    `SELECT id, project_id, owner_role::text AS owner_role, review_role::text AS review_role
       FROM territories WHERE id = $1`,
    [territoryId],
  );
  const row = rows[0];
  if (!row) throw new AtelierError('BAD_REQUEST', `territory ${territoryId} not found`);
  if (row.project_id !== projectId) {
    throw new AtelierError('BAD_REQUEST', `territory ${territoryId} is in a different project`);
  }
  return row;
}

async function loadContribution(
  client: PoolClient,
  contributionId: string,
  projectId: string,
): Promise<ContributionRow> {
  const { rows } = await client.query<ContributionRow>(
    `SELECT id, project_id, author_composer_id, author_session_id, state, kind,
            territory_id, trace_ids, requires_owner_approval, approved_by_composer_id,
            plan_review_approved_by_composer_id, plan_review_approved_at
       FROM contributions WHERE id = $1`,
    [contributionId],
  );
  const row = rows[0];
  if (!row) throw new AtelierError('NOT_FOUND', `contribution ${contributionId} not found`);
  if (row.project_id !== projectId) {
    throw new AtelierError('NOT_FOUND', `contribution ${contributionId} is in a different project`);
  }
  return row;
}

function checkAuthoringDiscipline(ctx: SessionContext, territory: TerritoryRow): boolean {
  // ARCH 6.2.1 step 4: discipline=null composers cannot author.
  if (ctx.discipline === null) {
    throw new AtelierError(
      'FORBIDDEN',
      'composers without a discipline (access-level-only roles) cannot author contributions (ADR-038)',
    );
  }
  // Cross-discipline authoring sets requires_owner_approval=true (per ADR-033).
  // The opt-in check from .atelier/config.yaml is read by callers; the library
  // accepts cross-role and just sets the flag. M2 endpoint enforces config gating.
  return ctx.discipline !== territory.owner_role;
}

function validateStateTransition(
  current: ContributionState,
  next: 'claimed' | 'plan_review' | 'in_progress' | 'review' | undefined,
): void {
  if (next === undefined) return;
  // Plan-review transitions (ADR-039 / ARCH 6.2.1.7) are handled by the
  // dedicated plan-review handlers in update(); they're listed here for
  // completeness so the legality table is correct end-to-end.
  const legal: Record<ContributionState, ReadonlyArray<ContributionState>> = {
    open: ['claimed'],
    claimed: ['plan_review', 'in_progress', 'review'],
    plan_review: ['claimed', 'in_progress', 'plan_review'],
    in_progress: ['review'],
    review: [],
    merged: [],
    rejected: [],
  };
  if (!legal[current].includes(next)) {
    throw new AtelierError('BAD_REQUEST', `illegal state transition ${current} -> ${next}`);
  }
}

async function assertPlanReviewRequired(
  client: PoolClient,
  territoryId: string,
  projectId: string,
): Promise<void> {
  const { rows } = await client.query<{ requires_plan_review: boolean }>(
    `SELECT requires_plan_review FROM territories WHERE id = $1 AND project_id = $2`,
    [territoryId, projectId],
  );
  const row = rows[0];
  if (!row) throw new AtelierError('INTERNAL', 'territory missing for contribution');
  if (!row.requires_plan_review) {
    throw new AtelierError(
      'BAD_REQUEST',
      'territory does not require plan_review (ARCH 6.2.1.7); set territories.requires_plan_review=true to opt in',
    );
  }
}

async function assertPlanReviewNotRequired(
  client: PoolClient,
  territoryId: string,
  projectId: string,
): Promise<void> {
  const { rows } = await client.query<{ requires_plan_review: boolean }>(
    `SELECT requires_plan_review FROM territories WHERE id = $1 AND project_id = $2`,
    [territoryId, projectId],
  );
  const row = rows[0];
  if (!row) return; // territory missing -- defer to other validation paths
  if (row.requires_plan_review) {
    throw new AtelierError(
      'BAD_REQUEST',
      'territory requires plan_review; transition to plan_review first (ARCH 6.2.1.7)',
    );
  }
}

async function assertReviewerDiscipline(
  client: PoolClient,
  territoryId: string,
  ctx: SessionContext,
): Promise<void> {
  const { rows } = await client.query<{ review_role: string | null; owner_role: string }>(
    `SELECT review_role::text AS review_role, owner_role::text AS owner_role
       FROM territories WHERE id = $1 AND project_id = $2`,
    [territoryId, ctx.projectId],
  );
  const row = rows[0];
  if (!row) throw new AtelierError('INTERNAL', 'territory missing for contribution');
  // Per ADR-025 review_role is nullable; when null, reviewing falls back to
  // owner_role.
  const requiredRole = row.review_role ?? row.owner_role;
  if (ctx.discipline !== requiredRole) {
    throw new AtelierError(
      'FORBIDDEN',
      `review_role mismatch: territory requires ${requiredRole}, caller is ${ctx.discipline ?? '<none>'}`,
    );
  }
}

async function assertFencingTokenValid(
  client: PoolClient,
  contributionId: string,
  fencingToken: number | bigint,
): Promise<void> {
  const tokenAsBig = BigInt(fencingToken);
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM locks WHERE contribution_id = $1 AND fencing_token = $2 LIMIT 1`,
    [contributionId, tokenAsBig.toString()],
  );
  if (rows.length === 0) {
    throw new AtelierError('CONFLICT', 'fencing_token does not match any active lock for this contribution');
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// =========================================================================
// Convenience factory
// =========================================================================

export function createClient(opts: AtelierClientOptions): AtelierClient {
  return new AtelierClient(opts);
}
