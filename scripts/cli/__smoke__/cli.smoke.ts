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
  const dsInit = run(['datastore', 'init']);
  check('datastore init exits 0', dsInit.status === 0, `got ${dsInit.status}`);
  check('datastore init shows raw form (supabase db push)', dsInit.stdout.includes('supabase db push'));

  const dsBad = run(['datastore', 'invalid']);
  check('datastore <invalid> exits 2', dsBad.status === 2, `got ${dsBad.status}`);

  // territory add is polished form per D2 (PR #53). Missing-required-flags
  // exits 2 (non-TTY), --help exits 0, --dry-run with valid input exits 0
  // and renders a preview without touching the file.
  const terMissing = run(['territory', 'add']);
  check('territory add (no args, non-TTY) exits 2', terMissing.status === 2, `got ${terMissing.status}`);
  check('territory add error names the missing flags', terMissing.stderr.includes('--name'));

  const terDryRun = run([
    'territory', 'add',
    '--name', 'smoke-territory-do-not-commit',
    '--owner-role', 'dev',
    '--scope-kind', 'files',
    '--scope-pattern', 'smoke/**',
    '--description', 'Smoke-test only; never written.',
    '--dry-run',
  ]);
  check('territory add --dry-run exits 0', terDryRun.status === 0, `got ${terDryRun.status}`);
  check('territory add --dry-run prints DRY RUN banner', terDryRun.stdout.includes('DRY RUN'));
  check('territory add --dry-run renders the new entry', terDryRun.stdout.includes('- name: smoke-territory-do-not-commit'));

  const terDup = run([
    'territory', 'add',
    '--name', 'methodology',  // collides with the existing "methodology" territory
    '--owner-role', 'dev',
    '--scope-kind', 'files',
    '--scope-pattern', 'x/**',
    '--non-interactive',
  ]);
  check('territory add duplicate-name exits 1', terDup.status === 1, `got ${terDup.status}`);
  check('territory add duplicate-name names the conflict', terDup.stderr.includes('already exists'));

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
