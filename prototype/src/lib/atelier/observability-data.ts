// Observability dashboard view-model loader (post canonical-rebuild).
//
// Single Supabase RPC (`atelier_obs_load`) returns the eight monitoring
// sections — sessions, contributions, locks, decisions, triage, sync,
// vector, cost — assembled server-side as one jsonb. Mirrors ARCH 8.2.
//
// Per BRD-OPEN-QUESTIONS section 31 + METHODOLOGY 11.5b: lens-side data
// access goes via @supabase/ssr → PostgREST → SECURITY DEFINER RPC. No
// pg.Pool in this module. The RPC's helper sub-functions
// (atelier_obs_section_*) hold the original SQL bodies in plpgsql.

import { resolve as pathResolve } from 'node:path';

import {
  type ObservabilityConfig,
  type ObservabilityThresholds,
  loadObservabilityConfig,
} from './observability-config.ts';
import type { ServerSupabaseClient } from './adapters/supabase-ssr.ts';
import { getRequestSupabaseClient } from './session.ts';

export interface SessionsViewModel {
  activeNow: number;
  activeBySurface: Record<string, number>;
  reapedLastWindow: number;
  recentRegistrations: Array<{ at: Date; surface: string; agentClient: string | null }>;
  guildActiveNow: number;
}

export interface ContributionsViewModel {
  byState: Record<string, number>;
  lifetime: number;
  recentTransitions: Array<{
    at: Date;
    action: string;
    composerName: string | null;
    contributionId: string | null;
  }>;
  throughputByTerritory: Array<{ territory: string; count: number }>;
}

export interface LocksViewModel {
  heldNow: number;
  recentAcquisitions: number;
  recentReleases: number;
  conflictRate: number;
  recentLedger: Array<{
    at: Date;
    action: 'lock.acquired' | 'lock.released';
    holderName: string | null;
    artifactScope: string[];
    fencingToken: string | null;
  }>;
}

export interface DecisionsViewModel {
  lifetime: number;
  recentCount: number;
  findSimilarSignal: 'no_data' | 'has_data';
  findSimilarLastRunAt: Date | null;
}

export interface TriageViewModel {
  pendingCount: number;
  acceptedLastWindow: number;
  rejectedLastWindow: number;
  confidenceBuckets: { low: number; medium: number; high: number };
}

export interface SyncViewModel {
  scripts: Array<{
    action: string;
    lastRunAt: Date | null;
    lastOutcome: string | null;
    errorRateLastWindow: number;
    runCountLastWindow: number;
  }>;
}

export interface VectorViewModel {
  rowCount: number;
  bySourceKind: Record<string, number>;
  recentInserts: number;
  modelVersions: string[];
}

export interface CostViewModel {
  windowSeconds: number;
  totalUsd: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  byActionClass: Array<{ actionClass: string; usd: number; tokensInput: number; tokensOutput: number }>;
  byComposer: Array<{ composerName: string; usd: number }>;
  signal: 'no_data' | 'has_data';
}

export interface ObservabilityViewModel {
  config: ObservabilityConfig;
  thresholds: ObservabilityThresholds;
  sessions: SessionsViewModel;
  contributions: ContributionsViewModel;
  locks: LocksViewModel;
  decisions: DecisionsViewModel;
  triage: TriageViewModel;
  sync: SyncViewModel;
  vector: VectorViewModel;
  cost: CostViewModel;
  staleAsOf: Date;
}

interface RawObsPayload {
  sessions: {
    active_now: number;
    active_by_surface: Record<string, number>;
    reaped_last_window: number;
    recent_registrations: Array<{ at: string; surface: string; agent_client: string | null }>;
    guild_active_now: number;
  };
  contributions: {
    by_state: Record<string, number>;
    lifetime: number;
    recent_transitions: Array<{
      at: string;
      action: string;
      composer_name: string | null;
      contribution_id: string | null;
    }>;
    throughput_by_territory: Array<{ territory: string; count: number }>;
  };
  locks: {
    held_now: number;
    recent_acquisitions: number;
    recent_releases: number;
    conflict_rate: number;
    recent_ledger: Array<{
      at: string;
      action: 'lock.acquired' | 'lock.released';
      holder_name: string | null;
      artifact_scope: string[] | null;
      fencing_token: string | null;
    }>;
  };
  decisions: {
    lifetime: number;
    recent_count: number;
    find_similar_signal: 'no_data' | 'has_data';
    find_similar_last_run_at: string | null;
  };
  triage: {
    pending_count: number;
    accepted_last_window: number;
    rejected_last_window: number;
    confidence_buckets: { low: number; medium: number; high: number };
  };
  sync: {
    scripts: Array<{
      action: string;
      last_run_at: string | null;
      last_outcome: string | null;
      error_rate_last_window: number;
      run_count_last_window: number;
    }>;
  };
  vector: {
    row_count: number;
    by_source_kind: Record<string, number>;
    recent_inserts: number;
    model_versions: string[];
  };
  cost: {
    window_seconds: number;
    total_usd: number;
    total_tokens_input: number;
    total_tokens_output: number;
    by_action_class: Array<{
      action_class: string;
      usd: number;
      tokens_input: number;
      tokens_output: number;
    }>;
    by_composer: Array<{ composer_name: string; usd: number }>;
    signal: 'no_data' | 'has_data';
  };
}

export async function loadObservabilityViewModel(
  client?: ServerSupabaseClient,
): Promise<ObservabilityViewModel> {
  const supabase = client ?? (await getRequestSupabaseClient());
  const config = loadObservabilityConfig(
    process.env.ATELIER_REPO_ROOT ? pathResolve(process.env.ATELIER_REPO_ROOT) : pathResolve(process.cwd()),
  );

  const { data, error } = await supabase.rpc<{ p_lookback_seconds: number }, RawObsPayload>(
    'atelier_obs_load',
    { p_lookback_seconds: config.lookbackSeconds },
  );
  if (error || !data) {
    throw new Error(
      `atelier_obs_load failed: ${error?.message ?? 'no payload'}`,
    );
  }

  return {
    config,
    thresholds: config.thresholds,
    sessions: {
      activeNow: data.sessions.active_now,
      activeBySurface: data.sessions.active_by_surface,
      reapedLastWindow: data.sessions.reaped_last_window,
      recentRegistrations: data.sessions.recent_registrations.map((r) => ({
        at: new Date(r.at),
        surface: r.surface,
        agentClient: r.agent_client,
      })),
      guildActiveNow: data.sessions.guild_active_now,
    },
    contributions: {
      byState: data.contributions.by_state,
      lifetime: data.contributions.lifetime,
      recentTransitions: data.contributions.recent_transitions.map((r) => ({
        at: new Date(r.at),
        action: r.action,
        composerName: r.composer_name,
        contributionId: r.contribution_id,
      })),
      throughputByTerritory: data.contributions.throughput_by_territory,
    },
    locks: {
      heldNow: data.locks.held_now,
      recentAcquisitions: data.locks.recent_acquisitions,
      recentReleases: data.locks.recent_releases,
      conflictRate: data.locks.conflict_rate,
      recentLedger: data.locks.recent_ledger.map((r) => ({
        at: new Date(r.at),
        action: r.action,
        holderName: r.holder_name,
        artifactScope: r.artifact_scope ?? [],
        fencingToken: r.fencing_token,
      })),
    },
    decisions: {
      lifetime: data.decisions.lifetime,
      recentCount: data.decisions.recent_count,
      findSimilarSignal: data.decisions.find_similar_signal,
      findSimilarLastRunAt: data.decisions.find_similar_last_run_at
        ? new Date(data.decisions.find_similar_last_run_at)
        : null,
    },
    triage: {
      pendingCount: data.triage.pending_count,
      acceptedLastWindow: data.triage.accepted_last_window,
      rejectedLastWindow: data.triage.rejected_last_window,
      confidenceBuckets: data.triage.confidence_buckets,
    },
    sync: {
      scripts: data.sync.scripts.map((s) => ({
        action: s.action,
        lastRunAt: s.last_run_at ? new Date(s.last_run_at) : null,
        lastOutcome: s.last_outcome,
        errorRateLastWindow: s.error_rate_last_window,
        runCountLastWindow: s.run_count_last_window,
      })),
    },
    vector: {
      rowCount: data.vector.row_count,
      bySourceKind: data.vector.by_source_kind,
      recentInserts: data.vector.recent_inserts,
      modelVersions: data.vector.model_versions,
    },
    cost: {
      windowSeconds: data.cost.window_seconds,
      totalUsd: data.cost.total_usd,
      totalTokensInput: data.cost.total_tokens_input,
      totalTokensOutput: data.cost.total_tokens_output,
      byActionClass: data.cost.by_action_class.map((b) => ({
        actionClass: b.action_class,
        usd: b.usd,
        tokensInput: b.tokens_input,
        tokensOutput: b.tokens_output,
      })),
      byComposer: data.cost.by_composer.map((b) => ({
        composerName: b.composer_name,
        usd: b.usd,
      })),
      signal: data.cost.signal,
    },
    staleAsOf: new Date(),
  };
}
