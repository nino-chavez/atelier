// `atelier upgrade` (US-11.10; BUILD-SEQUENCE §9; E2 polished form).
//
// Operator-facing CLI for the migration runner substrate landed in E1
// (`scripts/migration/runner.ts` + `atelier_schema_versions` tracking
// table). Resolves BRD-OPEN-QUESTIONS §29 from PARTIAL → RESOLVED.
//
// Default action is `--check` (read-only status). `--apply` is opt-in;
// pairing this with the doctor pattern (diagnostic-only-by-default safe)
// keeps the destructive path explicit. Atelier coordinates a team's
// substrate; a bad migration locks everyone out, so the safe default
// matters more than the ergonomic default.
//
// What this command does NOT do:
//   - DOWN migrations / rollback (per ADR-005 append-only; v1.x next-level)
//   - Auto-upgrade on init (operator-driven only; auto-upgrade is unsafe)
//   - Cross-deploy coordination (apply same migration to staging + prod
//     atomically — adopter-side decision; out-of-scope here)
//
// Cross-references:
//   - ADR-005 (append-only discipline; informs no-rollback)
//   - ADR-027 (Supabase Postgres reference)
//   - ADR-029 (GCP-portability — uses pg.Client direct, no Supabase helpers)
//   - BRD-OPEN-QUESTIONS §29 (the open question this resolves)
//   - docs/architecture/schema/migration-system.md (E1 contract)
//   - docs/user/guides/upgrade-schema.md (operator runbook)
//   - scripts/migration/runner.ts (substrate this CLI consumes)

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { parse as parseYaml } from 'yaml';
import {
  checkDocker,
  checkSupabaseCli,
  checkSupabaseRunning,
  type PreflightStatus,
} from '../lib/preflight.ts';
import {
  MigrationRunner,
  type AppliedMigration,
  type Migration,
  type MigrationStatus,
} from '../../migration/runner.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CONFIG_YAML_PATH = resolve(REPO_ROOT, '.atelier', 'config.yaml');
const DEFAULT_LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export const upgradeUsage = `atelier upgrade — apply schema migrations from supabase/migrations/

Usage:
  atelier upgrade [--check | --apply] [options]

Actions (mutually exclusive; default --check):
  --check                  Read-only. Print pending / modified / missing /
                           up-to-date status. Exits 0 when datastore is
                           up-to-date; 1 otherwise (so CI can gate).
  --apply                  Apply pending migrations in order. Refuses to
                           proceed when modified migrations are detected
                           unless --force-apply-modified is passed.

Options:
  --force-apply-modified   Required to proceed with --apply when the runner
                           detects on-disk migrations whose hash differs
                           from the recorded hash (adopter-edited from
                           upstream). Opt-in acknowledgment.
  --remote                 Force CLOUD mode. Disables LOCAL preflight and
                           requires POSTGRES_URL to point at a
                           non-localhost Postgres. Default: auto-detect
                           from POSTGRES_URL host.
  --dry-run                With --apply: print the planned apply sequence
                           without executing. With --check: same as --check.
  --json                   Machine-readable JSON output.
  -h, --help               Show this help.

Mode auto-detection:
  LOCAL  — when POSTGRES_URL is unset or points at 127.0.0.1
           (default ${DEFAULT_LOCAL_DB_URL})
  CLOUD  — when POSTGRES_URL points at a non-localhost host,
           OR --remote is passed

Pre-flight (LOCAL mode):
  - docker daemon reachable
  - supabase CLI installed
  - supabase services running

Pre-flight (CLOUD mode):
  - POSTGRES_URL set to a non-localhost Postgres URL

Behavior contract:
  Exit 0 on:
    - --check: datastore up-to-date (no pending / modified / missing)
    - --apply: all pending migrations applied successfully
    - --apply with no pending and no modified
    - --dry-run (always)
  Exit 1 on:
    - --check: any divergence (pending / modified / missing detected)
    - --apply: SQL error during apply, or modified migrations detected
      without --force-apply-modified
  Exit 2 on argument or precondition error (unknown flag, conflicting
  actions, preflight failure, missing POSTGRES_URL in CLOUD mode).

Cross-references:
  - ADR-005 (append-only; no rollback at v1; v1.x next-level)
  - ADR-027 (Supabase Postgres reference)
  - BRD-OPEN-QUESTIONS §29 (the open question this resolves)
  - docs/architecture/schema/migration-system.md (E1 substrate contract)
  - docs/user/guides/upgrade-schema.md (operator runbook)
`;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

type Action = 'check' | 'apply';
type Mode = 'local' | 'cloud';

interface ParsedArgs {
  action: Action;
  forceApplyModified: boolean;
  remote: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    action: 'check',
    forceApplyModified: false,
    remote: false,
    dryRun: false,
    json: false,
    help: false,
  };
  let actionExplicit = false;
  for (const a of args) {
    switch (a) {
      case '--check':
        if (actionExplicit && out.action !== 'check') {
          throw new Error('cannot combine --check and --apply (mutually exclusive)');
        }
        out.action = 'check';
        actionExplicit = true;
        break;
      case '--apply':
        if (actionExplicit && out.action !== 'apply') {
          throw new Error('cannot combine --check and --apply (mutually exclusive)');
        }
        out.action = 'apply';
        actionExplicit = true;
        break;
      case '--force-apply-modified': out.forceApplyModified = true; break;
      case '--remote': out.remote = true; break;
      case '--dry-run': out.dryRun = true; break;
      case '--json': out.json = true; break;
      case '--help':
      case '-h': out.help = true; break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mode detection + datastore URL resolution
// ---------------------------------------------------------------------------

function resolveDatastoreUrl(remote: boolean): { url: string; mode: Mode } {
  const env = process.env.POSTGRES_URL;
  if (remote) {
    if (!env) {
      throw new Error(
        '--remote requires POSTGRES_URL to be set; export it or drop --remote for LOCAL mode',
      );
    }
    return { url: env, mode: 'cloud' };
  }
  if (!env) {
    return { url: DEFAULT_LOCAL_DB_URL, mode: 'local' };
  }
  // Auto-detect: localhost / 127.0.0.1 host indicates LOCAL.
  let mode: Mode = 'cloud';
  try {
    const u = new URL(env);
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1') {
      mode = 'local';
    }
  } catch {
    // Malformed URL: treat as cloud (will fail to connect; better to surface
    // the connection error than to mis-classify mode).
    mode = 'cloud';
  }
  return { url: env, mode };
}

function redactDatastoreUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return raw.replace(/(:\/\/[^:]+:)([^@]+)(@)/, '$1***$3');
  }
}

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

interface LocalPreflight {
  docker: PreflightStatus;
  supabaseCli: PreflightStatus;
  supabaseRunning: PreflightStatus;
  ok: boolean;
}

function runLocalPreflight(): LocalPreflight {
  const docker = checkDocker();
  const supabaseCli = checkSupabaseCli();
  const supabaseRunning = docker.ok && supabaseCli.ok ? checkSupabaseRunning() : { ok: false, detail: 'skipped' };
  return {
    docker,
    supabaseCli,
    supabaseRunning,
    ok: docker.ok && supabaseCli.ok && supabaseRunning.ok,
  };
}

function formatLocalPreflight(p: LocalPreflight): string {
  const lines: string[] = ['Pre-flight (LOCAL):'];
  const fmt = (label: string, s: PreflightStatus): string => {
    const icon = s.ok ? '[OK]  ' : '[!!]  ';
    return `  ${icon}${label.padEnd(20)} ${s.detail ?? ''}`;
  };
  lines.push(fmt('docker', p.docker));
  lines.push(fmt('supabase CLI', p.supabaseCli));
  lines.push(fmt('supabase running', p.supabaseRunning));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Config + operator email resolution
// ---------------------------------------------------------------------------

interface ConfigYaml {
  project?: { template_version?: string };
}

function readTemplateVersion(): string {
  if (!existsSync(CONFIG_YAML_PATH)) {
    return 'unknown';
  }
  try {
    const body = readFileSync(CONFIG_YAML_PATH, 'utf8');
    const parsed = parseYaml(body) as ConfigYaml | null;
    const v = parsed?.project?.template_version;
    return typeof v === 'string' && v.length > 0 ? v : 'unknown';
  } catch {
    return 'unknown';
  }
}

function resolveAppliedBy(): string {
  const env = process.env.ATELIER_OPERATOR_EMAIL;
  if (env && env.trim().length > 0) return env.trim();
  const r = spawnSync('git', ['config', 'user.email'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status === 0) {
    const email = r.stdout.trim();
    if (email.length > 0) return email;
  }
  return 'manual';
}

// ---------------------------------------------------------------------------
// Status rendering
// ---------------------------------------------------------------------------

interface StatusSummary {
  mode: Mode;
  datastoreUrl: string;
  templateVersion: string;
  migrationsOnDisk: number;
  migrationsApplied: number;
  upToDateCount: number;
  pending: { filename: string; sha256Prefix: string }[];
  modified: { filename: string; localShaPrefix: string; appliedShaPrefix: string }[];
  missing: { filename: string; appliedAt: string }[];
}

function buildSummary(
  mode: Mode,
  datastoreUrl: string,
  templateVersion: string,
  discovered: Migration[],
  applied: AppliedMigration[],
  status: MigrationStatus,
): StatusSummary {
  const upToDate = Math.max(0, discovered.length - status.pending.length - status.modified.length);
  return {
    mode,
    datastoreUrl: redactDatastoreUrl(datastoreUrl),
    templateVersion,
    migrationsOnDisk: discovered.length,
    migrationsApplied: applied.length,
    upToDateCount: upToDate,
    pending: status.pending.map((m) => ({ filename: m.filename, sha256Prefix: m.sha256.slice(0, 12) })),
    modified: status.modified.map((m) => ({
      filename: m.filename,
      localShaPrefix: m.localSha256.slice(0, 12),
      appliedShaPrefix: m.appliedSha256.slice(0, 12),
    })),
    missing: status.missing.map((m) => ({ filename: m.filename, appliedAt: m.appliedAt.toISOString() })),
  };
}

function renderStatusHuman(s: StatusSummary): string {
  const lines: string[] = [];
  lines.push('atelier upgrade -- schema migration status');
  lines.push('-----------------------------------------');
  lines.push(`Mode:                  ${s.mode.toUpperCase()}`);
  lines.push(`Datastore:             ${s.datastoreUrl}`);
  lines.push(`Template version:      ${s.templateVersion}`);
  lines.push(`Migrations on disk:    ${s.migrationsOnDisk}`);
  lines.push(`Migrations applied:    ${s.migrationsApplied}`);
  lines.push(`Status:`);
  lines.push(`  up-to-date:          ${s.upToDateCount} migration(s)`);
  lines.push(`  pending:             ${s.pending.length} migration(s)`);
  for (const p of s.pending) {
    lines.push(`    ${p.filename} (sha256: ${p.sha256Prefix}...)`);
  }
  lines.push(`  modified:            ${s.modified.length} migration(s) -- adopter-edited from upstream`);
  for (const m of s.modified) {
    lines.push(`    ${m.filename} (local: ${m.localShaPrefix}... / applied: ${m.appliedShaPrefix}...)`);
  }
  lines.push(`  missing:             ${s.missing.length} entry/entries -- applied but file removed from disk`);
  for (const m of s.missing) {
    lines.push(`    ${m.filename} (applied ${m.appliedAt})`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Apply path
// ---------------------------------------------------------------------------

interface ApplyOutcome {
  appliedFilenames: string[];
  failedFilename?: string;
  failureDetail?: string;
}

async function applyPending(
  runner: MigrationRunner,
  client: Client,
  pending: Migration[],
  appliedBy: string,
  templateVersion: string,
  json: boolean,
): Promise<ApplyOutcome> {
  const out: ApplyOutcome = { appliedFilenames: [] };
  for (const m of pending) {
    if (!json) console.log(`[atelier upgrade] applying ${m.filename}...`);
    try {
      await runner.applyMigration(m, client, { appliedBy, templateVersion });
      out.appliedFilenames.push(m.filename);
    } catch (err) {
      out.failedFilename = m.filename;
      out.failureDetail = err instanceof Error ? err.message : String(err);
      return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface UpgradeJsonResult {
  ok: boolean;
  action: Action;
  mode: Mode;
  datastoreUrl: string;
  templateVersion: string;
  dryRun?: boolean;
  status?: StatusSummary;
  apply?: {
    plannedFilenames: string[];
    appliedFilenames?: string[];
    failedFilename?: string;
    failureDetail?: string;
    skippedDueToModified?: boolean;
  };
  preflight?: { ok: boolean; detail?: string };
  error?: string;
}

export async function runUpgrade(args: readonly string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    console.error(`atelier upgrade: ${err instanceof Error ? err.message : err}`);
    console.error('');
    console.error(upgradeUsage);
    return 2;
  }

  if (parsed.help) {
    console.log(upgradeUsage);
    return 0;
  }

  // ------------------ Resolve mode + datastore URL ------------------
  let resolved: { url: string; mode: Mode };
  try {
    resolved = resolveDatastoreUrl(parsed.remote);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (parsed.json) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.error(`atelier upgrade: ${msg}`);
    }
    return 2;
  }

  const templateVersion = readTemplateVersion();

  // ------------------ Pre-flight ------------------
  if (resolved.mode === 'local') {
    const pf = runLocalPreflight();
    if (!pf.ok) {
      const failingDetail = !pf.docker.ok
        ? pf.docker.detail
        : !pf.supabaseCli.ok
        ? pf.supabaseCli.detail
        : pf.supabaseRunning.detail;
      const hint = 'run `atelier dev` to bring the local substrate up';
      if (parsed.json) {
        const out: UpgradeJsonResult = {
          ok: false,
          action: parsed.action,
          mode: resolved.mode,
          datastoreUrl: redactDatastoreUrl(resolved.url),
          templateVersion,
          preflight: { ok: false, detail: `${failingDetail}; ${hint}` },
          error: 'preflight failed',
        };
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.error(formatLocalPreflight(pf));
        console.error('');
        console.error(`atelier upgrade: pre-flight failed -- ${failingDetail}`);
        console.error(`Hint: ${hint}.`);
      }
      return 2;
    }
    if (!parsed.json) {
      console.log(formatLocalPreflight(pf));
      console.log('');
    }
  } else {
    // CLOUD mode preflight: just confirm a non-localhost URL is set (already
    // guaranteed by resolveDatastoreUrl when --remote is passed; otherwise
    // the env was non-localhost so it's also fine).
    if (!parsed.json) {
      console.log('Pre-flight (CLOUD): POSTGRES_URL set to non-localhost host');
      console.log('');
    }
  }

  // ------------------ Connect + compute status ------------------
  const client = new Client({ connectionString: resolved.url });
  try {
    await client.connect();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (parsed.json) {
      const out: UpgradeJsonResult = {
        ok: false,
        action: parsed.action,
        mode: resolved.mode,
        datastoreUrl: redactDatastoreUrl(resolved.url),
        templateVersion,
        error: `failed to connect to datastore: ${msg}`,
      };
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.error(`atelier upgrade: failed to connect to datastore: ${msg}`);
    }
    return 2;
  }

  try {
    const runner = new MigrationRunner({
      databaseUrl: resolved.url,
      repoRoot: REPO_ROOT,
      templateVersion,
      appliedBy: resolveAppliedBy(),
      client,
    });

    const [discovered, applied] = await Promise.all([
      runner.discoverMigrations(),
      runner.loadAppliedMigrations(),
    ]);
    const status = await runner.computeStatus();
    const summary = buildSummary(resolved.mode, resolved.url, templateVersion, discovered, applied, status);

    // ------------------ --check (default) ------------------
    if (parsed.action === 'check') {
      const upToDate = status.pending.length === 0 && status.modified.length === 0 && status.missing.length === 0;
      if (parsed.json) {
        const out: UpgradeJsonResult = {
          ok: upToDate,
          action: 'check',
          mode: resolved.mode,
          datastoreUrl: redactDatastoreUrl(resolved.url),
          templateVersion,
          status: summary,
        };
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.log(renderStatusHuman(summary));
      }
      return upToDate ? 0 : 1;
    }

    // ------------------ --apply ------------------
    // Render status first (always; both paths show the snapshot)
    if (!parsed.json) {
      console.log(renderStatusHuman(summary));
      console.log('');
    }

    // Modified gate
    if (status.modified.length > 0 && !parsed.forceApplyModified) {
      const msg = `${status.modified.length} modified migration(s) detected. Apply will refuse to proceed without --force-apply-modified.`;
      if (parsed.json) {
        const out: UpgradeJsonResult = {
          ok: false,
          action: 'apply',
          mode: resolved.mode,
          datastoreUrl: redactDatastoreUrl(resolved.url),
          templateVersion,
          status: summary,
          apply: {
            plannedFilenames: status.pending.map((m) => m.filename),
            skippedDueToModified: true,
          },
          error: msg,
        };
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.error(`atelier upgrade: ${msg}`);
        console.error('Inspect each modified migration (`git log --diff <file>`),');
        console.error('then either revert your local changes or re-run with');
        console.error('--force-apply-modified to acknowledge the divergence.');
      }
      return 1;
    }

    // No-op
    if (status.pending.length === 0) {
      if (parsed.json) {
        const out: UpgradeJsonResult = {
          ok: true,
          action: 'apply',
          mode: resolved.mode,
          datastoreUrl: redactDatastoreUrl(resolved.url),
          templateVersion,
          status: summary,
          apply: { plannedFilenames: [], appliedFilenames: [] },
        };
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.log('atelier upgrade: no pending migrations; datastore is up-to-date');
      }
      return 0;
    }

    // Dry-run path
    if (parsed.dryRun) {
      const planned = status.pending.map((m) => m.filename);
      if (parsed.json) {
        const out: UpgradeJsonResult = {
          ok: true,
          action: 'apply',
          mode: resolved.mode,
          datastoreUrl: redactDatastoreUrl(resolved.url),
          templateVersion,
          dryRun: true,
          status: summary,
          apply: { plannedFilenames: planned },
        };
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.log(`atelier upgrade -- DRY-RUN: would apply ${planned.length} migration(s):`);
        for (const f of planned) console.log(`  ${f}`);
        console.log('');
        console.log('No mutations performed. Re-run without --dry-run to apply.');
      }
      return 0;
    }

    // Real apply
    const appliedBy = resolveAppliedBy();
    const outcome = await applyPending(runner, client, status.pending, appliedBy, templateVersion, parsed.json);

    if (outcome.failedFilename) {
      const failureDetail = outcome.failureDetail ?? 'unknown error';
      const msg = `apply failed at ${outcome.failedFilename}: ${failureDetail}`;
      if (parsed.json) {
        const out: UpgradeJsonResult = {
          ok: false,
          action: 'apply',
          mode: resolved.mode,
          datastoreUrl: redactDatastoreUrl(resolved.url),
          templateVersion,
          status: summary,
          apply: {
            plannedFilenames: status.pending.map((m) => m.filename),
            appliedFilenames: outcome.appliedFilenames,
            failedFilename: outcome.failedFilename,
            failureDetail,
          },
          error: msg,
        };
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.error('');
        console.error(`atelier upgrade: ${msg}`);
        console.error('Subsequent migrations were NOT attempted; partial state is recorded');
        console.error('in atelier_schema_versions for whatever DID succeed. Inspect the SQL,');
        console.error('fix the migration, and re-run `atelier upgrade --apply`.');
      }
      return 1;
    }

    // Success: re-render status
    const finalStatus = await runner.computeStatus();
    const finalApplied = await runner.loadAppliedMigrations();
    const finalDiscovered = await runner.discoverMigrations();
    const finalSummary = buildSummary(
      resolved.mode,
      resolved.url,
      templateVersion,
      finalDiscovered,
      finalApplied,
      finalStatus,
    );

    if (parsed.json) {
      const out: UpgradeJsonResult = {
        ok: true,
        action: 'apply',
        mode: resolved.mode,
        datastoreUrl: redactDatastoreUrl(resolved.url),
        templateVersion,
        status: finalSummary,
        apply: {
          plannedFilenames: status.pending.map((m) => m.filename),
          appliedFilenames: outcome.appliedFilenames,
        },
      };
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log('');
      console.log(`atelier upgrade -- DONE: applied ${outcome.appliedFilenames.length} migration(s)`);
      console.log('');
      console.log(renderStatusHuman(finalSummary));
    }
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}
