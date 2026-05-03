// `atelier datastore <subcommand>` (US-11.2; BUILD-SEQUENCE §9; D3 polished form).
//
// v1 subcommands:
//   init — bootstrap the coordination datastore (local Supabase or cloud
//          Postgres) by applying schema migrations + verifying invariants.
//
// Per ARCH 5.1 (the 11 user-facing tables), ADR-027 (reference impl =
// GitHub + Supabase + Vercel + MCP), ADR-029 (no proprietary helpers
// outside named adapters), ADR-044 (M5-exit local-bootstrap inflection),
// and ADR-046 (cloud deploy = Vercel + Supabase Cloud).
//
// What `init` does (auto-detected mode; flag-overridable):
//
//   LOCAL MODE (default when supabase CLI is reachable + ATELIER_DATASTORE_URL
//   either unset or pointing at 127.0.0.1):
//     1. Pre-flight (docker reachable, supabase CLI installed) via the
//        shared lib/preflight.ts helpers; reuses, does not duplicate.
//     2. If supabase services not running: `supabase start` (which
//        auto-applies migrations from supabase/migrations/ as part of
//        bring-up — verified by the existing atelier-audit.yml CI flow).
//     3. If supabase already running and --reset is passed: confirm
//        (or accept --yes) and `supabase db reset --local` (destructive).
//     4. Verify the 11 ARCH 5.1 user-facing tables exist in the resulting
//        datastore (read-only count + missing-table report). Migrations
//        1-9 are expected to land all 11; this is a structural smoke,
//        not a deep invariant check (run `npm run smoke:schema-invariants`
//        for the deep contracts).
//
//   CLOUD MODE (when ATELIER_DATASTORE_URL is set + non-localhost, OR
//   --remote is passed):
//     1. Pre-flight (ATELIER_DATASTORE_URL or DATABASE_URL set; supabase
//        CLI present when using db push path).
//     2. Apply migrations:
//        - Path A (preferred): `supabase db push` when supabase project
//          is linked (supabase/.temp/project-ref present).
//        - Path B (fallback): direct application of supabase/migrations/*.sql
//          via the pg client, in lexicographic order. Each migration runs
//          in a transaction so partial failures roll back.
//     3. Verify the 11 ARCH 5.1 tables.
//
//   OPTIONAL SEED (--seed, both modes):
//     Delegates to scripts/bootstrap/seed-composer.ts to create the
//     atelier-self project + an admin composer for the supplied email.
//     Requires --email + --password (or interactive prompt when stdin
//     is a TTY).
//
// Safe-by-default: --dry-run renders the plan without mutating. The
// destructive path (--reset) requires --yes or interactive confirm.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Client } from 'pg';

import {
  checkDocker,
  checkSupabaseCli,
  checkSupabaseRunning,
  type PreflightStatus,
} from '../lib/preflight.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'supabase/migrations');
const LINKED_PROJECT_REF = resolve(REPO_ROOT, 'supabase/.temp/project-ref');
const SEED_SCRIPT = resolve(REPO_ROOT, 'scripts/bootstrap/seed-composer.ts');

// ARCH 5.1 user-facing tables. These are the 11 tables every Atelier
// datastore must carry post-migrations. delivery_sync_state (migration 3)
// is operational-only and not in the user-facing contract; we don't
// gate on it here, though it will be present when migrations applied
// cleanly.
const REQUIRED_TABLES = [
  'projects',
  'composers',
  'sessions',
  'territories',
  'contributions',
  'decisions',
  'locks',
  'contracts',
  'telemetry',
  'embeddings',
  'triage_pending',
] as const;

const DEFAULT_LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export const datastoreUsage = `atelier datastore — manage the coordination datastore

Usage:
  atelier datastore init [options]    Apply schema migrations + verify

Mode detection (auto):
  - LOCAL when supabase CLI is reachable AND
    ATELIER_DATASTORE_URL is unset or points at 127.0.0.1.
  - CLOUD when ATELIER_DATASTORE_URL points at a non-localhost host,
    OR --remote is passed.

Init options:
  --remote                  Force cloud mode regardless of env detection.
  --local                   Force local mode regardless of env detection.
  --reset                   (Local only) Destructive: \`supabase db reset --local\`
                            wipes the local database and re-applies all migrations.
                            Requires --yes or interactive confirm.
  --yes                     Skip the destructive-action confirmation prompt.
  --seed                    After init, seed an admin composer + atelier-self
                            project. Requires --email + --password (or prompts
                            when stdin is a TTY).
  --email <address>         Email for --seed. Used as the Supabase Auth user.
  --password <password>     Password for --seed. Stored only by Supabase Auth;
                            never echoed back. Lose it = re-seed with a fresh
                            email or rotate via the admin API.
  --discipline <role>       (--seed) Seeded composer's discipline. Default
                            \`architect\`. One of: analyst|dev|pm|designer|architect.
  --access-level <level>    (--seed) Seeded composer's access level. Default
                            \`admin\`. One of: member|admin|stakeholder.
  --project-name <name>     (--seed) Project name. Default \`atelier-self\`.
  --non-interactive         Do not prompt; fail if required flags are missing.
  --dry-run                 Render the plan without mutating. Skips schema
                            verification (no DB to verify against).
  --json                    Emit machine-readable JSON output.
  -h, --help                Show this help.

Behavior contract:
  Exits 0 when all migrations apply and all 11 ARCH 5.1 tables verify;
  1 on schema/migration failure; 2 on argument or precondition error
  (e.g., --reset without --yes in non-interactive mode, missing required
  flag, ATELIER_DATASTORE_URL invalid).

Cross-references:
  - docs/user/tutorials/local-bootstrap.md Steps 1-3 (local mode flow)
  - docs/user/tutorials/first-deploy.md Step 2 (cloud-mode migration flow)
  - scripts/bootstrap/seed-composer.ts (seed delegate; same flags)
  - scripts/test/__smoke__/schema-invariants.smoke.ts (deep invariant check)
`;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  remote: boolean;
  local: boolean;
  reset: boolean;
  yes: boolean;
  seed: boolean;
  email?: string;
  password?: string;
  discipline: string;
  accessLevel: string;
  projectName: string;
  nonInteractive: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

function parseInitArgs(args: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    remote: false,
    local: false,
    reset: false,
    yes: false,
    seed: false,
    discipline: 'architect',
    accessLevel: 'admin',
    projectName: 'atelier-self',
    nonInteractive: false,
    dryRun: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    const next = (): string => {
      const v = args[i + 1];
      if (v === undefined) throw new Error(`flag ${a} requires a value`);
      i += 1;
      return v;
    };
    switch (a) {
      case '--remote': out.remote = true; break;
      case '--local': out.local = true; break;
      case '--reset': out.reset = true; break;
      case '--yes': out.yes = true; break;
      case '--seed': out.seed = true; break;
      case '--email': out.email = next(); break;
      case '--password': out.password = next(); break;
      case '--discipline': out.discipline = next(); break;
      case '--access-level': out.accessLevel = next(); break;
      case '--project-name': out.projectName = next(); break;
      case '--non-interactive': out.nonInteractive = true; break;
      case '--dry-run': out.dryRun = true; break;
      case '--json': out.json = true; break;
      case '--help':
      case '-h': out.help = true; break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  if (out.remote && out.local) {
    throw new Error('--remote and --local are mutually exclusive');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

type Mode = 'local' | 'cloud';

interface ModeDecision {
  mode: Mode;
  reason: string;
  /** The Postgres connection string we will operate against. */
  databaseUrl: string;
}

function decideMode(parsed: ParsedArgs): ModeDecision {
  const envUrl = process.env.ATELIER_DATASTORE_URL ?? process.env.DATABASE_URL;
  if (parsed.local) {
    return {
      mode: 'local',
      reason: '--local flag forced local mode',
      databaseUrl: envUrl && isLocalhost(envUrl) ? envUrl : DEFAULT_LOCAL_DB_URL,
    };
  }
  if (parsed.remote) {
    if (!envUrl) {
      throw new Error(
        '--remote requires ATELIER_DATASTORE_URL or DATABASE_URL to be set',
      );
    }
    return {
      mode: 'cloud',
      reason: '--remote flag forced cloud mode',
      databaseUrl: envUrl,
    };
  }
  if (envUrl && !isLocalhost(envUrl)) {
    return {
      mode: 'cloud',
      reason: `ATELIER_DATASTORE_URL points at ${redactHost(envUrl)} (non-localhost)`,
      databaseUrl: envUrl,
    };
  }
  return {
    mode: 'local',
    reason:
      envUrl
        ? `ATELIER_DATASTORE_URL points at localhost (${redactHost(envUrl)})`
        : 'no ATELIER_DATASTORE_URL set; defaulting to local Supabase',
    databaseUrl: envUrl ?? DEFAULT_LOCAL_DB_URL,
  };
}

function isLocalhost(connStr: string): boolean {
  try {
    const u = new URL(connStr);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1';
  } catch {
    // Not a URL we can parse; conservatively treat as non-local.
    return false;
  }
}

// Strip credentials and surface only host[:port] for logging.
function redactHost(connStr: string): string {
  try {
    const u = new URL(connStr);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return '<unparseable connection string>';
  }
}

// ---------------------------------------------------------------------------
// Schema verification
// ---------------------------------------------------------------------------

interface SchemaVerification {
  ok: boolean;
  presentTables: string[];
  missingTables: string[];
  detail: string;
}

async function verifySchema(databaseUrl: string): Promise<SchemaVerification> {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [Array.from(REQUIRED_TABLES)],
    );
    const present = new Set(rows.map((r) => r.table_name));
    const presentTables = REQUIRED_TABLES.filter((t) => present.has(t));
    const missingTables = REQUIRED_TABLES.filter((t) => !present.has(t));
    return {
      ok: missingTables.length === 0,
      presentTables,
      missingTables,
      detail:
        missingTables.length === 0
          ? `all ${REQUIRED_TABLES.length} ARCH 5.1 tables present`
          : `${missingTables.length} of ${REQUIRED_TABLES.length} tables missing: ${missingTables.join(', ')}`,
    };
  } catch (err) {
    return {
      ok: false,
      presentTables: [],
      missingTables: Array.from(REQUIRED_TABLES),
      detail: `schema verification connect/query failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Local mode
// ---------------------------------------------------------------------------

interface ActionResult {
  ok: boolean;
  detail: string;
  /** Optional captured tail of subprocess stderr/stdout for diagnostics. */
  outputTail?: string;
}

function spawnInherit(cmd: string, args: string[]): Promise<ActionResult> {
  return new Promise((resolveAction) => {
    const proc = spawn(cmd, args, { cwd: REPO_ROOT, stdio: ['inherit', 'inherit', 'pipe'] });
    let stderrTail = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      process.stderr.write(s);
      stderrTail += s;
    });
    proc.on('exit', (code) => {
      if (code === 0) {
        resolveAction({ ok: true, detail: `${cmd} ${args.join(' ')} exited 0` });
      } else {
        const tail = stderrTail.trim().split('\n').slice(-10).join('\n');
        resolveAction({
          ok: false,
          detail: `${cmd} ${args.join(' ')} exited ${code}`,
          outputTail: tail,
        });
      }
    });
    proc.on('error', (err) => {
      resolveAction({ ok: false, detail: `failed to spawn ${cmd}: ${err.message}` });
    });
  });
}

interface LocalPlan {
  preflight: { docker: PreflightStatus; supabaseCli: PreflightStatus };
  alreadyRunning: boolean;
  willStart: boolean;
  willReset: boolean;
}

function planLocal(parsed: ParsedArgs): LocalPlan {
  const docker = checkDocker();
  const supabaseCli = checkSupabaseCli();
  const running = checkSupabaseRunning();
  return {
    preflight: { docker, supabaseCli },
    alreadyRunning: running.ok,
    willStart: !running.ok,
    willReset: parsed.reset && running.ok,
  };
}

interface LocalExecution {
  startResult: ActionResult | null;
  resetResult: ActionResult | null;
  schema: SchemaVerification | null;
}

async function executeLocal(
  plan: LocalPlan,
  databaseUrl: string,
): Promise<LocalExecution> {
  const out: LocalExecution = {
    startResult: null,
    resetResult: null,
    schema: null,
  };

  if (plan.willStart) {
    console.log('[datastore init] starting local supabase (auto-applies migrations)...');
    out.startResult = await spawnInherit('supabase', ['start']);
    if (!out.startResult.ok) return out;
  } else if (plan.willReset) {
    console.log('[datastore init] resetting local supabase database (destructive)...');
    out.resetResult = await spawnInherit('supabase', ['db', 'reset', '--local']);
    if (!out.resetResult.ok) return out;
  } else {
    console.log('[datastore init] supabase already running; skipping start (no --reset).');
  }

  out.schema = await verifySchema(databaseUrl);
  return out;
}

// ---------------------------------------------------------------------------
// Cloud mode
// ---------------------------------------------------------------------------

interface CloudPlan {
  preflight: { databaseUrl: PreflightStatus; supabaseCli: PreflightStatus };
  linked: boolean;
  applyPath: 'db_push' | 'direct_psql';
  migrationFiles: string[];
}

async function planCloud(databaseUrl: string): Promise<CloudPlan> {
  const databaseUrlOk: PreflightStatus = databaseUrl
    ? { ok: true, detail: redactHost(databaseUrl) }
    : { ok: false, detail: 'no ATELIER_DATASTORE_URL or DATABASE_URL set' };
  const supabaseCli = checkSupabaseCli();
  const linked = existsSync(LINKED_PROJECT_REF);
  // Prefer db push when both supabase CLI and link exist; fall back to
  // direct psql (via the pg client) otherwise. The fallback honors
  // first-deploy.md Path B.
  const applyPath: CloudPlan['applyPath'] =
    supabaseCli.ok && linked ? 'db_push' : 'direct_psql';
  const { readdir } = await import('node:fs/promises');
  let files: string[] = [];
  try {
    files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch (err) {
    // Surface upstream as part of plan; executor will refuse to proceed.
    files = [];
  }
  return {
    preflight: { databaseUrl: databaseUrlOk, supabaseCli },
    linked,
    applyPath,
    migrationFiles: files,
  };
}

interface CloudExecution {
  applyResult: ActionResult | null;
  schema: SchemaVerification | null;
}

async function executeCloud(plan: CloudPlan, databaseUrl: string): Promise<CloudExecution> {
  const out: CloudExecution = { applyResult: null, schema: null };

  if (plan.migrationFiles.length === 0) {
    out.applyResult = {
      ok: false,
      detail: `no migration files found at ${MIGRATIONS_DIR}`,
    };
    return out;
  }

  if (plan.applyPath === 'db_push') {
    console.log('[datastore init] running supabase db push against linked project...');
    out.applyResult = await spawnInherit('supabase', ['db', 'push']);
  } else {
    console.log(
      `[datastore init] applying ${plan.migrationFiles.length} migrations via direct psql ` +
        `(no supabase link found at supabase/.temp/project-ref)...`,
    );
    out.applyResult = await applyMigrationsDirect(databaseUrl, plan.migrationFiles);
  }
  if (!out.applyResult.ok) return out;

  out.schema = await verifySchema(databaseUrl);
  return out;
}

async function applyMigrationsDirect(
  databaseUrl: string,
  migrationFiles: string[],
): Promise<ActionResult> {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    for (const f of migrationFiles) {
      const path = resolve(MIGRATIONS_DIR, f);
      const sql = await readFile(path, 'utf8');
      console.log(`  applying ${f}...`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        return {
          ok: false,
          detail: `failed at ${f}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    return { ok: true, detail: `applied ${migrationFiles.length} migrations` };
  } catch (err) {
    return {
      ok: false,
      detail: `connect failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Seed delegation
// ---------------------------------------------------------------------------

interface SeedResult {
  ran: boolean;
  ok: boolean;
  detail: string;
  outputTail?: string;
}

async function maybeSeed(
  parsed: ParsedArgs,
  mode: Mode,
  databaseUrl: string,
): Promise<SeedResult> {
  if (!parsed.seed) {
    return { ran: false, ok: true, detail: 'seed not requested (--seed not passed)' };
  }
  if (!parsed.email || !parsed.password) {
    return {
      ran: false,
      ok: false,
      detail: '--seed requires --email and --password (or interactive prompt)',
    };
  }

  // The seed script uses the Supabase Admin SDK + direct PG. It needs
  // SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env. For local mode we
  // pull them from `supabase status -o env`; for cloud mode we expect
  // the operator to have them in the environment already (matches
  // first-deploy.md Step 4 expectation).
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (mode === 'local') {
    const status = spawnSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
    if (status.status !== 0) {
      return {
        ran: false,
        ok: false,
        detail: 'failed to read supabase status -o env for local seed',
      };
    }
    for (const line of status.stdout.split('\n')) {
      const m = /^([A-Z_]+)="(.*)"$/.exec(line.trim());
      if (!m) continue;
      const [, key, value] = m;
      if (key === 'API_URL') env.SUPABASE_URL = value!;
      if (key === 'SERVICE_ROLE_KEY') env.SUPABASE_SERVICE_ROLE_KEY = value!;
    }
  } else {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return {
        ran: false,
        ok: false,
        detail:
          '--seed in cloud mode requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars (per first-deploy.md Step 4)',
      };
    }
  }

  return new Promise<SeedResult>((resolveSeed) => {
    const proc = spawn(
      'npx',
      [
        'tsx',
        SEED_SCRIPT,
        '--email',
        parsed.email!,
        '--password',
        parsed.password!,
        '--discipline',
        parsed.discipline,
        '--access-level',
        parsed.accessLevel,
        '--project-name',
        parsed.projectName,
        '--database-url',
        databaseUrl,
      ],
      { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdoutBuf = '';
    let stderrBuf = '';
    proc.stdout?.on('data', (c: Buffer) => {
      const s = c.toString();
      process.stdout.write(s);
      stdoutBuf += s;
    });
    proc.stderr?.on('data', (c: Buffer) => {
      const s = c.toString();
      process.stderr.write(s);
      stderrBuf += s;
    });
    proc.on('exit', (code) => {
      const ok = code === 0;
      const tail = (ok ? stdoutBuf : stderrBuf).trim().split('\n').slice(-10).join('\n');
      resolveSeed({
        ran: true,
        ok,
        detail: ok
          ? `seeded composer for ${parsed.email} in project ${parsed.projectName}`
          : `seed-composer.ts exited ${code}`,
        outputTail: tail,
      });
    });
    proc.on('error', (err) => {
      resolveSeed({ ran: true, ok: false, detail: `failed to spawn seed: ${err.message}` });
    });
  });
}

// ---------------------------------------------------------------------------
// Confirmation prompt for destructive --reset
// ---------------------------------------------------------------------------

async function confirmReset(parsed: ParsedArgs): Promise<boolean> {
  if (parsed.yes) return true;
  if (parsed.nonInteractive || !stdin.isTTY) return false;
  const rl: ReadlineInterface = createInterface({ input: stdin, output: stdout });
  try {
    const v = (
      await rl.question(
        'WARNING: --reset will wipe the local Supabase database. Type "yes" to continue: ',
      )
    ).trim();
    return v === 'yes';
  } finally {
    rl.close();
  }
}

// Prompt for missing --email / --password when --seed was passed and we
// have an interactive TTY. Mutates `parsed` in place. Returns true when
// both fields are populated after prompting; false when the user aborts
// (empty input on a required field).
async function promptForSeedCredentials(parsed: ParsedArgs): Promise<boolean> {
  if (parsed.email && parsed.password) return true;
  if (parsed.nonInteractive || !stdin.isTTY) return false;
  const rl: ReadlineInterface = createInterface({ input: stdin, output: stdout });
  try {
    while (!parsed.email) {
      const v = (await rl.question('seed email: ')).trim();
      if (!v) {
        console.log('  email is required (or rerun without --seed)');
        return false;
      }
      parsed.email = v;
    }
    while (!parsed.password) {
      const v = (await rl.question('seed password: ')).trim();
      if (!v) {
        console.log('  password is required (or rerun without --seed)');
        return false;
      }
      parsed.password = v;
    }
    return true;
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

interface InitJsonOutput {
  ok: boolean;
  mode: Mode;
  reason: string;
  databaseUrl: string;
  dryRun: boolean;
  local?: {
    plan: LocalPlan;
    execution: LocalExecution | null;
  };
  cloud?: {
    plan: CloudPlan;
    execution: CloudExecution | null;
  };
  schema: SchemaVerification | null;
  seed: SeedResult;
}

function emitHumanReport(out: InitJsonOutput): void {
  console.log('');
  console.log(`atelier datastore init: ${out.dryRun ? 'DRY RUN' : out.ok ? 'OK' : 'FAILED'}`);
  console.log('');
  console.log(`Mode:     ${out.mode}`);
  console.log(`Reason:   ${out.reason}`);
  console.log(`DB host:  ${redactHost(out.databaseUrl)}`);
  console.log('');

  if (out.mode === 'local' && out.local) {
    const { plan, execution } = out.local;
    console.log('Local plan:');
    console.log(`  ${plan.preflight.docker.ok ? '[OK]' : '[!!]'} docker         ${plan.preflight.docker.detail ?? ''}`);
    console.log(`  ${plan.preflight.supabaseCli.ok ? '[OK]' : '[!!]'} supabase CLI   ${plan.preflight.supabaseCli.detail ?? ''}`);
    if (plan.willStart) {
      console.log('  [..] start: supabase start (auto-applies migrations)');
    } else if (plan.willReset) {
      console.log('  [!!] reset: supabase db reset --local (destructive)');
    } else {
      console.log('  [OK] supabase already running; no start/reset');
    }
    if (execution) {
      if (execution.startResult) {
        console.log(`  ${execution.startResult.ok ? '[OK]' : '[!!]'} start: ${execution.startResult.detail}`);
        if (execution.startResult.outputTail) {
          console.log(`        ${execution.startResult.outputTail.split('\n').join('\n        ')}`);
        }
      }
      if (execution.resetResult) {
        console.log(`  ${execution.resetResult.ok ? '[OK]' : '[!!]'} reset: ${execution.resetResult.detail}`);
        if (execution.resetResult.outputTail) {
          console.log(`        ${execution.resetResult.outputTail.split('\n').join('\n        ')}`);
        }
      }
    }
    console.log('');
  }

  if (out.mode === 'cloud' && out.cloud) {
    const { plan, execution } = out.cloud;
    console.log('Cloud plan:');
    console.log(`  ${plan.preflight.databaseUrl.ok ? '[OK]' : '[!!]'} datastore URL  ${plan.preflight.databaseUrl.detail ?? ''}`);
    console.log(`  ${plan.preflight.supabaseCli.ok ? '[OK]' : '[!!]'} supabase CLI   ${plan.preflight.supabaseCli.detail ?? ''}`);
    console.log(`  [..] linked project ref: ${plan.linked ? 'present' : 'absent'}`);
    console.log(`  [..] apply path: ${plan.applyPath === 'db_push' ? 'supabase db push' : 'direct psql (pg client)'}`);
    console.log(`  [..] ${plan.migrationFiles.length} migration file(s) staged`);
    if (execution?.applyResult) {
      console.log(`  ${execution.applyResult.ok ? '[OK]' : '[!!]'} apply: ${execution.applyResult.detail}`);
      if (execution.applyResult.outputTail) {
        console.log(`        ${execution.applyResult.outputTail.split('\n').join('\n        ')}`);
      }
    }
    console.log('');
  }

  if (out.schema) {
    console.log('Schema verification:');
    console.log(`  ${out.schema.ok ? '[OK]' : '[!!]'} ${out.schema.detail}`);
    if (out.schema.missingTables.length > 0) {
      console.log(`        missing: ${out.schema.missingTables.join(', ')}`);
    }
    console.log('');
  } else if (out.dryRun) {
    console.log('Schema verification: skipped (--dry-run; no DB to query)');
    console.log('');
  }

  if (out.seed.ran) {
    console.log('Seed:');
    console.log(`  ${out.seed.ok ? '[OK]' : '[!!]'} ${out.seed.detail}`);
    console.log('');
  } else if (out.seed.detail !== 'seed not requested (--seed not passed)') {
    console.log(`Seed: skipped — ${out.seed.detail}`);
    console.log('');
  }

  if (out.ok && !out.dryRun) {
    console.log('Next steps:');
    if (!out.seed.ran) {
      console.log('  1. Seed an admin composer + project:');
      console.log('     atelier datastore init --seed --email <you@example.com> --password <pwd>');
      console.log('     (or directly: npx tsx scripts/bootstrap/seed-composer.ts ...)');
    } else {
      console.log('  1. Issue a bearer token:');
      console.log(`     npx tsx scripts/bootstrap/issue-bearer.ts --email ${out.seed.detail.includes(' for ') ? out.seed.detail.split(' for ')[1]?.split(' ')[0] ?? '<email>' : '<email>'} --password '<password>'`);
    }
    console.log('  2. Start the dev server: atelier dev');
    console.log('  3. Verify end-to-end: atelier doctor');
    console.log('');
  }
}

// ---------------------------------------------------------------------------
// Subcommand: init
// ---------------------------------------------------------------------------

async function runInit(args: readonly string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseInitArgs(args);
  } catch (err) {
    console.error(`atelier datastore init: ${(err as Error).message}`);
    console.error('');
    console.error(datastoreUsage);
    return 2;
  }
  if (parsed.help) {
    console.log(datastoreUsage);
    return 0;
  }

  let decision: ModeDecision;
  try {
    decision = decideMode(parsed);
  } catch (err) {
    console.error(`atelier datastore init: ${(err as Error).message}`);
    return 2;
  }

  // Reset confirmation gate (local mode only). Block before any subprocess
  // spawn so dry-run + non-interactive surfaces the precondition cleanly.
  if (decision.mode === 'local' && parsed.reset) {
    const confirmed = await confirmReset(parsed);
    if (!confirmed) {
      console.error(
        'atelier datastore init: --reset requires --yes (or interactive "yes" confirmation).',
      );
      return 2;
    }
  }

  // --seed precondition gate. Required flags (--email, --password) collected
  // up-front; non-interactive runs without them exit 2 rather than silently
  // skipping the seed. Skip the prompt when --dry-run, since we won't
  // actually invoke the seed.
  if (parsed.seed && !parsed.dryRun) {
    if (!parsed.email || !parsed.password) {
      const got = await promptForSeedCredentials(parsed);
      if (!got) {
        console.error(
          'atelier datastore init: --seed requires --email and --password (or an interactive TTY for prompting).',
        );
        return 2;
      }
    }
  }

  // Dry run: produce the plan, skip mutation + verification.
  if (parsed.dryRun) {
    if (decision.mode === 'local') {
      const plan = planLocal(parsed);
      const out: InitJsonOutput = {
        ok: true,
        mode: 'local',
        reason: decision.reason,
        databaseUrl: decision.databaseUrl,
        dryRun: true,
        local: { plan, execution: null },
        schema: null,
        seed: { ran: false, ok: true, detail: 'seed not requested (--seed not passed)' },
      };
      if (parsed.json) console.log(JSON.stringify(out, null, 2));
      else emitHumanReport(out);
      return 0;
    }
    const plan = await planCloud(decision.databaseUrl);
    const out: InitJsonOutput = {
      ok: true,
      mode: 'cloud',
      reason: decision.reason,
      databaseUrl: decision.databaseUrl,
      dryRun: true,
      cloud: { plan, execution: null },
      schema: null,
      seed: { ran: false, ok: true, detail: 'seed not requested (--seed not passed)' },
    };
    if (parsed.json) console.log(JSON.stringify(out, null, 2));
    else emitHumanReport(out);
    return 0;
  }

  // Real run.
  if (decision.mode === 'local') {
    const plan = planLocal(parsed);
    if (!plan.preflight.docker.ok || !plan.preflight.supabaseCli.ok) {
      const out: InitJsonOutput = {
        ok: false,
        mode: 'local',
        reason: decision.reason,
        databaseUrl: decision.databaseUrl,
        dryRun: false,
        local: { plan, execution: null },
        schema: null,
        seed: { ran: false, ok: true, detail: 'seed not requested (--seed not passed)' },
      };
      if (parsed.json) console.log(JSON.stringify(out, null, 2));
      else emitHumanReport(out);
      return 1;
    }
    const execution = await executeLocal(plan, decision.databaseUrl);
    const seed =
      execution.schema?.ok
        ? await maybeSeed(parsed, 'local', decision.databaseUrl)
        : { ran: false, ok: true, detail: 'seed skipped: schema verification did not pass' };
    const ok =
      (execution.startResult?.ok ?? true) &&
      (execution.resetResult?.ok ?? true) &&
      (execution.schema?.ok ?? false) &&
      (seed.ran ? seed.ok : true);
    const out: InitJsonOutput = {
      ok,
      mode: 'local',
      reason: decision.reason,
      databaseUrl: decision.databaseUrl,
      dryRun: false,
      local: { plan, execution },
      schema: execution.schema,
      seed,
    };
    if (parsed.json) console.log(JSON.stringify(out, null, 2));
    else emitHumanReport(out);
    return ok ? 0 : 1;
  }

  // Cloud mode real run.
  const plan = await planCloud(decision.databaseUrl);
  if (!plan.preflight.databaseUrl.ok) {
    const out: InitJsonOutput = {
      ok: false,
      mode: 'cloud',
      reason: decision.reason,
      databaseUrl: decision.databaseUrl,
      dryRun: false,
      cloud: { plan, execution: null },
      schema: null,
      seed: { ran: false, ok: true, detail: 'seed not requested (--seed not passed)' },
    };
    if (parsed.json) console.log(JSON.stringify(out, null, 2));
    else emitHumanReport(out);
    return 2;
  }
  if (plan.applyPath === 'db_push' && !plan.preflight.supabaseCli.ok) {
    // Linked project but no CLI: this shouldn't happen given how planCloud
    // computes applyPath, but defend against env drift.
    const out: InitJsonOutput = {
      ok: false,
      mode: 'cloud',
      reason: decision.reason,
      databaseUrl: decision.databaseUrl,
      dryRun: false,
      cloud: { plan, execution: null },
      schema: null,
      seed: { ran: false, ok: true, detail: 'seed not requested (--seed not passed)' },
    };
    if (parsed.json) console.log(JSON.stringify(out, null, 2));
    else emitHumanReport(out);
    return 1;
  }
  const execution = await executeCloud(plan, decision.databaseUrl);
  const seed =
    execution.schema?.ok
      ? await maybeSeed(parsed, 'cloud', decision.databaseUrl)
      : { ran: false, ok: true, detail: 'seed skipped: schema verification did not pass' };
  const ok =
    (execution.applyResult?.ok ?? false) &&
    (execution.schema?.ok ?? false) &&
    (seed.ran ? seed.ok : true);
  const out: InitJsonOutput = {
    ok,
    mode: 'cloud',
    reason: decision.reason,
    databaseUrl: decision.databaseUrl,
    dryRun: false,
    cloud: { plan, execution },
    schema: execution.schema,
    seed,
  };
  if (parsed.json) console.log(JSON.stringify(out, null, 2));
  else emitHumanReport(out);
  return ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function runDatastore(args: readonly string[]): Promise<number> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(datastoreUsage);
    return 0;
  }
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === 'init') {
    return runInit(rest);
  }
  console.error(`atelier datastore: unknown subcommand "${sub ?? ''}"`);
  console.error('');
  console.error(datastoreUsage);
  return 2;
}
