// Observability dashboard view-model loader (ARCH 8.2).
//
// Aggregates the eight monitoring sections from the canonical datastore:
//   1. sessions     - heartbeat health, surface breakdown, reaper activity
//   2. contributions- by-state counts, recent state-transition audit log
//   3. locks        - currently held, recent acquisition/release ledger
//   4. decisions    - lifetime ADR count, find_similar match-rate signal
//   5. triage       - pending backlog, classifier confidence distribution
//   6. sync         - per-script last successful run, error rate
//   7. vector       - embeddings row count, recent insert rate
//   8. cost         - tokens / USD aggregates from telemetry payloads
//
// Admin-gated: callers verify composers.access_level='admin' before
// rendering. The loader itself runs as the same DB role the lens shell
// uses (no privilege escalation; admin gate is at the route boundary).
//
// Per ADR-029 the queries use plain pg pool; no Supabase RPC helpers.
//
// Refresh discipline: SSR initial render, then a 30s client-poll island
// (Refresher.tsx) re-runs the route. Different surface from the
// coordination lenses (which subscribe to the broadcast substrate);
// observability is operator-driven monitoring where freshness is the
// value, not a source of write contention.

import type { Pool } from 'pg';
import { getLensDeps } from './deps.ts';
import {
  type ObservabilityConfig,
  type ObservabilityThresholds,
  loadObservabilityConfig,
} from './observability-config.ts';
import { resolve as pathResolve } from 'node:path';

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
  conflictRate: number; // share of acquisitions in the window where another lock contested same scope
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
  confidenceBuckets: { low: number; medium: number; high: number }; // <0.5, 0.5-0.8, >=0.8
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

export async function loadObservabilityViewModel(
  projectId: string,
): Promise<ObservabilityViewModel> {
  const deps = getLensDeps();
  const pool = (deps.client as unknown as { pool: Pool }).pool;
  const config = loadObservabilityConfig(
    process.env.ATELIER_REPO_ROOT ? pathResolve(process.env.ATELIER_REPO_ROOT) : pathResolve(process.cwd()),
  );
  const lookbackInterval = `${config.lookbackSeconds} seconds`;

  const [
    sessions,
    contributions,
    locks,
    decisions,
    triage,
    sync,
    vector,
    cost,
  ] = await Promise.all([
    loadSessions(pool, projectId, lookbackInterval),
    loadContributions(pool, projectId, lookbackInterval),
    loadLocks(pool, projectId, lookbackInterval),
    loadDecisions(pool, projectId, lookbackInterval),
    loadTriage(pool, projectId, lookbackInterval),
    loadSync(pool, projectId, lookbackInterval),
    loadVector(pool, projectId, lookbackInterval),
    loadCost(pool, projectId, lookbackInterval, config.lookbackSeconds),
  ]);

  return {
    config,
    thresholds: config.thresholds,
    sessions,
    contributions,
    locks,
    decisions,
    triage,
    sync,
    vector,
    cost,
    staleAsOf: new Date(),
  };
}

async function loadSessions(
  pool: Pool,
  projectId: string,
  lookbackInterval: string,
): Promise<SessionsViewModel> {
  const [activeRows, surfaceRows, reapedRow, recentRows, guildRow] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sessions
        WHERE project_id = $1 AND status = 'active' AND heartbeat_at > now() - interval '15 minutes'`,
      [projectId],
    ),
    pool.query<{ surface: string; count: string }>(
      `SELECT surface::text AS surface, COUNT(*)::text AS count FROM sessions
        WHERE project_id = $1 AND status = 'active' AND heartbeat_at > now() - interval '15 minutes'
        GROUP BY surface`,
      [projectId],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM telemetry
        WHERE project_id = $1 AND action = 'session.reaped' AND created_at > now() - $2::interval`,
      [projectId, lookbackInterval],
    ),
    pool.query<{ created_at: Date; surface: string; agent_client: string | null }>(
      `SELECT created_at, surface::text AS surface, agent_client FROM sessions
        WHERE project_id = $1 AND created_at > now() - $2::interval
        ORDER BY created_at DESC LIMIT 10`,
      [projectId, lookbackInterval],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sessions
        WHERE status = 'active' AND heartbeat_at > now() - interval '15 minutes'`,
    ),
  ]);
  const bySurface: Record<string, number> = {};
  for (const r of surfaceRows.rows) bySurface[r.surface] = Number(r.count);
  return {
    activeNow: Number(activeRows.rows[0]?.count ?? '0'),
    activeBySurface: bySurface,
    reapedLastWindow: Number(reapedRow.rows[0]?.count ?? '0'),
    recentRegistrations: recentRows.rows.map((r) => ({
      at: r.created_at,
      surface: r.surface,
      agentClient: r.agent_client,
    })),
    guildActiveNow: Number(guildRow.rows[0]?.count ?? '0'),
  };
}

async function loadContributions(
  pool: Pool,
  projectId: string,
  lookbackInterval: string,
): Promise<ContributionsViewModel> {
  const [byStateRows, lifetimeRow, recentRows, throughputRows] = await Promise.all([
    pool.query<{ state: string; count: string }>(
      `SELECT state::text AS state, COUNT(*)::text AS count FROM contributions
        WHERE project_id = $1 GROUP BY state`,
      [projectId],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM contributions WHERE project_id = $1`,
      [projectId],
    ),
    pool.query<{
      created_at: Date;
      action: string;
      composer_name: string | null;
      contribution_id: string | null;
    }>(
      `SELECT t.created_at, t.action, c.display_name AS composer_name,
              (t.metadata->>'contributionId')::text AS contribution_id
         FROM telemetry t LEFT JOIN composers c ON c.id = t.composer_id
        WHERE t.project_id = $1
          AND t.action LIKE 'contribution.%'
          AND t.created_at > now() - $2::interval
        ORDER BY t.created_at DESC LIMIT 50`,
      [projectId, lookbackInterval],
    ),
    pool.query<{ territory_name: string; count: string }>(
      `SELECT t.name AS territory_name, COUNT(co.id)::text AS count
         FROM contributions co JOIN territories t ON t.id = co.territory_id
        WHERE co.project_id = $1 AND co.created_at > now() - $2::interval
        GROUP BY t.name ORDER BY COUNT(co.id) DESC LIMIT 10`,
      [projectId, lookbackInterval],
    ),
  ]);
  const byState: Record<string, number> = {};
  for (const r of byStateRows.rows) byState[r.state] = Number(r.count);
  return {
    byState,
    lifetime: Number(lifetimeRow.rows[0]?.count ?? '0'),
    recentTransitions: recentRows.rows.map((r) => ({
      at: r.created_at,
      action: r.action,
      composerName: r.composer_name,
      contributionId: r.contribution_id,
    })),
    throughputByTerritory: throughputRows.rows.map((r) => ({
      territory: r.territory_name,
      count: Number(r.count),
    })),
  };
}

async function loadLocks(
  pool: Pool,
  projectId: string,
  lookbackInterval: string,
): Promise<LocksViewModel> {
  const [heldRow, acqRow, relRow, conflictRow, ledgerRows] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM locks WHERE project_id = $1`,
      [projectId],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM telemetry
        WHERE project_id = $1 AND action = 'lock.acquired' AND created_at > now() - $2::interval`,
      [projectId, lookbackInterval],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM telemetry
        WHERE project_id = $1 AND action = 'lock.released' AND created_at > now() - $2::interval`,
      [projectId, lookbackInterval],
    ),
    // Conflict proxy: telemetry rows where outcome='error' on lock.acquired (existing lock blocked the attempt).
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM telemetry
        WHERE project_id = $1 AND action = 'lock.acquired'
          AND outcome = 'error' AND created_at > now() - $2::interval`,
      [projectId, lookbackInterval],
    ),
    pool.query<{
      created_at: Date;
      action: string;
      composer_name: string | null;
      artifact_scope: string[] | null;
      fencing_token: string | null;
    }>(
      // The locks JOIN only fires when metadata->>'lockId' parses as a uuid;
      // older telemetry rows wrote arbitrary identifiers in that field, so a
      // raw ::uuid cast would error on the whole result set.
      `SELECT t.created_at, t.action, c.display_name AS composer_name,
              CASE
                WHEN (t.metadata->>'lockId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  THEN (SELECT artifact_scope FROM locks WHERE id = (t.metadata->>'lockId')::uuid)
                ELSE NULL
              END AS artifact_scope,
              (t.metadata->>'fencingToken')::text AS fencing_token
         FROM telemetry t LEFT JOIN composers c ON c.id = t.composer_id
        WHERE t.project_id = $1
          AND t.action IN ('lock.acquired', 'lock.released')
          AND t.created_at > now() - $2::interval
        ORDER BY t.created_at DESC LIMIT 25`,
      [projectId, lookbackInterval],
    ),
  ]);
  const acq = Number(acqRow.rows[0]?.count ?? '0');
  const conflicts = Number(conflictRow.rows[0]?.count ?? '0');
  return {
    heldNow: Number(heldRow.rows[0]?.count ?? '0'),
    recentAcquisitions: acq,
    recentReleases: Number(relRow.rows[0]?.count ?? '0'),
    conflictRate: acq + conflicts === 0 ? 0 : conflicts / (acq + conflicts),
    recentLedger: ledgerRows.rows.map((r) => ({
      at: r.created_at,
      action: r.action as 'lock.acquired' | 'lock.released',
      holderName: r.composer_name,
      artifactScope: r.artifact_scope ?? [],
      fencingToken: r.fencing_token,
    })),
  };
}

async function loadDecisions(
  pool: Pool,
  projectId: string,
  lookbackInterval: string,
): Promise<DecisionsViewModel> {
  const [lifetimeRow, recentRow, fsRow] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM decisions WHERE project_id = $1`,
      [projectId],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM decisions
        WHERE project_id = $1 AND created_at > now() - $2::interval`,
      [projectId, lookbackInterval],
    ),
    pool.query<{ created_at: Date | null }>(
      `SELECT MAX(created_at) AS created_at FROM telemetry
        WHERE project_id = $1
          AND (action LIKE 'find_similar.%' OR action LIKE 'scale_test.%find_similar%')`,
      [projectId],
    ),
  ]);
  const lastRunAt = fsRow.rows[0]?.created_at ?? null;
  return {
    lifetime: Number(lifetimeRow.rows[0]?.count ?? '0'),
    recentCount: Number(recentRow.rows[0]?.count ?? '0'),
    findSimilarSignal: lastRunAt ? 'has_data' : 'no_data',
    findSimilarLastRunAt: lastRunAt,
  };
}

async function loadTriage(
  pool: Pool,
  projectId: string,
  lookbackInterval: string,
): Promise<TriageViewModel> {
  const [pendingRow, acceptedRow, rejectedRow, bucketRows] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM triage_pending
        WHERE project_id = $1 AND routed_to_contribution_id IS NULL AND rejected_at IS NULL`,
      [projectId],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM telemetry
        WHERE project_id = $1
          AND action IN ('triage.accepted', 'contribution.approval_recorded')
          AND created_at > now() - $2::interval`,
      [projectId, lookbackInterval],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM telemetry
        WHERE project_id = $1 AND action = 'triage.rejected'
          AND created_at > now() - $2::interval`,
      [projectId, lookbackInterval],
    ),
    pool.query<{ bucket: string; count: string }>(
      `SELECT CASE
                WHEN ((classification->>'confidence')::float) < 0.5 THEN 'low'
                WHEN ((classification->>'confidence')::float) < 0.8 THEN 'medium'
                ELSE 'high'
              END AS bucket,
              COUNT(*)::text AS count
         FROM triage_pending
        WHERE project_id = $1 AND routed_to_contribution_id IS NULL AND rejected_at IS NULL
        GROUP BY bucket`,
      [projectId],
    ),
  ]);
  const buckets = { low: 0, medium: 0, high: 0 };
  for (const r of bucketRows.rows) {
    if (r.bucket === 'low' || r.bucket === 'medium' || r.bucket === 'high') {
      buckets[r.bucket] = Number(r.count);
    }
  }
  return {
    pendingCount: Number(pendingRow.rows[0]?.count ?? '0'),
    acceptedLastWindow: Number(acceptedRow.rows[0]?.count ?? '0'),
    rejectedLastWindow: Number(rejectedRow.rows[0]?.count ?? '0'),
    confidenceBuckets: buckets,
  };
}

async function loadSync(
  pool: Pool,
  projectId: string,
  lookbackInterval: string,
): Promise<SyncViewModel> {
  const SYNC_ACTIONS = [
    'doc.published',
    'delivery.synced',
    'delivery.mirrored',
    'delivery.mirror_run',
    'reconcile.run',
  ];
  const { rows } = await pool.query<{
    action: string;
    last_run_at: Date | null;
    last_outcome: string | null;
    error_count: string;
    run_count: string;
  }>(
    `SELECT action,
            MAX(created_at)                                                              AS last_run_at,
            (ARRAY_AGG(outcome ORDER BY created_at DESC))[1]                             AS last_outcome,
            COUNT(*) FILTER (WHERE outcome = 'error' AND created_at > now() - $2::interval)::text AS error_count,
            COUNT(*) FILTER (WHERE created_at > now() - $2::interval)::text              AS run_count
       FROM telemetry
      WHERE project_id = $1 AND action = ANY($3::text[])
      GROUP BY action`,
    [projectId, lookbackInterval, SYNC_ACTIONS],
  );
  const byAction = new Map(rows.map((r) => [r.action, r]));
  return {
    scripts: SYNC_ACTIONS.map((action) => {
      const r = byAction.get(action);
      const runs = Number(r?.run_count ?? '0');
      const errs = Number(r?.error_count ?? '0');
      return {
        action,
        lastRunAt: r?.last_run_at ?? null,
        lastOutcome: r?.last_outcome ?? null,
        errorRateLastWindow: runs === 0 ? 0 : errs / runs,
        runCountLastWindow: runs,
      };
    }),
  };
}

async function loadVector(
  pool: Pool,
  projectId: string,
  lookbackInterval: string,
): Promise<VectorViewModel> {
  const [countRow, byKindRows, recentRow, modelsRow] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM embeddings WHERE project_id = $1`,
      [projectId],
    ).catch(() => ({ rows: [{ count: '0' }] })),
    pool.query<{ source_kind: string; count: string }>(
      `SELECT source_kind::text AS source_kind, COUNT(*)::text AS count FROM embeddings
        WHERE project_id = $1 GROUP BY source_kind`,
      [projectId],
    ).catch(() => ({ rows: [] as Array<{ source_kind: string; count: string }> })),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM embeddings
        WHERE project_id = $1 AND created_at > now() - $2::interval`,
      [projectId, lookbackInterval],
    ).catch(() => ({ rows: [{ count: '0' }] })),
    pool.query<{ embedding_model_version: string }>(
      `SELECT DISTINCT embedding_model_version FROM embeddings WHERE project_id = $1 LIMIT 5`,
      [projectId],
    ).catch(() => ({ rows: [] as Array<{ embedding_model_version: string }> })),
  ]);
  const bySourceKind: Record<string, number> = {};
  for (const r of byKindRows.rows) bySourceKind[r.source_kind] = Number(r.count);
  return {
    rowCount: Number(countRow.rows[0]?.count ?? '0'),
    bySourceKind,
    recentInserts: Number(recentRow.rows[0]?.count ?? '0'),
    modelVersions: modelsRow.rows.map((r) => r.embedding_model_version),
  };
}

async function loadCost(
  pool: Pool,
  projectId: string,
  lookbackInterval: string,
  windowSeconds: number,
): Promise<CostViewModel> {
  const [aggRow, byActionRows, byComposerRows] = await Promise.all([
    pool.query<{
      total_usd: string | null;
      total_input: string | null;
      total_output: string | null;
      n: string;
    }>(
      `SELECT COALESCE(SUM((metadata->>'cost_usd')::float), 0)::text       AS total_usd,
              COALESCE(SUM((metadata->>'tokens_input')::int), 0)::text     AS total_input,
              COALESCE(SUM((metadata->>'tokens_output')::int), 0)::text    AS total_output,
              COUNT(*) FILTER (WHERE metadata ? 'cost_usd')::text          AS n
         FROM telemetry
        WHERE project_id = $1 AND created_at > now() - $2::interval`,
      [projectId, lookbackInterval],
    ),
    pool.query<{
      action_class: string;
      usd: string;
      input: string;
      output: string;
    }>(
      `SELECT split_part(action, '.', 1) AS action_class,
              COALESCE(SUM((metadata->>'cost_usd')::float), 0)::text    AS usd,
              COALESCE(SUM((metadata->>'tokens_input')::int), 0)::text  AS input,
              COALESCE(SUM((metadata->>'tokens_output')::int), 0)::text AS output
         FROM telemetry
        WHERE project_id = $1 AND created_at > now() - $2::interval
          AND metadata ? 'cost_usd'
        GROUP BY action_class ORDER BY SUM((metadata->>'cost_usd')::float) DESC LIMIT 10`,
      [projectId, lookbackInterval],
    ),
    pool.query<{ composer_name: string; usd: string }>(
      `SELECT COALESCE(c.display_name, '(system)') AS composer_name,
              COALESCE(SUM((t.metadata->>'cost_usd')::float), 0)::text AS usd
         FROM telemetry t LEFT JOIN composers c ON c.id = t.composer_id
        WHERE t.project_id = $1 AND t.created_at > now() - $2::interval
          AND t.metadata ? 'cost_usd'
        GROUP BY c.display_name ORDER BY SUM((t.metadata->>'cost_usd')::float) DESC LIMIT 10`,
      [projectId, lookbackInterval],
    ),
  ]);
  const n = Number(aggRow.rows[0]?.n ?? '0');
  return {
    windowSeconds,
    totalUsd: Number(aggRow.rows[0]?.total_usd ?? '0'),
    totalTokensInput: Number(aggRow.rows[0]?.total_input ?? '0'),
    totalTokensOutput: Number(aggRow.rows[0]?.total_output ?? '0'),
    byActionClass: byActionRows.rows.map((r) => ({
      actionClass: r.action_class,
      usd: Number(r.usd),
      tokensInput: Number(r.input),
      tokensOutput: Number(r.output),
    })),
    byComposer: byComposerRows.rows.map((r) => ({
      composerName: r.composer_name,
      usd: Number(r.usd),
    })),
    signal: n > 0 ? 'has_data' : 'no_data',
  };
}
