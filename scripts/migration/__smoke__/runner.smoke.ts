#!/usr/bin/env -S npx tsx
//
// Smoke for E1 migration substrate (manifest helpers + runner end-to-end).
//
// Sections:
//   [1] manifest helpers: filename parsing, hashing, directory enumeration
//   [2] discoverMigrations() against the canonical supabase/migrations/
//   [3] computeStatus() against a healthy datastore (all 10 baseline rows
//       present + bootstrap row sentinel handled): empty pending/modified/missing
//   [4] computeStatus() against a synthetic state: extra file on disk -> pending
//   [5] computeStatus() against a synthetic state: hash mismatch -> modified
//   [6] applyMigration() end-to-end: apply a no-op test migration, verify
//       schema_versions row recorded; then re-apply (idempotent) verifies
//       ON CONFLICT DO NOTHING semantics
//
// Cleanup: drops atelier_e1_smoke_* tables + deletes any test rows from
// atelier_schema_versions on exit.
//
// Run:  npx tsx scripts/migration/__smoke__/runner.smoke.ts

import { Client } from 'pg';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  cpSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  MigrationRunner,
  parseMigrationFilename,
  computeSha256,
  readMigrationsDirectory,
  BOOTSTRAP_HASH_SENTINEL,
} from '../runner.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

const cleanupTempDirs: string[] = [];
function tempRepoRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'atelier-e1-smoke-'));
  cleanupTempDirs.push(dir);
  return dir;
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
// [1] Manifest helpers
// ---------------------------------------------------------------------------
async function testManifestHelpers(): Promise<void> {
  console.log('\n[1] manifest helpers (filename parsing, hashing, dir enumeration)');

  // computeSha256 stable
  const a = computeSha256('hello');
  const b = computeSha256('hello');
  const c = computeSha256('hello\n');
  check('computeSha256 is deterministic', a === b);
  check('computeSha256 distinguishes content', a !== c);
  check(
    'computeSha256("hello") matches expected SHA-256',
    a === '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    a,
  );

  // parseMigrationFilename
  const parsed = parseMigrationFilename('20260428000001_atelier_m1_schema.sql');
  check('parseMigrationFilename extracts timestamp', parsed.timestamp === '20260428000001');
  check('parseMigrationFilename extracts slug', parsed.slug === 'atelier_m1_schema');

  // Reject malformed
  let rejectedNoTs = false;
  try { parseMigrationFilename('atelier_m1_schema.sql'); } catch { rejectedNoTs = true; }
  check('parseMigrationFilename rejects missing timestamp', rejectedNoTs);

  let rejectedNotSql = false;
  try { parseMigrationFilename('20260428000001_atelier_m1_schema.txt'); } catch { rejectedNotSql = true; }
  check('parseMigrationFilename rejects non-.sql extension', rejectedNotSql);

  let rejectedShortTs = false;
  try { parseMigrationFilename('2026_atelier_m1.sql'); } catch { rejectedShortTs = true; }
  check('parseMigrationFilename rejects short timestamp', rejectedShortTs);

  // readMigrationsDirectory against the real repo
  const real = await readMigrationsDirectory(REPO_ROOT);
  check('readMigrationsDirectory returns >=10 migrations', real.length >= 10, `len=${real.length}`);
  check(
    'readMigrationsDirectory results sorted lexicographically',
    real.every((m, i) => i === 0 || real[i - 1]!.filename < m.filename),
  );
  check(
    'readMigrationsDirectory hashes are stable hex',
    real.every((m) => /^[0-9a-f]{64}$/.test(m.sha256)),
  );

  // Each migration's hash equals computeSha256 of its content
  const inconsistent = real.find((m) => computeSha256(m.content) !== m.sha256);
  check('readMigrationsDirectory hash matches computeSha256(content)', !inconsistent, inconsistent?.filename);
}

// ---------------------------------------------------------------------------
// [2] discoverMigrations against the canonical repo
// ---------------------------------------------------------------------------
async function testDiscover(): Promise<void> {
  console.log('\n[2] discoverMigrations against canonical supabase/migrations/');
  const r = new MigrationRunner({ databaseUrl: DB_URL, repoRoot: REPO_ROOT, templateVersion: '1.0' });
  const ms = await r.discoverMigrations();
  check('discoverMigrations returns canonical list', ms.length >= 10);

  // Specific expected baseline filenames (M1 + M5 + bootstrap). We don't
  // assert exact count because future migrations will append.
  const filenames = new Set(ms.map((m) => m.filename));
  for (const expected of [
    '20260428000001_atelier_m1_schema.sql',
    '20260501000008_atelier_m5_embeddings_dim_1536.sql',
    '20260504000010_atelier_schema_versions.sql',
  ]) {
    check(`discover lists ${expected}`, filenames.has(expected));
  }
}

// ---------------------------------------------------------------------------
// [3] computeStatus against a healthy datastore (all baseline rows applied)
// ---------------------------------------------------------------------------
async function testComputeStatusHealthy(): Promise<void> {
  console.log('\n[3] computeStatus against healthy datastore');
  const r = new MigrationRunner({ databaseUrl: DB_URL, repoRoot: REPO_ROOT, templateVersion: '1.0' });
  const status = await r.computeStatus();
  check('healthy: pending is empty', status.pending.length === 0, `pending=${status.pending.map((m) => m.filename).join(',')}`);
  check('healthy: modified is empty', status.modified.length === 0, `modified=${status.modified.map((m) => m.filename).join(',')}`);
  check('healthy: missing is empty', status.missing.length === 0, `missing=${status.missing.map((m) => m.filename).join(',')}`);

  const applied = await r.loadAppliedMigrations();
  check('loadAppliedMigrations returns all baseline rows', applied.length >= 10, `len=${applied.length}`);
  const bootstrap = applied.find((a) => a.filename === '20260504000010_atelier_schema_versions.sql');
  check('bootstrap row carries sentinel hash', bootstrap?.contentSha256 === BOOTSTRAP_HASH_SENTINEL);
}

// ---------------------------------------------------------------------------
// [4] computeStatus with extra on-disk file -> pending
// ---------------------------------------------------------------------------
async function testStatusPending(): Promise<void> {
  console.log('\n[4] computeStatus with extra on-disk file -> pending');
  const tmp = tempRepoRoot();
  // Mirror real migrations into the temp dir.
  cpSync(join(REPO_ROOT, 'supabase'), join(tmp, 'supabase'), { recursive: true });

  // Add a synthetic future migration that is NOT in atelier_schema_versions.
  const phony = '29991231235959_atelier_e1_smoke_pending_test.sql';
  writeFileSync(
    join(tmp, 'supabase', 'migrations', phony),
    '-- E1 smoke: synthetic future migration\nSELECT 1;\n',
  );

  const r = new MigrationRunner({ databaseUrl: DB_URL, repoRoot: tmp, templateVersion: '1.0' });
  const status = await r.computeStatus();
  const pendingNames = status.pending.map((p) => p.filename);
  check('pending contains the synthetic file', pendingNames.includes(phony));
  check('pending count == 1 (only the synthetic file)', status.pending.length === 1, `pending=${pendingNames.join(',')}`);
  check('modified empty (real migrations untouched)', status.modified.length === 0);
  check('missing empty', status.missing.length === 0);
}

// ---------------------------------------------------------------------------
// [5] computeStatus with hash mismatch -> modified
// ---------------------------------------------------------------------------
async function testStatusModified(): Promise<void> {
  console.log('\n[5] computeStatus with hash mismatch -> modified');
  const tmp = tempRepoRoot();
  cpSync(join(REPO_ROOT, 'supabase'), join(tmp, 'supabase'), { recursive: true });
  const targetMigration = '20260428000001_atelier_m1_schema.sql';

  // Tamper: overwrite the canonical file with different content (any
  // change breaks the SHA). Hash sentinel rows (the bootstrap one) MUST
  // still be excluded from modified detection per the runner's rule.
  const tamperedPath = join(tmp, 'supabase', 'migrations', targetMigration);
  writeFileSync(tamperedPath, '-- tampered for E1 smoke test [5]\nSELECT 1;\n');

  const r = new MigrationRunner({ databaseUrl: DB_URL, repoRoot: tmp, templateVersion: '1.0' });
  const status = await r.computeStatus();
  const modifiedNames = status.modified.map((m) => m.filename);
  check('modified contains the tampered file', modifiedNames.includes(targetMigration));
  check('modified count == 1', status.modified.length === 1, `modified=${modifiedNames.join(',')}`);

  const detail = status.modified.find((m) => m.filename === targetMigration);
  check('modified entry carries localSha256 != appliedSha256', !!detail && detail.localSha256 !== detail.appliedSha256);
  check(
    'bootstrap row NOT reported as modified despite sentinel hash',
    !modifiedNames.includes('20260504000010_atelier_schema_versions.sql'),
  );

  // Pending should be empty (we did not add new files; we only modified one)
  check('pending empty', status.pending.length === 0);
  check('missing empty', status.missing.length === 0);
}

// ---------------------------------------------------------------------------
// [6] applyMigration end-to-end
// ---------------------------------------------------------------------------
const E1_TEST_TABLE = 'atelier_e1_smoke_test';
const E1_TEST_FILENAME = '29991231235960_atelier_e1_smoke_apply_test.sql';

async function testApplyMigrationEndToEnd(): Promise<void> {
  console.log('\n[6] applyMigration end-to-end (synthetic no-op migration)');

  // Build a synthetic migration that creates a tracking table. CREATE
  // TABLE IF NOT EXISTS so this is idempotent on re-apply (per the
  // contract documented in migration-system.md).
  const sql = [
    `-- E1 smoke synthetic migration; safe to re-apply.`,
    `CREATE TABLE IF NOT EXISTS ${E1_TEST_TABLE} (`,
    `  id     bigserial PRIMARY KEY,`,
    `  marker text      NOT NULL`,
    `);`,
    ``,
    `INSERT INTO ${E1_TEST_TABLE} (marker)`,
    `  SELECT 'e1-smoke-marker'`,
    `  WHERE NOT EXISTS (SELECT 1 FROM ${E1_TEST_TABLE} WHERE marker = 'e1-smoke-marker');`,
    ``,
  ].join('\n');

  const migration = {
    filename: E1_TEST_FILENAME,
    absolutePath: '/synthetic/' + E1_TEST_FILENAME,
    timestamp: '29991231235960',
    slug: 'atelier_e1_smoke_apply_test',
    content: sql,
    sha256: computeSha256(sql),
  };

  const r = new MigrationRunner({
    databaseUrl: DB_URL,
    repoRoot: REPO_ROOT,
    templateVersion: '1.0',
    appliedBy: 'e1-smoke',
  });

  // Apply
  await r.applyMigration(migration);

  // Verify table created + marker row inserted
  await withClient(async (c) => {
    const { rows } = await c.query<{ marker: string }>(`SELECT marker FROM ${E1_TEST_TABLE}`);
    check('apply created the test table', rows.length >= 1);
    check('apply inserted the marker row', rows.some((r) => r.marker === 'e1-smoke-marker'));
  });

  // Verify schema_versions row recorded
  const applied1 = await r.loadAppliedMigrations();
  const row1 = applied1.find((a) => a.filename === E1_TEST_FILENAME);
  check('schema_versions row recorded on apply', row1 !== undefined);
  check('row.content_sha256 matches migration.sha256', row1?.contentSha256 === migration.sha256);
  check('row.applied_by matches runner constructor option', row1?.appliedBy === 'e1-smoke');
  check('row.atelier_template_version matches runner constructor option', row1?.atelierTemplateVersion === '1.0');

  // Re-apply: should be a no-op (CREATE TABLE IF NOT EXISTS + ON CONFLICT
  // DO NOTHING). The applied_at timestamp should NOT change because the
  // INSERT was a no-op.
  const firstAppliedAt = row1!.appliedAt;
  await r.applyMigration(migration);
  const applied2 = await r.loadAppliedMigrations();
  const row2 = applied2.find((a) => a.filename === E1_TEST_FILENAME);
  check('re-apply is idempotent (no error)', row2 !== undefined);
  check(
    're-apply did NOT update applied_at (ON CONFLICT DO NOTHING)',
    row2!.appliedAt.getTime() === firstAppliedAt.getTime(),
    `first=${firstAppliedAt.toISOString()} after=${row2!.appliedAt.toISOString()}`,
  );

  // Marker count should still be 1 (the migration's own WHERE NOT EXISTS
  // guard prevented re-insertion).
  await withClient(async (c) => {
    const { rows } = await c.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${E1_TEST_TABLE} WHERE marker = 'e1-smoke-marker'`,
    );
    check('marker row count == 1 after re-apply', rows[0]?.count === '1', `count=${rows[0]?.count}`);
  });
}

// ---------------------------------------------------------------------------
// [7] X1 audit B4 — statement_timeout is set inside the apply transaction.
// ---------------------------------------------------------------------------
const X1_TIMEOUT_TEST_TABLE = 'atelier_x1_timeout_probe';
const X1_TIMEOUT_TEST_FILENAME = '29991231235961_atelier_x1_timeout_probe.sql';

async function testStatementTimeout(): Promise<void> {
  console.log('\n[7] X1 audit B4 — statement_timeout set inside apply transaction');

  // The migration body queries pg_settings to capture the in-transaction
  // statement_timeout and writes it into a probe row we can read after.
  const sql = [
    `CREATE TABLE IF NOT EXISTS ${X1_TIMEOUT_TEST_TABLE} (timeout_ms text);`,
    `INSERT INTO ${X1_TIMEOUT_TEST_TABLE} (timeout_ms)`,
    `  SELECT setting FROM pg_settings WHERE name = 'statement_timeout';`,
  ].join('\n');

  const migration = {
    filename: X1_TIMEOUT_TEST_FILENAME,
    absolutePath: '/synthetic/' + X1_TIMEOUT_TEST_FILENAME,
    timestamp: '29991231235961',
    slug: 'atelier_x1_timeout_probe',
    content: sql,
    sha256: computeSha256(sql),
  };

  const r = new MigrationRunner({
    databaseUrl: DB_URL,
    repoRoot: REPO_ROOT,
    templateVersion: '1.0',
    appliedBy: 'x1-smoke',
    statementTimeoutMs: 600_000,
  });
  await r.applyMigration(migration);

  await withClient(async (c) => {
    const { rows } = await c.query<{ timeout_ms: string }>(
      `SELECT timeout_ms FROM ${X1_TIMEOUT_TEST_TABLE} ORDER BY ctid DESC LIMIT 1`,
    );
    const captured = rows[0]?.timeout_ms ?? '';
    check(
      'transaction observed non-default statement_timeout',
      captured === '600000' || captured === '600s',
      `captured=${captured}`,
    );
  });
}

async function testParallelApplyAdvisoryLock(): Promise<void> {
  console.log('\n[8] X1 audit D2 — concurrent applyMigration is serialized');

  const PARALLEL_TABLE = 'atelier_x1_parallel_probe';
  const PARALLEL_FILENAME = '29991231235962_atelier_x1_parallel_probe.sql';

  // The migration body asserts the table doesn't already have the row, then
  // inserts. Without the advisory lock, two concurrent appliers could race
  // to the SELECT before either's INSERT lands. With the lock, the second
  // applier blocks until the first commits, then sees the row in
  // schema_versions and skips its content execution path entirely.
  const sql = [
    `CREATE TABLE IF NOT EXISTS ${PARALLEL_TABLE} (id serial PRIMARY KEY, marker text NOT NULL UNIQUE);`,
    `INSERT INTO ${PARALLEL_TABLE} (marker) VALUES ('x1-marker') ON CONFLICT DO NOTHING;`,
  ].join('\n');

  const migration = {
    filename: PARALLEL_FILENAME,
    absolutePath: '/synthetic/' + PARALLEL_FILENAME,
    timestamp: '29991231235962',
    slug: 'atelier_x1_parallel_probe',
    content: sql,
    sha256: computeSha256(sql),
  };

  const runners = [0, 1].map(() => new MigrationRunner({
    databaseUrl: DB_URL,
    repoRoot: REPO_ROOT,
    templateVersion: '1.0',
    appliedBy: 'x1-parallel',
  }));

  const results = await Promise.allSettled(runners.map((rr) => rr.applyMigration(migration)));
  for (const [i, res] of results.entries()) {
    check(`parallel runner #${i} did not reject`, res.status === 'fulfilled', res.status === 'rejected' ? `${res.reason}` : '');
  }

  await withClient(async (c) => {
    const { rows } = await c.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${PARALLEL_TABLE} WHERE marker = 'x1-marker'`,
    );
    check(
      'exactly one marker row after parallel applies (no double-insert)',
      rows[0]?.count === '1',
      `count=${rows[0]?.count}`,
    );
    const appliedRows = await c.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM atelier_schema_versions WHERE filename = $1`,
      [PARALLEL_FILENAME],
    );
    check(
      'exactly one schema_versions row recorded',
      appliedRows.rows[0]?.count === '1',
      `count=${appliedRows.rows[0]?.count}`,
    );
  });

  // Cleanup
  await withClient(async (c) => {
    await c.query(`DROP TABLE IF EXISTS ${PARALLEL_TABLE}`);
    await c.query(`DELETE FROM atelier_schema_versions WHERE filename = $1`, [PARALLEL_FILENAME]);
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
async function cleanup(): Promise<void> {
  // Drop the test table + delete the schema_versions row so re-running the
  // smoke is a no-op. Includes the X1 probes added in [7] + [8].
  await withClient(async (c) => {
    await c.query(`DROP TABLE IF EXISTS ${E1_TEST_TABLE}`);
    await c.query(`DROP TABLE IF EXISTS ${X1_TIMEOUT_TEST_TABLE}`);
    await c.query(`DELETE FROM atelier_schema_versions WHERE filename = $1`, [E1_TEST_FILENAME]);
    await c.query(`DELETE FROM atelier_schema_versions WHERE filename = $1`, [X1_TIMEOUT_TEST_FILENAME]);
  }).catch((err) => {
    console.error(`cleanup warn: ${err instanceof Error ? err.message : String(err)}`);
  });
  for (const dir of cleanupTempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
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
    console.error(`E1 smoke skipped: cannot connect to ${DB_URL}: ${err instanceof Error ? err.message : String(err)}`);
    console.error('Bring up the local stack via `supabase start` (or set DATABASE_URL).');
    process.exit(0);
  }

  // Ensure migration 10 has been applied (the smoke depends on the
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
    console.error('E1 smoke skipped: atelier_schema_versions does not exist.');
    console.error('Apply migration 10 first: `psql "$DATABASE_URL" -f supabase/migrations/20260504000010_atelier_schema_versions.sql`');
    console.error('  or run `supabase db reset --local` to apply all migrations cleanly.');
    process.exit(0);
  }

  try {
    await testManifestHelpers();
    await testDiscover();
    await testComputeStatusHealthy();
    await testStatusPending();
    await testStatusModified();
    await testApplyMigrationEndToEnd();
    await testStatementTimeout();
    await testParallelApplyAdvisoryLock();
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
  console.log('ALL E1 MIGRATION SMOKE CHECKS PASSED');
  console.log('=========================================');
}

main().catch((err) => {
  console.error('E1 SMOKE CRASHED:', err);
  process.exit(2);
});

// Suppress "imported but not used" for readdirSync (kept for future use).
void readdirSync;
