#!/usr/bin/env -S npx tsx
//
// Focused smoke for `atelier deploy` (D6 polished form).
//
// Covers the paths cli.smoke.ts §10 deliberately avoids:
//   - --dry-run renders preflight + plan + step list, exits 0
//   - --dry-run --json emits valid JSON with plan + preflight
//   - missing-vercel-CLI rejection (preflight fail; exit 2)
//
// Does NOT cover:
//   - Real `vercel deploy` invocation (would consume a Vercel project +
//     credentials; not testable in CI without staging infrastructure)
//   - Real validation (typecheck/lint) and real build (would tie up the
//     test runner; covered by the parent build's CI pipeline)
//   - Post-deploy verification probes (require a live deploy URL)
//
// Documented gap: end-to-end deploy validation is the operator running
// `atelier deploy` against their Vercel project per first-deploy.md;
// CI catches the regression class via this smoke + cli.smoke.ts §10.

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

interface RunOptions { env?: NodeJS.ProcessEnv }

function run(args: readonly string[], opts: RunOptions = {}): { status: number | null; stdout: string; stderr: string } {
  const out = spawnSync('npx', ['tsx', CLI, ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: opts.env ?? process.env,
  });
  return { status: out.status, stdout: out.stdout, stderr: out.stderr };
}

// ---------------------------------------------------------------------------
// [1] --dry-run renders preflight + plan and exits 0
// ---------------------------------------------------------------------------
//
// Dry-run does NOT invoke vercel; it runs the preflight checks (which may
// surface OK or DEGRADED state depending on operator's local env), then
// renders the planned step list, and exits 0. We assert the expected
// section structure regardless of preflight outcome.
console.log('\n[1] --dry-run renders preflight + plan + steps');
{
  const r = run(['deploy', '--dry-run']);
  check('dry-run exits 0', r.status === 0, `got ${r.status}`);
  check('dry-run prints Pre-flight section', r.stdout.includes('Pre-flight:'));
  check('dry-run prints PLAN header', r.stdout.includes('PLAN (dry-run)'));
  check('dry-run names production mode by default', /mode\s+production/.test(r.stdout));
  check('dry-run mentions vercel deploy --prod step', r.stdout.includes('vercel deploy --prod'));
  check('dry-run mentions verification step', r.stdout.includes('verify discovery'));
  check('dry-run reports no mutations', r.stdout.includes('No mutations performed'));
}

// ---------------------------------------------------------------------------
// [2] --dry-run --preview switches mode + step verb
// ---------------------------------------------------------------------------
console.log('\n[2] --dry-run --preview switches mode');
{
  const r = run(['deploy', '--dry-run', '--preview']);
  check('--preview --dry-run exits 0', r.status === 0, `got ${r.status}`);
  check('mode is preview', /mode\s+preview/.test(r.stdout));
  check(
    'plan references `vercel deploy` (no --prod)',
    r.stdout.includes('`vercel deploy`'),
  );
}

// ---------------------------------------------------------------------------
// [3] --dry-run --json emits valid JSON with plan + preflight
// ---------------------------------------------------------------------------
console.log('\n[3] --dry-run --json emits machine-readable JSON');
{
  const r = run(['deploy', '--dry-run', '--json']);
  check('exits 0', r.status === 0, `got ${r.status}`);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    parsed = null;
  }
  check('valid JSON', parsed !== null);
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as {
      ok?: boolean;
      dryRun?: boolean;
      plan?: { mode?: string; vercelEnvironment?: string };
      preflight?: { cli?: { ok?: boolean }; ok?: boolean };
    };
    check('JSON ok=true', obj.ok === true);
    check('JSON dryRun=true', obj.dryRun === true);
    check('JSON plan.mode=production', obj.plan?.mode === 'production');
    check(
      'JSON plan.vercelEnvironment=production',
      obj.plan?.vercelEnvironment === 'production',
    );
    check('JSON preflight is present', obj.preflight !== undefined);
  }
}

// ---------------------------------------------------------------------------
// [4] --skip-checks + --skip-build flags surface in plan
// ---------------------------------------------------------------------------
console.log('\n[4] --skip-checks + --skip-build show in dry-run plan');
{
  const r = run(['deploy', '--dry-run', '--skip-checks', '--skip-build']);
  check('exits 0', r.status === 0, `got ${r.status}`);
  check('skip_checks=true in plan', /skip_checks\s+true/.test(r.stdout));
  check('skip_build=true in plan', /skip_build\s+true/.test(r.stdout));
  check(
    'plan notes skip-checks step suppression',
    r.stdout.includes('(skip-checks)'),
  );
  check(
    'plan notes skip-build step suppression',
    r.stdout.includes('(skip-build)'),
  );
}

// ---------------------------------------------------------------------------
// [5] Missing vercel CLI rejection (shim-overrides-real-vercel via PATH prefix)
// ---------------------------------------------------------------------------
//
// Prepend a temp directory to PATH containing a `vercel` shim that exits
// non-zero (simulating "vercel command not on PATH" by intercepting the
// resolution before any real vercel install). The original PATH stays
// intact so npx + tsx still resolve correctly.
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

console.log('\n[5] missing vercel CLI is a preflight failure');
{
  const shimDir = mkdtempSync(join(tmpdir(), 'atelier-deploy-smoke-bin-'));
  const shim = join(shimDir, 'vercel');
  // Shell shim that exits 127 (command not found semantics).
  writeFileSync(shim, '#!/bin/sh\nexit 127\n');
  chmodSync(shim, 0o755);

  try {
    const r = spawnSync('npx', ['tsx', CLI, 'deploy'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: `${shimDir}:${process.env.PATH ?? ''}` },
    });
    // Non-zero vercel --version -> preflight reports "not installed" -> exit 2.
    check('exits 2 (preflight failure)', r.status === 2, `got ${r.status}`);
    const combined = `${r.stderr}\n${r.stdout}`;
    check(
      'output names vercel CLI install hint',
      combined.includes('vercel CLI not installed'),
    );
    check(
      'output points at install command',
      combined.includes('npm install -g vercel'),
    );
  } finally {
    try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* ignore */ }
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
console.log(`ALL DEPLOY SMOKE CHECKS PASSED`);
console.log(`=========================================`);
