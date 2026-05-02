// 12-tool MCP endpoint surface (per ADR-013 + ADR-040).
//
// Each handler is a thin wrapper around scripts/sync/lib/write.ts. The
// 12 tools at v1, locked:
//   register, heartbeat, deregister,
//   get_context, find_similar,
//   claim, update, release, log_decision,
//   acquire_lock, release_lock,
//   propose_contract_change
//
// At M2 entry the substrate-level handlers wrap write.ts; transport
// (Streamable HTTP MCP) is a thin adapter on top. find_similar and
// propose_contract_change are stubbed with the wire shape but full
// implementations land at later M2 work (find_similar gates on M5 D24;
// propose_contract_change wires through write.ts after the contracts-
// publish helper lands).

import type { Pool } from 'pg';

import { AtelierClient, AtelierError } from '../../sync/lib/write.ts';
import type { AuthContext } from './auth.ts';
import type { AdrCommitter, ComposerIdentity } from './committer.ts';
import { findSimilar as findSimilarImpl, type FindSimilarDeps, type FindSimilarResponse } from './find-similar.ts';

// =========================================================================
// Tool: register (ARCH 6.1)
// =========================================================================

export interface RegisterRequest {
  surface: 'ide' | 'web' | 'terminal' | 'passive';
  agent_client?: string;
}

export interface RegisterResponse {
  session_token: string;
  session_id: string;
  context_summary: { projects_visible: number };
}

export async function register(
  client: AtelierClient,
  auth: AuthContext,
  req: RegisterRequest,
): Promise<RegisterResponse> {
  const session = await client.createSession({
    projectId: auth.projectId,
    composerId: auth.composerId,
    surface: req.surface,
    ...(req.agent_client !== undefined ? { agentClient: req.agent_client } : {}),
  });
  return {
    session_token: session.id,
    session_id: session.id,
    context_summary: { projects_visible: 1 },
  };
}

// =========================================================================
// Tool: heartbeat (ARCH 6.1)
// =========================================================================

export interface HeartbeatRequest {
  session_id: string;
}

export async function heartbeat(
  client: AtelierClient,
  _auth: AuthContext,
  req: HeartbeatRequest,
): Promise<{ ok: true }> {
  await client.heartbeat(req.session_id);
  return { ok: true };
}

// =========================================================================
// Tool: deregister (ARCH 6.1)
// =========================================================================

export interface DeregisterRequest {
  session_id: string;
}

export async function deregister(
  client: AtelierClient,
  _auth: AuthContext,
  req: DeregisterRequest,
): Promise<{ ok: true }> {
  await client.deregister(req.session_id);
  return { ok: true };
}

// =========================================================================
// Tool: get_context (ARCH 6.7)
// =========================================================================

export interface GetContextRequest {
  session_id: string;
  // Optional fields per ARCH 6.7 signature; M2 entry implements the
  // unscoped form. Lens-tuned + since-session-id deltas + contract
  // schema bodies are M2-mid work.
  trace_id?: string | string[];
  lens?: string;
  with_contract_schemas?: boolean;
  // Per ADR-045 / ARCH 6.7.5: file-scope filter for pre-claim overlap
  // awareness. When supplied (non-empty), the response carries an
  // `overlapping_active` section listing active contributions + locks
  // whose artifact_scope intersects the supplied file scope.
  scope_files?: string[];
}

export async function getContext(
  client: AtelierClient,
  _auth: AuthContext,
  req: GetContextRequest,
) {
  return client.getContext({
    sessionId: req.session_id,
    ...(req.scope_files !== undefined ? { scopeFiles: req.scope_files } : {}),
  });
}

// =========================================================================
// Tool: find_similar (ARCH 6.4 / 6.4.1 / 6.4.3 + ADR-006 + ADR-041)
// =========================================================================
//
// At M5 entry the real vector + keyword paths land. The dispatcher injects
// the EmbeddingService + FindSimilarConfig via FindSimilarDeps; the
// implementation lives in ./find-similar.ts so the eval harness can call
// the same code path the endpoint uses.

export interface FindSimilarRequest {
  description: string;
  trace_id?: string;
}

export async function findSimilar(
  client: AtelierClient,
  auth: AuthContext,
  req: FindSimilarRequest,
  findSimilarDeps: Omit<FindSimilarDeps, 'pool'>,
): Promise<FindSimilarResponse> {
  const pool = (client as unknown as { pool: Pool }).pool;
  return findSimilarImpl(
    auth.projectId,
    { description: req.description, ...(req.trace_id !== undefined ? { trace_id: req.trace_id } : {}) },
    { pool, ...findSimilarDeps },
  );
}

// =========================================================================
// Tool: claim (ARCH 6.2.1 / 6.2.1.5)
// =========================================================================

export type ClaimRequest =
  | {
      contribution_id: string;
      session_id: string;
    }
  | {
      contribution_id: null;
      session_id: string;
      kind: 'implementation' | 'research' | 'design';
      trace_ids: string[];
      territory_id: string;
      content_ref: string;
      artifact_scope: string[];
    };

export async function claim(client: AtelierClient, _auth: AuthContext, req: ClaimRequest) {
  if (req.contribution_id === null) {
    return client.claim({
      contributionId: null,
      sessionId: req.session_id,
      kind: req.kind,
      traceIds: req.trace_ids,
      territoryId: req.territory_id,
      contentRef: req.content_ref,
      artifactScope: req.artifact_scope,
    });
  }
  return client.claim({
    contributionId: req.contribution_id,
    sessionId: req.session_id,
  });
}

// =========================================================================
// Tool: update (ARCH 6.2.2 + 6.2.1.7 plan-review)
// =========================================================================

export interface UpdateRequest {
  contribution_id: string;
  session_id: string;
  state?: 'claimed' | 'plan_review' | 'in_progress' | 'review';
  content_ref?: string;
  fencing_token?: number | string;
  blocked_by?: string | null;
  blocked_reason?: string | null;
  owner_approval?: boolean;
  /** Plan markdown body when transitioning to state=plan_review (ARCH 6.2.1.7) */
  plan_payload?: string;
  /** Rejection reason when transitioning plan_review -> claimed */
  reason?: string;
}

export async function update(client: AtelierClient, _auth: AuthContext, req: UpdateRequest) {
  return client.update({
    contributionId: req.contribution_id,
    sessionId: req.session_id,
    ...(req.state !== undefined ? { state: req.state } : {}),
    ...(req.content_ref !== undefined ? { contentRef: req.content_ref } : {}),
    ...(req.fencing_token !== undefined
      ? { fencingToken: typeof req.fencing_token === 'string' ? BigInt(req.fencing_token) : req.fencing_token }
      : {}),
    ...(req.blocked_by !== undefined ? { blockedBy: req.blocked_by } : {}),
    ...(req.blocked_reason !== undefined ? { blockedReason: req.blocked_reason } : {}),
    ...(req.owner_approval !== undefined ? { ownerApproval: req.owner_approval } : {}),
    ...(req.plan_payload !== undefined ? { planPayload: req.plan_payload } : {}),
    ...(req.reason !== undefined ? { reason: req.reason } : {}),
  });
}

// =========================================================================
// Tool: release (ARCH 6.2.4)
// =========================================================================

export interface ReleaseRequest {
  contribution_id: string;
  session_id: string;
  reason?: string;
}

export async function release(client: AtelierClient, _auth: AuthContext, req: ReleaseRequest) {
  return client.release({
    contributionId: req.contribution_id,
    sessionId: req.session_id,
    ...(req.reason !== undefined ? { reason: req.reason } : {}),
  });
}

// =========================================================================
// Tool: log_decision (ARCH 6.3 / 6.3.1)
// =========================================================================
//
// The endpoint provides a default commit callback that records the
// decision against the configured per-project committer. For substrate
// smoke we accept the caller-injected commit callback (matching write.ts
// shape) so tests can stub the git side.

export interface LogDecisionRequest {
  project_id: string;
  session_id?: string | null;
  category: 'architecture' | 'product' | 'design' | 'research';
  summary: string;
  rationale: string;
  trace_ids: string[];
  reverses?: string | null;
  triggered_by_contribution_id?: string | null;
  /**
   * Optional. When set, the committer caches `(session_id, idempotency_key)`
   * -> sha for 1 hour per ARCH 6.3.1; same key in window returns the cached
   * SHA without re-writing the ADR.
   */
  idempotency_key?: string | null;
}

export interface LogDecisionResponse {
  decision_id: string;
  adr_id: string;
  repo_path: string;
  repo_commit_sha: string;
}

export async function logDecision(
  client: AtelierClient,
  auth: AuthContext,
  req: LogDecisionRequest,
  committer: AdrCommitter,
): Promise<LogDecisionResponse> {
  // ARCH 7.8 attribution requires the composer's display_name + email so
  // the bridge closure can build the Co-Authored-By trailer. Fetched once
  // per call against the AtelierClient's pool.
  const composer = await loadComposerIdentity(client, auth.composerId);

  const result = await client.logDecision(
    {
      projectId: req.project_id,
      authorComposerId: auth.composerId,
      sessionId: req.session_id ?? null,
      category: req.category,
      summary: req.summary,
      rationale: req.rationale,
      traceIds: req.trace_ids,
      reverses: req.reverses ?? null,
      triggeredByContributionId: req.triggered_by_contribution_id ?? null,
    },
    async (allocation) =>
      committer.commit({
        allocation,
        category: req.category,
        summary: req.summary,
        rationale: req.rationale,
        traceIds: req.trace_ids,
        reverses: req.reverses ?? null,
        triggeredByContributionId: req.triggered_by_contribution_id ?? null,
        composer,
        sessionId: req.session_id ?? null,
        projectId: req.project_id,
        idempotencyKey: req.idempotency_key ?? null,
      }),
  );
  // ARCH 6.3.1 wire shape is snake_case to match the other 11 tools; project
  // from write.ts's camelCase result.
  return {
    decision_id: result.decisionId,
    adr_id: result.adrId,
    repo_path: result.repoPath,
    repo_commit_sha: result.repoCommitSha,
  };
}

async function loadComposerIdentity(
  client: AtelierClient,
  composerId: string,
): Promise<ComposerIdentity> {
  // AtelierClient does not expose a getComposer() method; reach the pool
  // via the same typed escape hatch that dispatch.ts uses for authenticate().
  const pool = (client as unknown as { pool: Pool }).pool;
  const { rows } = await pool.query<{ display_name: string; email: string }>(
    `SELECT display_name, email FROM composers WHERE id = $1`,
    [composerId],
  );
  const row = rows[0];
  if (!row) {
    throw new AtelierError('INTERNAL', `composer ${composerId} not found for log_decision attribution`);
  }
  return { composerId, displayName: row.display_name, email: row.email };
}

// =========================================================================
// Tool: acquire_lock (ARCH 7.4)
// =========================================================================

export interface AcquireLockRequest {
  contribution_id: string;
  session_id: string;
  artifact_scope: string[];
}

export async function acquireLock(
  client: AtelierClient,
  _auth: AuthContext,
  req: AcquireLockRequest,
) {
  const result = await client.acquireLock({
    contributionId: req.contribution_id,
    sessionId: req.session_id,
    artifactScope: req.artifact_scope,
  });
  return {
    lock_id: result.lockId,
    fencing_token: result.fencingToken.toString(),
  };
}

// =========================================================================
// Tool: release_lock (ARCH 7.4)
// =========================================================================

export interface ReleaseLockRequest {
  lock_id: string;
  session_id: string;
}

export async function releaseLock(
  client: AtelierClient,
  _auth: AuthContext,
  req: ReleaseLockRequest,
): Promise<{ ok: true }> {
  await client.releaseLock({ lockId: req.lock_id, sessionId: req.session_id });
  return { ok: true };
}

// =========================================================================
// Tool: propose_contract_change (ARCH 6.6 / ADR-040)
// =========================================================================
//
// The contracts publish + propose flow per ARCH 6.6. Stubbed at M2 entry
// per BUILD-SEQUENCE: the contracts surface implementation lands when
// territories actually publish contracts (M2-mid). The endpoint advertises
// the surface so the 12-tool count is correct; calling it returns
// NOT_IMPLEMENTED until the substrate logic lands.

export interface ProposeContractChangeRequest {
  territory_id: string;
  name: string;
  schema: unknown;
  override_classification?: 'breaking' | 'additive' | null;
  override_justification?: string | null;
}

export async function proposeContractChange(
  _client: AtelierClient,
  _auth: AuthContext,
  _req: ProposeContractChangeRequest,
): Promise<never> {
  throw new AtelierError(
    'INTERNAL',
    'propose_contract_change is registered as a v1 tool per ADR-040 but full implementation lands at M2-mid',
    { stub: true, lands_at: 'M2-mid' },
  );
}
