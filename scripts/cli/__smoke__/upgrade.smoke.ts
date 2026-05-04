#!/usr/bin/env -S npx tsx
//
// Smoke for E2 `atelier upgrade` polished form (consumes E1 migration runner).
//
// Substrate-touching: requires local Supabase running (`atelier dev` or
// `supabase start`) with the bootstrap migration applied. Skips with exit 0
// if Postgres is unreachable.
//
// Sections:
//   [1] --check against healthy stack: exit 0, mode=LOCAL, up-to-date
//   [2] --check --json: valid JSON shape (mode, status buckets, etc.)
//   [3] Pending detection: write a synthetic migration file, --check shows
//       it as pending, exit 1
//   [4] --apply --dry-run with pending: prints planned sequence, no mutation
//   [5] --apply real: applies the synthetic migration; re-running --check
//       shows up-to-date again
//   [6] Modified detection: tamper the recorded SHA on the synthetic row,
//       --check shows modified, exit 1
//   [7] --apply with modified + no --force-apply-modified: refuses (exit 1)
//   [8] --apply --force-apply-modified: proceeds (idempotent re-apply)
//
// Cleanup: drops the test table, deletes the synthetic schema_versions row,
// removes the synthetic migration file (idempotent on cleanup).
//
// Run:  npx tsx scripts/cli/__smoke__/upgrade.smoke.ts

import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { computeSha256 } from '../../migration/manifest.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CLI = resolve(REPO_ROOT, 'scripts/cli/atelier.ts');
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const SYNTH_FILENAME = '29991231235961_atelier_e2_smoke_upgrade_test.sql';
const SYNTH_PATH = resolve(REPO_ROOT, 'supabase', 'migrations', SYNTH_FILENAME);
const SYNTH_TABLE = 'atelier_e2_smoke_upgrade_test';
const SYNTH_SQL = [
  `-- E2 smoke synthetic migration; safe to re-apply.`,
  `CREATE TABLE IF NOT EXISTS ${SYNTH_TABLE} (`,
  `  id     bigserial PRIMARY KEY,`,
  `  marker text      NOT NULL`,
  `);`,
  ``,
  `INSERT INTO ${SYNTH_TABLE} (marker)`,
  `  SELECT 'e2-smoke-marker'`,
  `  WHERE NOT EXISTS (SELECT 1 FROM ${SYNTH_TABLE} WHERE marker = 'e2-smoke-marker');`,
  ``,
].join('\n');

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

function run(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const out = spawnSync('npx', ['tsx', CLI, ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
  return { status: out.status, stdout: out.stdout, stderr: out.stderr };
}

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------
async function cleanup(): Promise<void> {
  await withClient(async (c) => {
    await c.query(`DROP TABLE IF EXISTS ${SYNTH_TABLE}`);
    await c.query(`DELETE FROM atelier_schema_versions WHERE filename = $1`, [SYNTH_FILENAME]);
  }).catch((err) => {
    console.error(`cleanup warn: ${err instanceof Error ? err.message : String(err)}`);
  });
  if (existsSync(SYNTH_PATH)) {
    try { unlinkSync(SYNTH_PATH); } catch (err) {
      console.error(`cleanup warn: failed to remove ${SYNTH_PATH}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

async function testCheckHealthy(): Promise<void> {
  console.log('\n[1] --check against healthy stack');
  const r = run(['upgrade', '--check']);
  check('exit code 0 (up-to-date)', r.status === 0, `got ${r.status}; stderr=${r.stderr.slice(0, 200)}`);
  check('reports Mode: LOCAL', r.stdout.includes('Mode:') && r.stdout.includes('LOCAL'));
  check('reports up-to-date count', /up-to-date:\s+\d+ migration\(s\)/.test(r.stdout));
  check('lists pending: 0', /pending:\s+0 migration\(s\)/.test(r.stdout));
  check('lists modified: 0', /modified:\s+0 migration\(s\)/.test(r.stdout));
  check('lists missing: 0', /missing:\s+0 entry\/entries/.test(r.stdout));
  check('does NOT print v1.x deferral banner', !r.stdout.includes('polished form lands in v1.x'));
  check(
    'redacts password in datastore URL',
    !r.stdout.includes('postgres:postgres@'),
    'observed unredacted password in stdout',
  );
}

async function testCheckJson(): Promise<void> {
  console.log('\n[2] --check --json shape');
  const r = run(['upgrade', '--check', '--json']);
  check('exit code 0 (up-to-date)', r.status === 0, `got ${r.status}`);
  let parsed: {
    ok?: boolean;
    action?: string;
    mode?: string;
    templateVersion?: string;
    status?: {
      mode?: string;
      datastoreUrl?: string;
      templateVersion?: string;
      migrationsOnDisk?: number;
      migrationsApplied?: number;
      upToDateCount?: number;
      pending?: { filename: string; sha256Prefix: string }[];
      modified?: { filename: string; localShaPrefix: string; appliedShaPrefix: string }[];
      missing?: { filename: string; appliedAt: string }[];
    };
  } | null = null;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    parsed = null;
  }
  check('emits valid JSON', parsed !== null);
  check('json.ok === true', parsed?.ok === true);
  check('json.action === "check"', parsed?.action === 'check');
  check('json.mode === "local"', parsed?.mode === 'local');
  check('json.status.migrationsOnDisk is number >= 10', typeof parsed?.status?.migrationsOnDisk === 'number' && parsed.status.migrationsOnDisk >= 10);
  check('json.status.pending is array (empty)', Array.isArray(parsed?.status?.pending) && (parsed?.status?.pending?.length ?? -1) === 0);
  check('json.status.modified is array (empty)', Array.isArray(parsed?.status?.modified) && (parsed?.status?.modified?.length ?? -1) === 0);
  check('json.status.missing is array (empty)', Array.isArray(parsed?.status?.missing) && (parsed?.status?.missing?.length ?? -1) === 0);
}

async function testPendingDetection(): Promise<void> {
  console.log('\n[3] pending detection (synthetic file on disk)');
  writeFileSync(SYNTH_PATH, SYNTH_SQL, 'utf8');
  const r = run(['upgrade', '--check']);
  check('exit code 1 (divergence)', r.status === 1, `got ${r.status}; stderr=${r.stderr.slice(0, 200)}`);
  check('lists synthetic file as pending', r.stdout.includes(SYNTH_FILENAME));
  check('reports pending: 1', /pending:\s+1 migration\(s\)/.test(r.stdout));
  // JSON shape carries the same info
  const j = run(['upgrade', '--check', '--json']);
  check('--check --json exit 1 with pending', j.status === 1, `got ${j.status}`);
  let parsed: { ok?: boolean; status?: { pending?: { filename: string }[] } } | null = null;
  try { parsed = JSON.parse(j.stdout); } catch { parsed = null; }
  check('json.ok === false (pending exists)', parsed?.ok === false);
  check(
    'json.status.pending contains synthetic filename',
    parsed?.status?.pending?.some((p) => p.filename === SYNTH_FILENAME) ?? false,
  );
}

async function testApplyDryRun(): Promise<void> {
  console.log('\n[4] --apply --dry-run prints plan, no mutation');
  const r = run(['upgrade', '--apply', '--dry-run']);
  check('exit code 0 (dry-run)', r.status === 0, `got ${r.status}; stderr=${r.stderr.slice(0, 200)}`);
  check('reports DRY-RUN', r.stdout.includes('DRY-RUN'));
  check('lists synthetic filename in plan', r.stdout.includes(SYNTH_FILENAME));
  check('notes No mutations performed', r.stdout.includes('No mutations performed'));

  // Verify NO row was inserted: schema_versions count for synthetic == 0
  const rowsExist = await withClient(async (c) => {
    const q = await c.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM atelier_schema_versions WHERE filename = $1`,
      [SYNTH_FILENAME],
    );
    return q.rows[0]?.count ?? '0';
  });
  check('--apply --dry-run did NOT insert a schema_versions row', rowsExist === '0', `count=${rowsExist}`);
  // And the test table must NOT have been created
  const tableExists = await withClient(async (c) => {
    const q = await c.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name=$1
       ) AS exists`,
      [SYNTH_TABLE],
    );
    return q.rows[0]?.exists === true;
  });
  check('--apply --dry-run did NOT create the test table', !tableExists);
}

async function testApplyReal(): Promise<void> {
  console.log('\n[5] --apply real (synthetic migration applied)');
  const r = run(['upgrade', '--apply']);
  check('exit code 0', r.status === 0, `got ${r.status}; stderr=${r.stderr.slice(0, 200)}`);
  check('reports applying <synthetic>', r.stdout.includes(`applying ${SYNTH_FILENAME}`));
  check('reports DONE', r.stdout.includes('DONE'));

  // Verify schema_versions row recorded
  const row = await withClient(async (c) => {
    const q = await c.query<{ filename: string; content_sha256: string }>(
      `SELECT filename, content_sha256 FROM atelier_schema_versions WHERE filename = $1`,
      [SYNTH_FILENAME],
    );
    return q.rows[0];
  });
  check('schema_versions row recorded after apply', row !== undefined);
  check(
    'recorded sha256 matches file content sha256',
    row?.content_sha256 === computeSha256(SYNTH_SQL),
  );

  // Re-run --check: should be up-to-date again
  const c = run(['upgrade', '--check']);
  check('--check after apply exit 0 (up-to-date)', c.status === 0, `got ${c.status}`);
  check('--check after apply: pending: 0', /pending:\s+0 migration\(s\)/.test(c.stdout));
}

async function testModifiedDetection(): Promise<void> {
  console.log('\n[6] modified detection (tamper recorded SHA)');
  // Tamper the recorded SHA so the on-disk hash no longer matches
  await withClient(async (c) => {
    await c.query(
      `UPDATE atelier_schema_versions
         SET content_sha256 = $1
         WHERE filename = $2`,
      ['0000000000000000000000000000000000000000000000000000000000000000', SYNTH_FILENAME],
    );
  });
  const r = run(['upgrade', '--check']);
  check('exit code 1 (divergence)', r.status === 1, `got ${r.status}`);
  check('reports modified: 1', /modified:\s+1 migration\(s\)/.test(r.stdout));
  check('lists synthetic file under modified', r.stdout.includes(SYNTH_FILENAME));
}

async function testApplyRefusesModified(): Promise<void> {
  console.log('\n[7] --apply refuses with modified + no --force-apply-modified');
  const r = run(['upgrade', '--apply']);
  check('exit code 1 (refused)', r.status === 1, `got ${r.status}`);
  check(
    'stderr names --force-apply-modified',
    r.stderr.includes('--force-apply-modified') || r.stdout.includes('--force-apply-modified'),
  );

  // JSON shape: skippedDueToModified: true
  const j = run(['upgrade', '--apply', '--json']);
  check('--apply --json (modified) exits 1', j.status === 1, `got ${j.status}`);
  let parsed: {
    ok?: boolean;
    apply?: { skippedDueToModified?: boolean };
  } | null = null;
  try { parsed = JSON.parse(j.stdout); } catch { parsed = null; }
  check('json.ok === false', parsed?.ok === false);
  check('json.apply.skippedDueToModified === true', parsed?.apply?.skippedDueToModified === true);
}

async function testApplyForceModified(): Promise<void> {
  console.log('\n[8] --apply --force-apply-modified proceeds');
  const r = run(['upgrade', '--apply', '--force-apply-modified']);
  check('exit code 0', r.status === 0, `got ${r.status}; stderr=${r.stderr.slice(0, 200)}`);
  // Note: with the modified row already present, ON CONFLICT DO NOTHING keeps
  // the *tampered* SHA in place. The CLI's job is to apply pending; the
  // modified-warning is informational. Operators wanting the recorded hash
  // restored run a manual UPDATE per migration-system.md guidance.
  // For the smoke we just confirm the CLI did not fail.
  // Restore the recorded SHA to the real one so subsequent smoke runs find
  // a consistent state.
  await withClient(async (c) => {
    await c.query(
      `UPDATE atelier_schema_versions
         SET content_sha256 = $1
         WHERE filename = $2`,
      [computeSha256(SYNTH_SQL), SYNTH_FILENAME],
    );
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  // Pre-flight: ensure local Postgres is reachable.
  try {
    await withClient(async (c) => {
      await c.query('SELECT 1');
    });
  } catch (err) {
    console.error(`E2 upgrade smoke skipped: cannot connect to ${DB_URL}: ${err instanceof Error ? err.message : String(err)}`);
    console.error('Bring up the local stack via `supabase start` (or set DATABASE_URL).');
    process.exit(0);
  }

  // Ensure the bootstrap migration is applied (the smoke depends on the
  // baseline rows being present).
  const tableExists = await withClient(async (c) => {
    const r = await c.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name='atelier_schema_versions'
       ) AS exists`,
    );
    return r.rows[0]?.exists === true;
  });
  if (!tableExists) {
    console.error('E2 upgrade smoke skipped: atelier_schema_versions does not exist.');
    console.error('Run `supabase db reset --local` to apply all migrations cleanly.');
    process.exit(0);
  }

  // Ensure no leftover synthetic state from a previous failed run.
  await cleanup();

  try {
    await testCheckHealthy();
    await testCheckJson();
    await testPendingDetection();
    await testApplyDryRun();
    await testApplyReal();
    await testModifiedDetection();
    await testApplyRefusesModified();
    await testApplyForceModified();
  } finally {
    await cleanup();
  }

  console.log('');
  if (failures > 0) {
    console.log('=========================================');
    console.log(`FAIL: ${failures} assertion(s) failed`);
    console.log('=========================================');
    process.exit(1);
  }
  console.log('=========================================');
  console.log('ALL E2 UPGRADE SMOKE CHECKS PASSED');
  console.log('=========================================');
}

main().catch(async (err) => {
  console.error('E2 UPGRADE SMOKE CRASHED:', err);
  await cleanup();
  process.exit(2);
});
