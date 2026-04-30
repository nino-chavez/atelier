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

import { AtelierClient, AtelierError } from '../../sync/lib/write.ts';
import type { AuthContext } from './auth.ts';

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
}

export async function getContext(
  client: AtelierClient,
  _auth: AuthContext,
  req: GetContextRequest,
) {
  return client.getContext({ sessionId: req.session_id });
}

// =========================================================================
// Tool: find_similar (ARCH 6.4)
// =========================================================================
//
// Stubbed at M2 entry per BUILD-SEQUENCE: the eval harness + vector
// index land at M5. The endpoint advertises the surface and returns a
// degraded:true response so callers behave correctly when the index is
// not yet populated.

export interface FindSimilarRequest {
  description: string;
  trace_id?: string;
}

export async function findSimilar(
  _client: AtelierClient,
  _auth: AuthContext,
  req: FindSimilarRequest,
): Promise<{
  primary_matches: never[];
  weak_suggestions: never[];
  degraded: true;
  thresholds_used: { default: number; weak: number };
}> {
  if (!req.description || req.description.trim().length === 0) {
    throw new AtelierError('BAD_REQUEST', 'description must be non-empty');
  }
  return {
    primary_matches: [],
    weak_suggestions: [],
    degraded: true,
    thresholds_used: { default: 0.8, weak: 0.65 },
  };
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
}

export async function logDecision(
  client: AtelierClient,
  auth: AuthContext,
  req: LogDecisionRequest,
  commit: (allocation: { adrId: string; repoPath: string; slug: string; adrNumber: number }) => Promise<string>,
) {
  return client.logDecision(
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
    commit,
  );
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
