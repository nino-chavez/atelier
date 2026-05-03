#!/usr/bin/env -S npx tsx
//
// CLI smoke test: validates the dispatcher and `atelier dev` shape without
// actually orchestrating substrate startup. Covers the surface contracts:
//
//   - `atelier --help` prints usage
//   - `atelier <unknown>` exits non-zero with a clear error
//   - `atelier dev --help` prints command-specific usage
//   - `atelier dev --preflight-only` runs pre-flight + exits with status
//     reflecting the report
//
// Does NOT cover:
//   - Live substrate startup (would tie up processes; covered by manual
//     end-to-end + the operator running `atelier dev` for real)
//   - Bearer rotation (covered by scripts/bootstrap/rotate-bearer.ts manual
//     verification + cc-mcp-client.smoke.ts substrate-side rotation)

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

function run(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const out = spawnSync('npx', ['tsx', CLI, ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
  return { status: out.status, stdout: out.stdout, stderr: out.stderr };
}

// ---------------------------------------------------------------------------
// [1] Top-level --help
// ---------------------------------------------------------------------------
console.log('\n[1] atelier --help prints usage');
{
  const r = run(['--help']);
  check('exit code 0', r.status === 0, `got ${r.status}`);
  check('mentions "Commands:" header', r.stdout.includes('Commands:'));
  check('lists dev command', /\bdev\b/.test(r.stdout));
  check('hints at 12 v1 commands', r.stdout.includes('BUILD-SEQUENCE'));
}

// ---------------------------------------------------------------------------
// [2] Unknown command
// ---------------------------------------------------------------------------
console.log('\n[2] atelier <unknown> exits non-zero');
{
  const r = run(['nonexistent']);
  check('exit code 2', r.status === 2, `got ${r.status}`);
  check('error mentions "unknown command"', r.stderr.includes('unknown command'));
}

// ---------------------------------------------------------------------------
// [3] atelier dev --help
// ---------------------------------------------------------------------------
console.log('\n[3] atelier dev --help prints command usage');
{
  const r = run(['dev', '--help']);
  check('exit code 0', r.status === 0, `got ${r.status}`);
  check('mentions Usage:', r.stdout.includes('Usage:'));
  check('mentions --no-bearer-rotation flag', r.stdout.includes('--no-bearer-rotation'));
  check('mentions --preflight-only flag', r.stdout.includes('--preflight-only'));
  check('cross-references local-bootstrap.md', r.stdout.includes('local-bootstrap.md'));
  check('cross-references US-11.13', r.stdout.includes('US-11.13'));
}

// ---------------------------------------------------------------------------
// [4] atelier dev --preflight-only does not orchestrate
// ---------------------------------------------------------------------------
console.log('\n[4] atelier dev --preflight-only is non-orchestrating');
{
  const r = run(['dev', '--preflight-only']);
  // Exit code is 0 if all preflight passes; 1 otherwise. We don't enforce
  // either since the smoke runs in environments with varying setup; we
  // assert the run terminated cleanly (not 2 = configuration error).
  check('exits 0 or 1 (not 2)', r.status === 0 || r.status === 1, `got ${r.status}`);
  check('runs pre-flight section', r.stdout.includes('Pre-flight:'));
  check('does NOT start supabase', !r.stdout.includes('starting supabase'));
  check('does NOT start dev server', !r.stdout.includes('starting prototype dev server'));
}

// ---------------------------------------------------------------------------
// [5] All 12 polished commands are registered + each surfaces --help
// ---------------------------------------------------------------------------
//
// Per BUILD-SEQUENCE §9 the polished CLI surface is 12 commands; `dev` (#13)
// shipped at PR #35. This batch verifies the dispatcher knows about every
// command and each one's `--help` produces the per-command usage block.
console.log('\n[5] all 12 polished commands surface --help');
{
  const COMMANDS_TO_CHECK = [
    'init', 'datastore', 'deploy', 'invite', 'territory', 'doctor', 'upgrade',
    'sync', 'reconcile', 'eval', 'audit', 'review',
  ];
  for (const cmd of COMMANDS_TO_CHECK) {
    const r = run([cmd, '--help']);
    check(`${cmd} --help exits 0`, r.status === 0, `got ${r.status}`);
    check(`${cmd} --help mentions Usage:`, r.stdout.includes('Usage:'));
  }
}

// ---------------------------------------------------------------------------
// [6] Pointer-stub commands print v1.x deferral message + raw equivalent
// ---------------------------------------------------------------------------
//
// Per Nino's 2026-05-02 brief: stubs must run, print "polished form lands in
// v1.x; for v1 do X via <raw equivalent>", exit 0. This batch verifies the
// stubs honor that contract (init = timeline-deferred; upgrade = scope-deferred
// with the additional v1.x-not-just-CLI framing).
console.log('\n[6] pointer-stubs honor v1.x deferral contract');
{
  const stubInit = run(['init']);
  check('atelier init exits 0', stubInit.status === 0, `got ${stubInit.status}`);
  check('atelier init mentions v1.x', stubInit.stdout.includes('v1.x'));
  check('atelier init names the raw equivalent', stubInit.stdout.includes('git clone'));

  const stubUpgrade = run(['upgrade']);
  check('atelier upgrade exits 0', stubUpgrade.status === 0, `got ${stubUpgrade.status}`);
  check('atelier upgrade flags scope-deferred', stubUpgrade.stdout.includes('SCOPE-DEFERRED'));
  check('atelier upgrade points at BRD-OPEN-QUESTIONS', stubUpgrade.stdout.includes('BRD-OPEN-QUESTIONS'));
}

// ---------------------------------------------------------------------------
// [7] Multi-word command dispatch (datastore init, territory add, eval find_similar)
// ---------------------------------------------------------------------------
console.log('\n[7] multi-word commands dispatch correctly');
{
  // datastore init is polished form per D3 (this PR). --dry-run renders
  // the plan + auto-detected mode + DB host without touching anything.
  // Local mode is the default when no ATELIER_DATASTORE_URL is set.
  const dsDryRun = run(['datastore', 'init', '--dry-run']);
  check('datastore init --dry-run exits 0', dsDryRun.status === 0, `got ${dsDryRun.status}`);
  check('datastore init --dry-run prints DRY RUN banner', dsDryRun.stdout.includes('DRY RUN'));
  check('datastore init --dry-run names auto-detected mode', /Mode:\s+(local|cloud)/.test(dsDryRun.stdout));
  check('datastore init --dry-run surfaces DB host line', dsDryRun.stdout.includes('DB host:'));

  // --json mode: parses cleanly and exposes the InitJsonOutput shape.
  const dsJson = run(['datastore', 'init', '--dry-run', '--json']);
  check('datastore init --dry-run --json exits 0', dsJson.status === 0, `got ${dsJson.status}`);
  type DsInitJson = { ok: boolean; mode: string; dryRun: boolean };
  let parsedJson: DsInitJson | null = null;
  try {
    parsedJson = JSON.parse(dsJson.stdout) as DsInitJson;
  } catch {
    parsedJson = null;
  }
  check('datastore init --json emits parseable JSON', parsedJson !== null);
  check('datastore init --json reports dryRun: true', parsedJson?.dryRun === true);
  check('datastore init --json reports mode in {local, cloud}', parsedJson?.mode === 'local' || parsedJson?.mode === 'cloud');

  // Precondition: --reset without --yes (in non-interactive) is a usage error.
  const dsResetGated = run(['datastore', 'init', '--reset', '--non-interactive']);
  check('datastore init --reset (non-interactive) without --yes exits 2', dsResetGated.status === 2, `got ${dsResetGated.status}`);
  check('datastore init --reset error names --yes', dsResetGated.stderr.includes('--yes'));

  // Precondition: --seed without --email/--password (in non-interactive) is exit 2.
  const dsSeedGated = run(['datastore', 'init', '--seed', '--non-interactive']);
  check('datastore init --seed (non-interactive) without creds exits 2', dsSeedGated.status === 2, `got ${dsSeedGated.status}`);
  check('datastore init --seed error names --email', dsSeedGated.stderr.includes('--email'));

  // Precondition: --remote without ATELIER_DATASTORE_URL/DATABASE_URL is exit 2.
  // spawnSync inherits parent env so we override it with the relevant vars stripped.
  const dsRemoteGated = spawnSync('npx', ['tsx', CLI, 'datastore', 'init', '--remote'], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k !== 'ATELIER_DATASTORE_URL' && k !== 'DATABASE_URL'),
    ) as NodeJS.ProcessEnv,
  });
  check('datastore init --remote without URL exits 2', dsRemoteGated.status === 2, `got ${dsRemoteGated.status}`);
  check('datastore init --remote error names ATELIER_DATASTORE_URL', dsRemoteGated.stderr.includes('ATELIER_DATASTORE_URL'));

  // Mutual-exclusion: --remote + --local exits 2 with clear message.
  const dsConflict = run(['datastore', 'init', '--remote', '--local']);
  check('datastore init --remote --local exits 2', dsConflict.status === 2, `got ${dsConflict.status}`);
  check('datastore init mutual-exclusion error mentions both flags', dsConflict.stderr.includes('--remote') && dsConflict.stderr.includes('--local'));

  // Unknown subcommand still exits 2.
  const dsBad = run(['datastore', 'invalid']);
  check('datastore <invalid> exits 2', dsBad.status === 2, `got ${dsBad.status}`);

  const terAdd = run(['territory', 'add']);
  check('territory add exits 0', terAdd.status === 0, `got ${terAdd.status}`);
  check('territory add references territories.yaml', terAdd.stdout.includes('.atelier/territories.yaml'));

  const evalBad = run(['eval', 'invalid']);
  check('eval <invalid> exits 2', evalBad.status === 2, `got ${evalBad.status}`);
}

// ---------------------------------------------------------------------------
// [8] atelier review (inline implementation; no DB/network)
// ---------------------------------------------------------------------------
console.log('\n[8] atelier review computes from territories.yaml');
{
  const empty = run(['review']);
  check('review with no args exits 2', empty.status === 2, `got ${empty.status}`);

  const real = run(['review', 'docs/architecture/ARCHITECTURE.md']);
  check('review <real-file> exits 0', real.status === 0, `got ${real.status}`);
  check('review names the matched territory', real.stdout.includes('Territory:'));
  check('review surfaces review_role', real.stdout.includes('review_role:'));
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
console.log(`ALL CLI SMOKE CHECKS PASSED`);
console.log(`=========================================`);
