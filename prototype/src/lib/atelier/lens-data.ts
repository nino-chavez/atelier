// Lens view-model loader.
//
// Single entry point that the page server-component calls. Composes:
//   1. Canonical state slice from get_context (charter, recent decisions,
//      territories, contributions_summary by_state) — via dispatch() in-process.
//   2. Lens-augmenting queries that are NOT on the 12-tool surface and never
//      will be (presence, active locks, weighted contributions list,
//      contracts) — via direct AtelierClient pool reads.
//
// The split reflects ARCH 6.7's intent: get_context returns the project-
// scoped digest; lens UIs that need more than the digest reach into the
// datastore. The pool reads here run as the same DB role the dispatcher
// uses (Postgres role bound to ATELIER_DATASTORE_URL) — no privilege
// escalation; the lens is first-party UI.

import type { Pool } from 'pg';
import { dispatch } from '../../../../scripts/endpoint/lib/dispatch.ts';
import type {
  AtelierClient,
  ContributionKind,
  ContributionState,
} from '../../../../scripts/sync/lib/write.ts';
import { getLensDeps } from './deps.ts';
import type { LensConfig, LensId } from './lens-config.ts';
import { LENS_CONFIGS } from './lens-config.ts';
import { LensAuthError, resolveLensViewer } from './session.ts';
import type { SsrCookieStore } from './adapters/supabase-ssr.ts';

export interface PresenceEntry {
  composerId: string;
  composerName: string;
  composerEmail: string;
  discipline: string | null;
  surface: 'ide' | 'web' | 'terminal' | 'passive';
  agentClient: string | null;
  heartbeatAt: Date;
}

export interface ContributionEntry {
  id: string;
  kind: ContributionKind;
  state: ContributionState;
  traceIds: string[];
  territoryName: string;
  contentRef: string;
  authorName: string | null;
  isMine: boolean;
  requiresOwnerApproval: boolean;
  blockedBy: string | null;
  updatedAt: Date;
}

export interface LockEntry {
  id: string;
  contributionId: string;
  artifactScope: string[];
  fencingToken: string;
  holderComposerName: string;
  acquiredAt: Date;
}

export interface ContractEntry {
  id: string;
  territoryName: string;
  name: string;
  version: number;
  effectiveDecision: 'breaking' | 'additive';
  publishedAt: Date;
}

export interface RecentDecisionEntry {
  id: string;
  summary: string;
  traceIds: string[];
  timestamp: Date;
  repoCommitSha: string | null;
}

export interface TerritoryView {
  name: string;
  scopeKind: string;
  scopePattern: string[];
  contractsPublished: string[];
  contractsConsumed: string[];
  ownerRole: string;
  reviewRole: string | null;
  isOwned: boolean;
  isConsumed: boolean;
}

export interface ReviewQueueEntry extends ContributionEntry {
  reviewRole: string | null;
  territoryName: string;
}

export interface FeedbackEntry {
  id: string;
  source: string;
  externalCommentId: string;
  externalAuthor: string;
  commentText: string;
  category: string;
  confidence: number;
  signals: string[];
  bodyMarkdown: string;
  suggestedAction: string;
  discipline: 'implementation' | 'research' | 'design';
  territoryId: string;
  territoryName: string | null;
  reviewRole: string | null;
  createdAt: Date;
  /**
   * True when the viewer's discipline matches the territory's review_role
   * (or owner_role when review_role is null per ADR-025). Drives whether
   * the panel renders the approve/reject affordances or shows a
   * "routed to <role>" hint.
   */
  routedToViewer: boolean;
}

export interface LensViewer {
  composerId: string;
  composerName: string;
  composerEmail: string;
  discipline: string | null;
  accessLevel: string | null;
  projectId: string;
  projectName: string;
  sessionId: string;
}

export interface LensViewModel {
  config: LensConfig;
  viewer: LensViewer;
  charter: { paths: string[]; excerpts: Record<string, string> | null };
  recentDecisions: { direct: RecentDecisionEntry[]; truncated: boolean };
  territories: TerritoryView[];
  contributionsByState: Record<string, number>;
  activeContributions: ContributionEntry[];
  presence: PresenceEntry[];
  locks: LockEntry[];
  contracts: ContractEntry[];
  reviewQueue: ReviewQueueEntry[];
  feedbackQueue: FeedbackEntry[];
  staleAsOf: Date;
}

export type LensLoadResult =
  | { ok: true; viewModel: LensViewModel }
  | { ok: false; reason: 'no_bearer' | 'invalid_bearer' | 'no_composer'; message: string };

export async function loadLensViewModel(
  lensId: LensId,
  request: Request,
  opts: { cookies: SsrCookieStore | null },
): Promise<LensLoadResult> {
  const deps = getLensDeps();
  const config = LENS_CONFIGS[lensId];

  let viewerCtx: Awaited<ReturnType<typeof resolveLensViewer>>;
  try {
    viewerCtx = await resolveLensViewer(request, deps, opts);
  } catch (err) {
    if (err instanceof LensAuthError) {
      return { ok: false, reason: err.kind, message: err.message };
    }
    throw err;
  }
  const { auth, sessionId, bearer } = viewerCtx;
  const pool = (deps.client as unknown as { pool: Pool }).pool;

  const ctxResult = await dispatch(
    { tool: 'get_context', bearer, body: { session_id: sessionId, lens: lensId } },
    deps,
  );
  if (!ctxResult.ok) {
    return {
      ok: false,
      reason: 'invalid_bearer',
      message: `get_context failed: ${ctxResult.error.code}: ${ctxResult.error.message}`,
    };
  }
  const ctx = ctxResult.data as {
    charter: { paths: string[]; excerpts: Record<string, string> | null };
    recent_decisions: {
      direct: Array<{ id: string; summary: string; trace_ids: string[]; timestamp: Date; repo_path: string | null }>;
      truncated: { direct: boolean };
    };
    contributions_summary: { by_state: Record<string, number> };
    stale_as_of: Date;
  };

  const [
    viewerInfo,
    territoriesView,
    presence,
    activeContributions,
    locks,
    contracts,
    reviewQueue,
    feedbackQueue,
  ] = await Promise.all([
    loadViewerInfo(pool, auth.composerId, auth.projectId),
    loadTerritories(pool, auth.projectId, auth.discipline),
    loadPresence(pool, auth.projectId),
    loadActiveContributions(pool, auth.projectId, auth.composerId, config),
    loadLocks(pool, auth.projectId),
    loadContracts(pool, auth.projectId),
    loadReviewQueue(pool, auth.projectId, auth.discipline),
    loadFeedbackQueue(deps.client, auth.projectId, auth.discipline),
  ]);

  return {
    ok: true,
    viewModel: {
      config,
      viewer: { ...viewerInfo, sessionId },
      charter: ctx.charter,
      recentDecisions: {
        direct: ctx.recent_decisions.direct
          .slice(0, config.depth.recentDecisionsPerBandLimit)
          .map((d) => ({
            id: d.id,
            summary: d.summary,
            traceIds: d.trace_ids,
            timestamp: d.timestamp,
            repoCommitSha: d.repo_path,
          })),
        truncated: ctx.recent_decisions.truncated.direct,
      },
      territories: territoriesView,
      contributionsByState: ctx.contributions_summary.by_state,
      activeContributions,
      presence,
      locks,
      contracts,
      reviewQueue,
      feedbackQueue,
      staleAsOf: ctx.stale_as_of,
    },
  };
}

async function loadViewerInfo(
  pool: Pool,
  composerId: string,
  projectId: string,
): Promise<Omit<LensViewer, 'sessionId'>> {
  const { rows } = await pool.query<{
    composer_name: string;
    composer_email: string;
    discipline: string | null;
    access_level: string | null;
    project_name: string;
  }>(
    `SELECT c.display_name AS composer_name,
            c.email AS composer_email,
            c.discipline::text AS discipline,
            c.access_level::text AS access_level,
            p.name AS project_name
       FROM composers c JOIN projects p ON p.id = c.project_id
      WHERE c.id = $1 AND p.id = $2`,
    [composerId, projectId],
  );
  const row = rows[0];
  if (!row) throw new Error(`composer ${composerId} disappeared during lens render`);
  return {
    composerId,
    composerName: row.composer_name,
    composerEmail: row.composer_email,
    discipline: row.discipline,
    accessLevel: row.access_level,
    projectId,
    projectName: row.project_name,
  };
}

async function loadTerritories(
  pool: Pool,
  projectId: string,
  viewerDiscipline: string | null,
): Promise<TerritoryView[]> {
  const { rows } = await pool.query<{
    name: string;
    owner_role: string;
    review_role: string | null;
    scope_kind: string;
    scope_pattern: string[];
    contracts_published: string[];
    contracts_consumed: string[];
  }>(
    `SELECT t.name,
            t.owner_role::text AS owner_role,
            t.review_role::text AS review_role,
            t.scope_kind::text AS scope_kind,
            t.scope_pattern,
            COALESCE(array_agg(c.name) FILTER (WHERE c.name IS NOT NULL), ARRAY[]::text[]) AS contracts_published,
            t.contracts_consumed
       FROM territories t
       LEFT JOIN contracts c ON c.territory_id = t.id AND c.project_id = t.project_id
      WHERE t.project_id = $1
      GROUP BY t.id, t.name, t.owner_role, t.review_role, t.scope_kind, t.scope_pattern, t.contracts_consumed
      ORDER BY t.name`,
    [projectId],
  );
  return rows.map((r) => ({
    name: r.name,
    scopeKind: r.scope_kind,
    scopePattern: r.scope_pattern,
    contractsPublished: Array.from(new Set(r.contracts_published)),
    contractsConsumed: r.contracts_consumed ?? [],
    ownerRole: r.owner_role,
    reviewRole: r.review_role,
    isOwned: viewerDiscipline !== null && r.owner_role === viewerDiscipline,
    isConsumed: (r.contracts_consumed ?? []).length > 0,
  }));
}

async function loadPresence(pool: Pool, projectId: string): Promise<PresenceEntry[]> {
  const { rows } = await pool.query<{
    composer_id: string;
    display_name: string;
    email: string;
    discipline: string | null;
    surface: PresenceEntry['surface'];
    agent_client: string | null;
    heartbeat_at: Date;
  }>(
    `SELECT DISTINCT ON (s.composer_id)
            s.composer_id,
            c.display_name,
            c.email,
            c.discipline::text AS discipline,
            s.surface::text AS surface,
            s.agent_client,
            s.heartbeat_at
       FROM sessions s JOIN composers c ON c.id = s.composer_id
      WHERE s.project_id = $1
        AND s.status = 'active'
        AND s.heartbeat_at > now() - interval '15 minutes'
      ORDER BY s.composer_id, s.heartbeat_at DESC`,
    [projectId],
  );
  return rows.map((r) => ({
    composerId: r.composer_id,
    composerName: r.display_name,
    composerEmail: r.email,
    discipline: r.discipline,
    surface: r.surface,
    agentClient: r.agent_client,
    heartbeatAt: r.heartbeat_at,
  }));
}

async function loadActiveContributions(
  pool: Pool,
  projectId: string,
  viewerComposerId: string,
  config: LensConfig,
): Promise<ContributionEntry[]> {
  const w = config.depth.contributionsKindWeights;
  const { rows } = await pool.query<{
    id: string;
    kind: ContributionKind;
    state: ContributionState;
    trace_ids: string[];
    territory_name: string;
    content_ref: string;
    author_name: string | null;
    author_composer_id: string | null;
    requires_owner_approval: boolean;
    blocked_by: string | null;
    updated_at: Date;
  }>(
    `SELECT co.id,
            co.kind::text AS kind,
            co.state::text AS state,
            co.trace_ids,
            t.name AS territory_name,
            co.content_ref,
            c.display_name AS author_name,
            co.author_composer_id,
            co.requires_owner_approval,
            co.blocked_by,
            co.updated_at
       FROM contributions co
       JOIN territories t ON t.id = co.territory_id
       LEFT JOIN composers c ON c.id = co.author_composer_id
      WHERE co.project_id = $1
        AND co.state IN ('open', 'claimed', 'plan_review', 'in_progress', 'review')
      ORDER BY (CASE co.kind::text
                  WHEN 'implementation' THEN $2::int
                  WHEN 'research' THEN $3::int
                  WHEN 'design' THEN $4::int
                  ELSE 0
                END) DESC,
               co.updated_at DESC
      LIMIT $5`,
    [projectId, w.implementation, w.research, w.design, config.depth.contributionsActiveLimit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    state: r.state,
    traceIds: r.trace_ids,
    territoryName: r.territory_name,
    contentRef: r.content_ref,
    authorName: r.author_name,
    isMine: r.author_composer_id === viewerComposerId,
    requiresOwnerApproval: r.requires_owner_approval,
    blockedBy: r.blocked_by,
    updatedAt: r.updated_at,
  }));
}

async function loadLocks(pool: Pool, projectId: string): Promise<LockEntry[]> {
  const { rows } = await pool.query<{
    id: string;
    contribution_id: string;
    artifact_scope: string[];
    fencing_token: string;
    holder_name: string;
    acquired_at: Date;
  }>(
    `SELECT l.id,
            l.contribution_id,
            l.artifact_scope,
            l.fencing_token::text AS fencing_token,
            c.display_name AS holder_name,
            l.acquired_at
       FROM locks l JOIN composers c ON c.id = l.holder_composer_id
      WHERE l.project_id = $1
      ORDER BY l.acquired_at DESC
      LIMIT 50`,
    [projectId],
  );
  return rows.map((r) => ({
    id: r.id,
    contributionId: r.contribution_id,
    artifactScope: r.artifact_scope,
    fencingToken: r.fencing_token,
    holderComposerName: r.holder_name,
    acquiredAt: r.acquired_at,
  }));
}

async function loadContracts(pool: Pool, projectId: string): Promise<ContractEntry[]> {
  const { rows } = await pool.query<{
    id: string;
    territory_name: string;
    name: string;
    version: number;
    effective_decision: 'breaking' | 'additive';
    published_at: Date;
  }>(
    `SELECT c.id,
            t.name AS territory_name,
            c.name,
            c.version,
            c.effective_decision::text AS effective_decision,
            c.published_at
       FROM contracts c JOIN territories t ON t.id = c.territory_id
      WHERE c.project_id = $1
      ORDER BY c.published_at DESC
      LIMIT 25`,
    [projectId],
  );
  return rows.map((r) => ({
    id: r.id,
    territoryName: r.territory_name,
    name: r.name,
    version: r.version,
    effectiveDecision: r.effective_decision,
    publishedAt: r.published_at,
  }));
}

async function loadReviewQueue(
  pool: Pool,
  projectId: string,
  viewerDiscipline: string | null,
): Promise<ReviewQueueEntry[]> {
  if (!viewerDiscipline) return [];
  const { rows } = await pool.query<{
    id: string;
    kind: ContributionKind;
    state: ContributionState;
    trace_ids: string[];
    territory_name: string;
    review_role: string | null;
    content_ref: string;
    author_name: string | null;
    requires_owner_approval: boolean;
    blocked_by: string | null;
    updated_at: Date;
  }>(
    `SELECT co.id,
            co.kind::text AS kind,
            co.state::text AS state,
            co.trace_ids,
            t.name AS territory_name,
            t.review_role::text AS review_role,
            co.content_ref,
            c.display_name AS author_name,
            co.requires_owner_approval,
            co.blocked_by,
            co.updated_at
       FROM contributions co
       JOIN territories t ON t.id = co.territory_id
       LEFT JOIN composers c ON c.id = co.author_composer_id
      WHERE co.project_id = $1
        AND co.state = 'review'
        AND COALESCE(t.review_role::text, t.owner_role::text) = $2
      ORDER BY co.updated_at DESC
      LIMIT 30`,
    [projectId, viewerDiscipline],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    state: r.state,
    traceIds: r.trace_ids,
    territoryName: r.territory_name,
    contentRef: r.content_ref,
    authorName: r.author_name,
    isMine: false,
    requiresOwnerApproval: r.requires_owner_approval,
    blockedBy: r.blocked_by,
    updatedAt: r.updated_at,
    reviewRole: r.review_role,
  }));
}

// =========================================================================
// Feedback queue (M6 / ADR-018 / migration 9)
// =========================================================================
//
// Loads pending triage_pending rows via AtelierClient.triagePendingList
// (the panel-side wrapper around migration 9's table). Each row is
// shaped into a FeedbackEntry that the panel renders. The
// `routedToViewer` flag (computed client-side from the viewer's
// discipline + the territory's review_role) drives whether the panel
// shows approve/reject affordances or just a "routed to <role>" hint.
//
// Same data layer pattern as loadReviewQueue: panel reads from the
// derived view-model; server actions (approve/reject) call back into
// AtelierClient via the dispatcher.

async function loadFeedbackQueue(
  client: AtelierClient,
  projectId: string,
  viewerDiscipline: string | null,
): Promise<FeedbackEntry[]> {
  const rows = await client.triagePendingList({ projectId });
  return rows.map((r) => {
    // Per ADR-025 review_role is nullable; falls back to owner_role.
    // Without owner_role here we conservatively use review_role only;
    // the server action's territory check is the load-bearing one.
    const requiredRole = r.territoryReviewRole;
    const routedToViewer =
      viewerDiscipline !== null &&
      requiredRole !== null &&
      requiredRole === viewerDiscipline;
    return {
      id: r.id,
      source: r.commentSource,
      externalCommentId: r.externalCommentId,
      externalAuthor: r.externalAuthor,
      commentText: r.commentText,
      category: r.classification.category,
      confidence: r.classification.confidence,
      signals: r.classification.signals,
      bodyMarkdown: r.draftedProposal.bodyMarkdown,
      suggestedAction: r.draftedProposal.suggestedAction,
      discipline: r.draftedProposal.discipline,
      territoryId: r.territoryId,
      territoryName: r.territoryName,
      reviewRole: r.territoryReviewRole,
      createdAt: r.createdAt,
      routedToViewer,
    };
  });
}
