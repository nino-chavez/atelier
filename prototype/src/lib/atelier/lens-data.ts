// Lens view-model loader (post canonical-rebuild).
//
// One Supabase RPC (`atelier_lens_load`) returns the view-model body —
// territories, presence, active contributions, locks, contracts, review
// queue, feedback queue — assembled server-side as a single jsonb. The
// dispatch(get_context) call still serves charter + recent_decisions +
// contributions_summary because get_context does markdown excerpt loading
// from the repo working tree, which is genuinely not Postgres work.
//
// Per BRD-OPEN-QUESTIONS section 31 + METHODOLOGY 11.5b: lens-side data
// access goes via @supabase/ssr → PostgREST → SECURITY DEFINER RPC. No
// pg.Pool in this module.

import { dispatch } from '../../../../scripts/endpoint/lib/dispatch.ts';
import type { ContributionKind, ContributionState } from '../../../../scripts/sync/lib/write.ts';
import { getLensServices } from './deps.ts';
import { getMcpDeps } from './mcp-deps.ts';
import type { LensConfig, LensId } from './lens-config.ts';
import { LENS_CONFIGS } from './lens-config.ts';
import {
  LensAuthError,
  resolveBearer,
  resolveLensViewer,
  getRequestSupabaseClient,
  type LensViewerContext,
} from './session.ts';
import type { ServerSupabaseClient } from './adapters/supabase-ssr.ts';
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

interface RawLensLoadPayload {
  viewer: {
    composer_id: string;
    composer_name: string;
    composer_email: string;
    discipline: string | null;
    access_level: string | null;
    project_id: string;
    project_name: string;
    session_id: string;
  };
  territories: Array<{
    name: string;
    scope_kind: string;
    scope_pattern: string[];
    contracts_published: string[];
    contracts_consumed?: string[] | null;
    owner_role: string;
    review_role: string | null;
  }>;
  presence: Array<{
    composer_id: string;
    composer_name: string;
    composer_email: string;
    discipline: string | null;
    surface: PresenceEntry['surface'];
    agent_client: string | null;
    heartbeat_at: string;
  }>;
  active_contributions: Array<{
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
    updated_at: string;
  }>;
  locks: Array<{
    id: string;
    contribution_id: string;
    artifact_scope: string[];
    fencing_token: string;
    holder_name: string;
    acquired_at: string;
  }>;
  contracts: Array<{
    id: string;
    territory_name: string;
    name: string;
    version: number;
    effective_decision: 'breaking' | 'additive';
    published_at: string;
  }>;
  review_queue: Array<{
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
    updated_at: string;
  }>;
  feedback_queue: Array<{
    id: string;
    comment_source: string;
    external_comment_id: string;
    external_author: string;
    comment_text: string;
    classification: { category: string; confidence: number; signals: string[] };
    drafted_proposal: {
      bodyMarkdown: string;
      suggestedAction: string;
      discipline: 'implementation' | 'research' | 'design';
    };
    territory_id: string;
    territory_name: string | null;
    review_role: string | null;
    created_at: string;
  }>;
}

/**
 * Load the lens view-model. Required: a Next.js request scope (cookies +
 * the lens id from the path). Optional: the Supabase client; tests can
 * pass a stub.
 */
export async function loadLensViewModel(
  lensId: LensId,
  request: Request,
  opts: { cookies: SsrCookieStore | null; client?: ServerSupabaseClient },
): Promise<LensLoadResult> {
  const config = LENS_CONFIGS[lensId];
  let supabase: ServerSupabaseClient;
  let viewer: LensViewerContext;
  try {
    supabase = opts.client ?? (await getRequestSupabaseClient());
    viewer = await resolveLensViewer(supabase);
  } catch (err) {
    if (err instanceof LensAuthError) {
      return { ok: false, reason: err.kind, message: err.message };
    }
    throw err;
  }

  // Bearer for the dispatch(get_context) leg. We already have the cookie;
  // resolveBearer() reads it via the same SSR adapter and returns the
  // JWT string the MCP-side authenticate() expects.
  const bearer =
    (await resolveBearer(request, { cookies: opts.cookies })) ?? '';
  if (!bearer) {
    return {
      ok: false,
      reason: 'no_bearer',
      message: 'No Supabase Auth session present.',
    };
  }

  const [lensPayloadResult, ctxResult] = await Promise.all([
    supabase.rpc<{ p_lens_id: string }, RawLensLoadPayload>('atelier_lens_load', {
      p_lens_id: lensId,
    }),
    dispatch(
      { tool: 'get_context', bearer, body: { session_id: viewer.sessionId, lens: lensId } },
      getMcpDeps(),
    ),
  ]);

  if (lensPayloadResult.error || !lensPayloadResult.data) {
    return {
      ok: false,
      reason: 'invalid_bearer',
      message: `atelier_lens_load failed: ${lensPayloadResult.error?.message ?? 'no payload'}`,
    };
  }
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
      direct: Array<{ id: string; summary: string; trace_ids: string[]; timestamp: string; repo_path: string | null }>;
      truncated: { direct: boolean };
    };
    contributions_summary: { by_state: Record<string, number> };
    stale_as_of: string;
  };

  const payload = lensPayloadResult.data;
  const viewerComposerId = payload.viewer.composer_id;

  const viewModel: LensViewModel = {
    config,
    viewer: {
      composerId: payload.viewer.composer_id,
      composerName: payload.viewer.composer_name,
      composerEmail: payload.viewer.composer_email,
      discipline: payload.viewer.discipline,
      accessLevel: payload.viewer.access_level,
      projectId: payload.viewer.project_id,
      projectName: payload.viewer.project_name,
      sessionId: payload.viewer.session_id,
    },
    charter: ctx.charter,
    recentDecisions: {
      direct: ctx.recent_decisions.direct
        .slice(0, config.depth.recentDecisionsPerBandLimit)
        .map((d) => ({
          id: d.id,
          summary: d.summary,
          traceIds: d.trace_ids,
          timestamp: new Date(d.timestamp),
          repoCommitSha: d.repo_path,
        })),
      truncated: ctx.recent_decisions.truncated.direct,
    },
    territories: payload.territories.map((t) => ({
      name: t.name,
      scopeKind: t.scope_kind,
      scopePattern: t.scope_pattern,
      contractsPublished: Array.from(new Set(t.contracts_published ?? [])),
      contractsConsumed: t.contracts_consumed ?? [],
      ownerRole: t.owner_role,
      reviewRole: t.review_role,
      isOwned: viewer.discipline !== null && t.owner_role === viewer.discipline,
      isConsumed: (t.contracts_consumed ?? []).length > 0,
    })),
    contributionsByState: ctx.contributions_summary.by_state,
    activeContributions: payload.active_contributions.map((c) => ({
      id: c.id,
      kind: c.kind,
      state: c.state,
      traceIds: c.trace_ids,
      territoryName: c.territory_name,
      contentRef: c.content_ref,
      authorName: c.author_name,
      isMine: c.author_composer_id === viewerComposerId,
      requiresOwnerApproval: c.requires_owner_approval,
      blockedBy: c.blocked_by,
      updatedAt: new Date(c.updated_at),
    })),
    presence: payload.presence.map((p) => ({
      composerId: p.composer_id,
      composerName: p.composer_name,
      composerEmail: p.composer_email,
      discipline: p.discipline,
      surface: p.surface,
      agentClient: p.agent_client,
      heartbeatAt: new Date(p.heartbeat_at),
    })),
    locks: payload.locks.map((l) => ({
      id: l.id,
      contributionId: l.contribution_id,
      artifactScope: l.artifact_scope,
      fencingToken: l.fencing_token,
      holderComposerName: l.holder_name,
      acquiredAt: new Date(l.acquired_at),
    })),
    contracts: payload.contracts.map((c) => ({
      id: c.id,
      territoryName: c.territory_name,
      name: c.name,
      version: c.version,
      effectiveDecision: c.effective_decision,
      publishedAt: new Date(c.published_at),
    })),
    reviewQueue: payload.review_queue.map((c) => ({
      id: c.id,
      kind: c.kind,
      state: c.state,
      traceIds: c.trace_ids,
      territoryName: c.territory_name,
      contentRef: c.content_ref,
      authorName: c.author_name,
      isMine: false,
      requiresOwnerApproval: c.requires_owner_approval,
      blockedBy: c.blocked_by,
      updatedAt: new Date(c.updated_at),
      reviewRole: c.review_role,
    })),
    feedbackQueue: payload.feedback_queue.map((f) => {
      const requiredRole = f.review_role;
      const routedToViewer =
        viewer.discipline !== null &&
        requiredRole !== null &&
        requiredRole === viewer.discipline;
      return {
        id: f.id,
        source: f.comment_source,
        externalCommentId: f.external_comment_id,
        externalAuthor: f.external_author,
        commentText: f.comment_text,
        category: f.classification.category,
        confidence: f.classification.confidence,
        signals: f.classification.signals,
        bodyMarkdown: f.drafted_proposal.bodyMarkdown,
        suggestedAction: f.drafted_proposal.suggestedAction,
        discipline: f.drafted_proposal.discipline,
        territoryId: f.territory_id,
        territoryName: f.territory_name,
        reviewRole: f.review_role,
        createdAt: new Date(f.created_at),
        routedToViewer,
      };
    }),
    staleAsOf: new Date(ctx.stale_as_of),
  };

  // The find-similar lens action consumes embedder + config; we
  // resolve the lens services lazily there. No-op here; just keeps the
  // import live so dead-code-elimination doesn't drop it.
  void getLensServices;

  return { ok: true, viewModel };
}
