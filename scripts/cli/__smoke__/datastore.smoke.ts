#!/usr/bin/env -S npx tsx
//
// Substrate-touching smoke for D3 -- atelier datastore init.
//
// Validates the polished CLI against a real local Supabase stack:
//   [A] argv-handling tests (do NOT require a live DB; cover --help,
//       missing required flags, --reset gating, --remote without env, etc.)
//   [B] integration tests (REQUIRE local Supabase running; cover dry-run
//       plan rendering, schema verification against the 11 ARCH 5.1 tables,
//       json output shape).
//
// Self-disabling [B]: when local Supabase is unreachable (no docker, no
// supabase CLI, or `supabase status` returns non-zero), [B] cleanly
// skips with PASS/SKIP markers rather than hanging or failing — Q1
// pattern from the X1 audit. [A] always runs.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CLI = resolve(REPO_ROOT, 'scripts/cli/atelier.ts');

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(args: readonly string[], envOverrides: Record<string, string> = {}): RunResult {
  const env = { ...process.env, ...envOverrides };
  const out = spawnSync('npx', ['tsx', CLI, 'datastore', ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env,
  });
  return { status: out.status, stdout: out.stdout, stderr: out.stderr };
}

function isLocalSupabaseReachable(): boolean {
  // Prefer a fast probe that does not require docker to actually be
  // healthy: `supabase status` returns 0 only when the local stack is up.
  const out = spawnSync('supabase', ['status'], { encoding: 'utf8', timeout: 5000 });
  return out.status === 0;
}

console.log('# D3 datastore smoke');

// ---------------------------------------------------------------------------
// [A] argv-handling (no live DB required)
// ---------------------------------------------------------------------------
console.log('\n[A] argv-handling tests (no DB required)');

// [A.1] --help
console.log('\n  [A.1] --help');
{
  const r = run(['--help']);
  check('--help exits 0', r.status === 0, `got ${r.status}`);
  check('--help mentions Usage:', r.stdout.includes('Usage:'));
  check('--help mentions init', r.stdout.includes('init'));
  check('--help mentions --remote / --local', r.stdout.includes('--remote') && r.stdout.includes('--local'));
  check('--help mentions --reset', r.stdout.includes('--reset'));
  check('--help mentions --seed', r.stdout.includes('--seed'));
  check('--help mentions --dry-run', r.stdout.includes('--dry-run'));
  check('--help mentions --json', r.stdout.includes('--json'));
  check('--help mentions ARCH 5.1 tables verification', r.stdout.includes('ARCH 5.1'));
  check('--help references local-bootstrap.md', r.stdout.includes('local-bootstrap.md'));
  check('--help references first-deploy.md', r.stdout.includes('first-deploy.md'));

  const initHelp = run(['init', '--help']);
  check('init --help exits 0', initHelp.status === 0, `got ${initHelp.status}`);
  check('init --help mentions init flags', initHelp.stdout.includes('--reset'));
}

// [A.2] unknown subcommand
console.log('\n  [A.2] unknown subcommand');
{
  const r = run(['nonexistent']);
  check('unknown subcommand exits 2', r.status === 2, `got ${r.status}`);
  check('error mentions "unknown subcommand"', r.stderr.includes('unknown subcommand'));
}

// [A.3] init unknown flag
console.log('\n  [A.3] init unknown flag');
{
  const r = run(['init', '--bogus']);
  check('init --bogus exits 2', r.status === 2, `got ${r.status}`);
  check('init --bogus names the flag', r.stderr.includes('--bogus'));
}

// [A.4] --remote without env
console.log('\n  [A.4] --remote without ATELIER_DATASTORE_URL exits 2');
{
  const r = run(['init', '--remote', '--dry-run'], { ATELIER_DATASTORE_URL: '', DATABASE_URL: '' });
  check('--remote (no env) exits 2', r.status === 2, `got ${r.status}`);
  check(
    '--remote (no env) names the missing env var',
    r.stderr.includes('ATELIER_DATASTORE_URL') || r.stderr.includes('DATABASE_URL'),
  );
}

// [A.5] --remote + --local mutex
console.log('\n  [A.5] --remote + --local mutually exclusive');
{
  const r = run(['init', '--remote', '--local']);
  check('--remote --local exits 2', r.status === 2, `got ${r.status}`);
  check('error names the mutex', r.stderr.includes('mutually exclusive'));
}

// [A.6] --reset without --yes in non-interactive mode
console.log('\n  [A.6] --reset gating in non-interactive mode');
{
  const r = run(['init', '--reset', '--non-interactive']);
  check('--reset --non-interactive (no --yes) exits 2', r.status === 2, `got ${r.status}`);
  check('error names --yes requirement', r.stderr.includes('--yes'));
}

// [A.7] --seed without --email/--password in non-interactive mode
console.log('\n  [A.7] --seed gating in non-interactive mode');
{
  const r = run(['init', '--seed', '--non-interactive']);
  check('--seed --non-interactive (no creds) exits 2', r.status === 2, `got ${r.status}`);
  check(
    'error names --email / --password requirement',
    r.stderr.includes('--email') && r.stderr.includes('--password'),
  );
}

// ---------------------------------------------------------------------------
// [B] integration tests (require live local Supabase)
// ---------------------------------------------------------------------------
console.log('\n[B] integration tests (require local Supabase)');

if (!isLocalSupabaseReachable()) {
  console.log('  SKIP  local Supabase unreachable; skipping [B] integration tests');
  console.log('         (Q1 self-disabling pattern: smoke proceeds, [B] passes vacuously)');
} else {
  // [B.1] --dry-run renders plan, no mutation, exits 0
  console.log('\n  [B.1] --dry-run renders plan in local mode');
  {
    const r = run(['init', '--dry-run']);
    check('local --dry-run exits 0', r.status === 0, `got ${r.status}; stderr=${r.stderr.slice(0, 200)}`);
    check('local --dry-run mentions DRY RUN', r.stdout.includes('DRY RUN'));
    check('local --dry-run mentions Mode: local', r.stdout.includes('Mode:') && r.stdout.includes('local'));
    check('local --dry-run mentions Local plan', r.stdout.includes('Local plan'));
  }

  // [B.2] --dry-run --json carries plan structure
  console.log('\n  [B.2] --dry-run --json shape');
  {
    const r = run(['init', '--dry-run', '--json']);
    check('local --dry-run --json exits 0', r.status === 0, `got ${r.status}; stderr=${r.stderr.slice(0, 200)}`);
    let parsed: { ok?: boolean; mode?: string; dryRun?: boolean; local?: { plan?: unknown } } | null = null;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      parsed = null;
    }
    check('local --dry-run --json is valid JSON', parsed !== null);
    check('json carries ok=true', parsed?.ok === true);
    check('json carries mode=local', parsed?.mode === 'local');
    check('json carries dryRun=true', parsed?.dryRun === true);
    check('json carries local.plan', parsed?.local?.plan !== undefined);
  }

  // [B.3] real --json run: schema verification reports the 11 ARCH 5.1 tables
  console.log('\n  [B.3] real init --json verifies schema');
  {
    // The local stack is already up (we just probed). init when supabase
    // is already running is a no-op: it skips start, skips reset, runs
    // schema verification only. This is the safe, idempotent path.
    const r = run(['init', '--json']);
    // Exit code: 0 if schema verification passes (which it should against
    // a healthy local stack); 1 if any of the 11 tables are missing.
    check('real init --json exits 0', r.status === 0, `got ${r.status}; stderr=${r.stderr.slice(0, 200)}`);
    let parsed: {
      ok?: boolean;
      mode?: string;
      schema?: { ok?: boolean; presentTables?: string[]; missingTables?: string[] };
    } | null = null;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      parsed = null;
    }
    check('real init --json is valid JSON', parsed !== null);
    check('json carries ok=true', parsed?.ok === true);
    check('json carries mode=local', parsed?.mode === 'local');
    check('json carries schema.ok=true', parsed?.schema?.ok === true);
    check(
      'json carries all 11 ARCH 5.1 tables present',
      Array.isArray(parsed?.schema?.presentTables) && parsed!.schema!.presentTables!.length === 11,
      `present.length=${parsed?.schema?.presentTables?.length ?? '?'}`,
    );
    check(
      'json carries missingTables empty',
      Array.isArray(parsed?.schema?.missingTables) && parsed!.schema!.missingTables!.length === 0,
    );
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
if (failures > 0) {
  console.log(`=========================================`);
  console.log(`FAIL: ${failures} assertion(s) failed`);
  console.log(`=========================================`);
  process.exit(1);
}
console.log(`=========================================`);
console.log(`ALL D3 DATASTORE SMOKE CHECKS PASSED`);
console.log(`=========================================`);
process.exit(0);
