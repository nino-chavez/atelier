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
