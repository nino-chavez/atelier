#!/usr/bin/env -S npx tsx
//
// reconcile: bidirectional drift detector + branch-reaping pass.
//
// Per ARCH 6.5 + scripts/README.md:
//   1. Compare registry fields vs canonical repo fields. Report divergences.
//      Never auto-write.
//   2. Optional branch-reaping pass per BRD-OPEN-QUESTIONS section 24
//      recommendation: list `atelier/*` remote branches, cross-reference
//      with contributions, identify branches eligible for deletion based
//      on contribution state (merged/rejected) and age. Default OFF at
//      v1 (opt-in until a team has operational evidence of what is safe
//      to delete). Dry-run mode lists candidates without acting.
//
// Config surface (env vars at M1; .atelier/config.yaml at M2):
//   ATELIER_RECONCILE_BRANCH_REAPING_ENABLED       default: false
//   ATELIER_RECONCILE_BRANCH_REAPING_MAX_AGE_DAYS  default: 30
//   ATELIER_RECONCILE_BRANCH_REAPING_DRY_RUN       default: true (when enabled)
//
// CLI:
//   reconcile [--once]                            Reads canonical and datastore, reports drift
//   reconcile --reap-branches                     Force-enable branch reaping (CLI override)
//   reconcile --reap-branches --apply             Force-disable dry-run (CLI override)
//   reconcile --max-age-days N                    Branch-age threshold
//   reconcile --adapter NAME                      Delivery adapter for branch enumeration

import { Client } from 'pg';
import { promises as fs } from 'node:fs';
import { resolveDeliveryAdapter } from './lib/adapters.ts';

interface Args {
  reapBranches: boolean | null;     // null = use env default
  apply: boolean | null;            // null = use env default (which is dry-run when reaping enabled)
  maxAgeDays: number;
  adapter: string;
  traceabilityPath: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    reapBranches: null,
    apply: null,
    maxAgeDays: parseEnvInt('ATELIER_RECONCILE_BRANCH_REAPING_MAX_AGE_DAYS', 30),
    adapter: process.env.ATELIER_DELIVERY_ADAPTER ?? 'noop',
    traceabilityPath: process.env.ATELIER_TRACEABILITY_PATH ?? 'traceability.json',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--once') {/* default */}
    else if (a === '--reap-branches') args.reapBranches = true;
    else if (a === '--no-reap-branches') args.reapBranches = false;
    else if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a === '--max-age-days') args.maxAgeDays = Number(argv[++i]);
    else if (a === '--adapter') args.adapter = argv[++i]!;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: reconcile [--reap-branches] [--apply] [--max-age-days N] [--adapter NAME]');
      process.exit(0);
    }
  }
  return args;
}

function parseEnvBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

function parseEnvInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

interface DriftReport {
  driftDetected: number;
  branchesScanned: number;
  branchesEligibleForReaping: number;
  branchesReaped: number;
  details: DriftDetail[];
}

interface DriftDetail {
  category: 'orphan_trace_id' | 'orphan_reversal' | 'reaping_candidate' | 'reaped';
  message: string;
  context: Record<string, unknown>;
}

async function detectTraceIdDrift(opts: {
  db: Client;
  projectId: string;
  traceabilityPath: string;
}): Promise<DriftDetail[]> {
  const { db, projectId, traceabilityPath } = opts;
  const out: DriftDetail[] = [];

  // Load known trace IDs from traceability.json. If file missing, skip
  // this pass with a single advisory.
  let knownTraceIds: Set<string>;
  try {
    const raw = await fs.readFile(traceabilityPath, 'utf8');
    const json = JSON.parse(raw) as { entries?: { id: string }[] };
    knownTraceIds = new Set((json.entries ?? []).map((e) => e.id));
  } catch (err) {
    out.push({
      category: 'orphan_trace_id',
      message: `traceability.json not loadable; skipping orphan-trace check`,
      context: { path: traceabilityPath, error: String(err) },
    });
    return out;
  }

  if (knownTraceIds.size === 0) return out;

  const { rows } = await db.query<{ id: string; trace_ids: string[]; kind: string }>(
    `SELECT id, trace_ids, kind FROM contributions WHERE project_id = $1`,
    [projectId],
  );
  for (const row of rows) {
    const orphans = row.trace_ids.filter((t) => !knownTraceIds.has(t));
    if (orphans.length > 0) {
      out.push({
        category: 'orphan_trace_id',
        message: `contribution references trace_ids that don't resolve in traceability.json`,
        context: { contributionId: row.id, kind: row.kind, orphans },
      });
    }
  }
  return out;
}

async function detectReversalDrift(opts: { db: Client; projectId: string }): Promise<DriftDetail[]> {
  const { db, projectId } = opts;
  const out: DriftDetail[] = [];

  const { rows } = await db.query<{ id: string; reverses: string }>(
    `SELECT d.id, d.reverses
       FROM decisions d
      WHERE d.project_id = $1
        AND d.reverses IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM decisions r WHERE r.id = d.reverses AND r.project_id = $1
        )`,
    [projectId],
  );
  for (const row of rows) {
    out.push({
      category: 'orphan_reversal',
      message: `decision reverses a target that no longer exists in this project`,
      context: { decisionId: row.id, reverses: row.reverses },
    });
  }
  return out;
}

async function reapBranches(opts: {
  db: Client;
  projectId: string;
  adapterName: string;
  maxAgeDays: number;
  apply: boolean;
}): Promise<{ scanned: number; eligible: number; reaped: number; details: DriftDetail[] }> {
  const { db, projectId, adapterName, maxAgeDays, apply } = opts;
  const adapter = resolveDeliveryAdapter(adapterName);
  if (!adapter.listManagedBranches) {
    return { scanned: 0, eligible: 0, reaped: 0, details: [{
      category: 'reaping_candidate',
      message: `adapter "${adapter.name}" does not implement listManagedBranches; skipping reaping pass`,
      context: { adapter: adapter.name },
    }] };
  }

  const branches = (await adapter.listManagedBranches()) ?? [];
  const ageThresholdMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - ageThresholdMs;

  // Cross-reference each branch with contributions. Reaping criteria per
  // BRD-OPEN-QUESTIONS section 24:
  //   - branch's contribution_id resolves to a merged or rejected row, OR
  //   - branch has no resolving contribution (orphan)
  //   AND
  //   - branch has no open PR
  //   AND
  //   - last commit older than max_age_days
  const details: DriftDetail[] = [];
  let eligible = 0;
  let reaped = 0;

  for (const branch of branches) {
    const lastCommitTime = new Date(branch.lastCommitAt).getTime();
    if (lastCommitTime > cutoff) continue;
    if (branch.hasOpenPr) continue;

    const contributionId = extractContributionIdFromRef(branch.ref);
    let eligibleReason: string | null = null;
    if (contributionId === null) {
      eligibleReason = 'orphan: branch ref does not encode a contribution id';
    } else {
      const { rows } = await db.query<{ state: string }>(
        `SELECT state FROM contributions WHERE id = $1 AND project_id = $2`,
        [contributionId, projectId],
      );
      const row = rows[0];
      if (!row) {
        eligibleReason = `orphan: contribution ${contributionId} not found in project`;
      } else if (row.state === 'merged' || row.state === 'rejected') {
        eligibleReason = `terminal state: ${row.state}`;
      }
    }
    if (eligibleReason === null) continue;

    eligible += 1;
    details.push({
      category: 'reaping_candidate',
      message: `branch eligible for reaping`,
      context: {
        ref: branch.ref,
        lastCommitAt: branch.lastCommitAt,
        ageDays: Math.floor((Date.now() - lastCommitTime) / 86_400_000),
        reason: eligibleReason,
        action: apply ? 'will-delete' : 'dry-run',
      },
    });

    if (apply && adapter.deleteRemoteBranch) {
      try {
        await adapter.deleteRemoteBranch(branch.ref);
        reaped += 1;
        details.push({
          category: 'reaped',
          message: `branch deleted`,
          context: { ref: branch.ref, reason: eligibleReason },
        });
      } catch (err) {
        details.push({
          category: 'reaping_candidate',
          message: `delete failed for ${branch.ref}`,
          context: { ref: branch.ref, error: String(err) },
        });
      }
    }
  }

  return { scanned: branches.length, eligible, reaped, details };
}

function extractContributionIdFromRef(ref: string): string | null {
  // Convention per scripts/README.md throwaway-branches: `<kind>/<trace>-<short>`
  // and the M1 contribution-branch convention `atelier/<contribution-id>`.
  // Try both shapes; return null on no match.
  const atelierMatch = ref.match(/^atelier\/([0-9a-f-]{36})$/);
  if (atelierMatch && atelierMatch[1]) return atelierMatch[1];
  return null;
}

async function recordTelemetry(db: Client, projectId: string, report: DriftReport): Promise<void> {
  await db.query(
    `INSERT INTO telemetry (project_id, action, outcome, metadata)
     VALUES ($1, 'reconcile.run', $2, $3::jsonb)`,
    [
      projectId,
      report.driftDetected > 0 || report.branchesEligibleForReaping > 0 ? 'drift_detected' : 'ok',
      JSON.stringify(report),
    ],
  );
}

export async function reconcile(opts: {
  db: Client;
  projectId: string;
  args: Args;
  reapingEnabled: boolean;
  reapingApply: boolean;
}): Promise<DriftReport> {
  const traceDrift = await detectTraceIdDrift({
    db: opts.db,
    projectId: opts.projectId,
    traceabilityPath: opts.args.traceabilityPath,
  });
  const reversalDrift = await detectReversalDrift({ db: opts.db, projectId: opts.projectId });

  const reapResult = opts.reapingEnabled
    ? await reapBranches({
        db: opts.db,
        projectId: opts.projectId,
        adapterName: opts.args.adapter,
        maxAgeDays: opts.args.maxAgeDays,
        apply: opts.reapingApply,
      })
    : { scanned: 0, eligible: 0, reaped: 0, details: [] };

  return {
    driftDetected: traceDrift.length + reversalDrift.length,
    branchesScanned: reapResult.scanned,
    branchesEligibleForReaping: reapResult.eligible,
    branchesReaped: reapResult.reaped,
    details: [...traceDrift, ...reversalDrift, ...reapResult.details],
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectId = process.env.ATELIER_PROJECT_ID;
  if (!projectId) {
    console.error('error: ATELIER_PROJECT_ID env var is required');
    process.exit(1);
  }

  // §24 default-off resolution
  const envReapingEnabled = parseEnvBool('ATELIER_RECONCILE_BRANCH_REAPING_ENABLED', false);
  const envReapingDryRun  = parseEnvBool('ATELIER_RECONCILE_BRANCH_REAPING_DRY_RUN', true);
  const reapingEnabled = args.reapBranches ?? envReapingEnabled;
  const reapingApply   = (args.apply ?? !envReapingDryRun) && reapingEnabled;

  const dbUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  try {
    const report = await reconcile({ db, projectId, args, reapingEnabled, reapingApply });
    await recordTelemetry(db, projectId, report);

    console.log(JSON.stringify({
      driftDetected: report.driftDetected,
      branchesScanned: report.branchesScanned,
      branchesEligibleForReaping: report.branchesEligibleForReaping,
      branchesReaped: report.branchesReaped,
      reapingEnabled,
      reapingApply,
    }, null, 2));

    for (const d of report.details) {
      console.log(`  [${d.category}] ${d.message} ${JSON.stringify(d.context)}`);
    }
  } finally {
    await db.end();
  }
}

if (process.argv[1]?.endsWith('reconcile.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { parseArgs, detectTraceIdDrift, detectReversalDrift, reapBranches, extractContributionIdFromRef };
