// Observability dashboard config loader (ARCH 8.2 / 8.3).
//
// Reads the observability block from .atelier/config.yaml. The dashboard
// uses these values to populate threshold pills (yellow at 80% of envelope,
// red at 100%) and to bound the recent-event lookback windows.
//
// Numbers default to the v1 envelope at ARCH 9.8 + scale-ceiling-envelope-v1.md;
// adopters on Free or Enterprise tiers (~1/4x or ~10x respectively) override
// in their own config.yaml without forking the prototype.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface ObservabilityThresholds {
  sessionsActivePerProject: number;
  sessionsActivePerGuild: number;
  contributionsLifetimePerProject: number;
  contributionsLifetimePerGuild: number;
  decisionsLifetimePerProject: number;
  locksHeldConcurrentPerProject: number;
  vectorIndexRowsPerGuild: number;
  triagePendingBacklog: number;
  syncLagSecondsP95: number;
  costUsdPerDayPerProject: number;
}

export interface ObservabilityConfig {
  thresholds: ObservabilityThresholds;
  lookbackSeconds: number;
}

export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  thresholds: {
    sessionsActivePerProject: 20,
    sessionsActivePerGuild: 100,
    contributionsLifetimePerProject: 10000,
    contributionsLifetimePerGuild: 50000,
    decisionsLifetimePerProject: 500,
    locksHeldConcurrentPerProject: 20,
    vectorIndexRowsPerGuild: 100000,
    triagePendingBacklog: 25,
    syncLagSecondsP95: 300,
    costUsdPerDayPerProject: 10,
  },
  lookbackSeconds: 86400,
};

interface YamlObservabilityBlock {
  thresholds?: Partial<{
    sessions_active_per_project: number;
    sessions_active_per_guild: number;
    contributions_lifetime_per_project: number;
    contributions_lifetime_per_guild: number;
    decisions_lifetime_per_project: number;
    locks_held_concurrent_per_project: number;
    vector_index_rows_per_guild: number;
    triage_pending_backlog: number;
    sync_lag_seconds_p95: number;
    cost_usd_per_day_per_project: number;
  }>;
  lookback_seconds?: number;
}

export function loadObservabilityConfig(repoRoot: string): ObservabilityConfig {
  const path = join(repoRoot, '.atelier', 'config.yaml');
  if (!existsSync(path)) return DEFAULT_OBSERVABILITY_CONFIG;
  const raw = parseYaml(readFileSync(path, 'utf-8')) as { observability?: YamlObservabilityBlock } | null;
  const block = raw?.observability;
  if (!block) return DEFAULT_OBSERVABILITY_CONFIG;
  const t = block.thresholds ?? {};
  const d = DEFAULT_OBSERVABILITY_CONFIG.thresholds;
  return {
    thresholds: {
      sessionsActivePerProject: t.sessions_active_per_project ?? d.sessionsActivePerProject,
      sessionsActivePerGuild: t.sessions_active_per_guild ?? d.sessionsActivePerGuild,
      contributionsLifetimePerProject:
        t.contributions_lifetime_per_project ?? d.contributionsLifetimePerProject,
      contributionsLifetimePerGuild:
        t.contributions_lifetime_per_guild ?? d.contributionsLifetimePerGuild,
      decisionsLifetimePerProject:
        t.decisions_lifetime_per_project ?? d.decisionsLifetimePerProject,
      locksHeldConcurrentPerProject:
        t.locks_held_concurrent_per_project ?? d.locksHeldConcurrentPerProject,
      vectorIndexRowsPerGuild: t.vector_index_rows_per_guild ?? d.vectorIndexRowsPerGuild,
      triagePendingBacklog: t.triage_pending_backlog ?? d.triagePendingBacklog,
      syncLagSecondsP95: t.sync_lag_seconds_p95 ?? d.syncLagSecondsP95,
      costUsdPerDayPerProject: t.cost_usd_per_day_per_project ?? d.costUsdPerDayPerProject,
    },
    lookbackSeconds: block.lookback_seconds ?? DEFAULT_OBSERVABILITY_CONFIG.lookbackSeconds,
  };
}

export { severityFor, type Severity } from "../../../../scripts/lib/severity.ts";

