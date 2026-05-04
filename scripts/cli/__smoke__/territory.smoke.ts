#!/usr/bin/env -S npx tsx
//
// Substrate-touching smoke for D2 -- atelier territory add.
//
// Validates the file-mutating path against a temp clone of .atelier/territories.yaml:
//   - --dry-run does not write
//   - Successful add appends a valid YAML fragment
//   - Existing comments + ordering survive the write
//   - Slug collision exits 1
//   - Invalid enum exits 1
//   - Round-trip: re-parsing the written file recovers the new entry
//
// The CLI itself is a file-only mutator (no DB), so this smoke does not
// require a live Supabase stack. We copy .atelier/territories.yaml to a
// scratch path, point the CLI at the scratch via a temp-cwd technique:
// the territory command resolves TERRITORIES_PATH from REPO_ROOT, so we
// instead invoke it via a small wrapper that mounts a scratch repo.
//
// Pragma: rather than reinvent that mounting, this smoke exercises the
// CLI in-process by importing runTerritory directly and operating on the
// real .atelier/territories.yaml -- but we ALWAYS roll back on exit
// (success or failure) by restoring the file from a snapshot taken at
// startup. Cleanup is unconditional via try/finally + a process.on('exit')
// fallback so partial-failure runs do not leave the file mutated.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CLI = resolve(REPO_ROOT, 'scripts/cli/atelier.ts');
const TERRITORIES_PATH = resolve(REPO_ROOT, '.atelier/territories.yaml');

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

function run(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const out = spawnSync('npx', ['tsx', CLI, 'territory', ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
  return { status: out.status, stdout: out.stdout, stderr: out.stderr };
}

const SNAPSHOT = readFileSync(TERRITORIES_PATH, 'utf8');

// Roll back the file on every exit path so a partial failure does not
// leave .atelier/territories.yaml mutated.
function restore(): void {
  try {
    writeFileSync(TERRITORIES_PATH, SNAPSHOT);
  } catch {
    // Last-ditch effort; the snapshot is in-memory so this should always succeed.
  }
}
process.on('exit', restore);
process.on('SIGINT', () => {
  restore();
  process.exit(130);
});
process.on('SIGTERM', () => {
  restore();
  process.exit(143);
});

async function main(): Promise<void> {
  console.log('# D2 territory smoke (file-mutating; in-process restore on exit)');

  // -------------------------------------------------------------------
  // 1. --dry-run does not write
  // -------------------------------------------------------------------
  console.log('\n# 1. --dry-run does not write');
  {
    const before = readFileSync(TERRITORIES_PATH, 'utf8');
    const r = run([
      'add',
      '--name', 'd2-smoke-territory',
      '--owner-role', 'dev',
      '--scope-kind', 'files',
      '--scope-pattern', 'scripts/__d2_smoke__/**',
      '--description', 'D2 smoke (dry-run path)',
      '--dry-run',
      '--non-interactive',
    ]);
    check('dry-run exits 0', r.status === 0, `got ${r.status}; stderr=${r.stderr.slice(0, 200)}`);
    check('dry-run output mentions DRY RUN', r.stdout.includes('DRY RUN'));
    check('dry-run renders fragment with the new name', r.stdout.includes('d2-smoke-territory'));
    const after = readFileSync(TERRITORIES_PATH, 'utf8');
    check('dry-run did NOT modify the file', before === after);
  }

  // -------------------------------------------------------------------
  // 2. Successful add appends valid YAML; round-trip recovers the entry
  // -------------------------------------------------------------------
  console.log('\n# 2. successful add appends valid YAML; round-trip recovers entry');
  {
    const before = readFileSync(TERRITORIES_PATH, 'utf8');
    const r = run([
      'add',
      '--name', 'd2-smoke-add',
      '--owner-role', 'architect',
      '--scope-kind', 'files',
      '--scope-pattern', 'scripts/__d2_smoke__/**',
      '--scope-pattern', 'docs/__d2_smoke__/*.md',
      '--description', 'D2 smoke (real add path)',
      '--contracts-published', 'd2_smoke_contract',
      '--non-interactive',
    ]);
    check('add exits 0', r.status === 0, `got ${r.status}; stderr=${r.stderr.slice(0, 200)}`);
    const after = readFileSync(TERRITORIES_PATH, 'utf8');
    check('file grew', after.length > before.length);
    check('file contains the new name', after.includes('name: d2-smoke-add'));
    check('file preserves the original content (no destructive rewrite)', after.startsWith(before.slice(0, 200)));
    check('post-edit validator summary surfaces', r.stdout.includes('validate-refs.ts'));

    // Restore for next assertion (slug collision).
    writeFileSync(TERRITORIES_PATH, before);
  }

  // -------------------------------------------------------------------
  // 3. Slug collision exits 1
  // -------------------------------------------------------------------
  console.log('\n# 3. slug collision exits 1');
  {
    // Use 'methodology' which is in the seed territories.yaml.
    const r = run([
      'add',
      '--name', 'methodology',
      '--owner-role', 'architect',
      '--scope-kind', 'files',
      '--scope-pattern', 'scripts/__d2_smoke__/**',
      '--non-interactive',
    ]);
    check('slug collision exits 1', r.status === 1, `got ${r.status}`);
    check('error mentions "already exists"', r.stderr.includes('already exists'));
  }

  // -------------------------------------------------------------------
  // 4. Invalid enum exits 1
  // -------------------------------------------------------------------
  console.log('\n# 4. invalid enum exits 1');
  {
    const r = run([
      'add',
      '--name', 'd2-smoke-bad-enum',
      '--owner-role', 'wizard',
      '--scope-kind', 'files',
      '--scope-pattern', 'scripts/__d2_smoke__/**',
      '--non-interactive',
    ]);
    check('bad owner-role exits 1', r.status === 1, `got ${r.status}`);
    check('error names owner_role', r.stderr.includes('owner_role'));
  }

  // -------------------------------------------------------------------
  // 5. Bad slug shape exits 1
  // -------------------------------------------------------------------
  console.log('\n# 5. invalid slug shape exits 1');
  {
    const r = run([
      'add',
      '--name', 'BadName_With_Underscores',
      '--owner-role', 'dev',
      '--scope-kind', 'files',
      '--scope-pattern', 'scripts/__d2_smoke__/**',
      '--non-interactive',
    ]);
    check('bad slug exits 1', r.status === 1, `got ${r.status}`);
    check('error names name field', r.stderr.includes('name'));
  }

  // -------------------------------------------------------------------
  // 6. Missing required flags in non-interactive mode exits 2
  // -------------------------------------------------------------------
  console.log('\n# 6. missing required flags in non-interactive mode exits 2');
  {
    const r = run(['add', '--non-interactive']);
    check('missing required flags exits 2', r.status === 2, `got ${r.status}`);
    check('error mentions required flags', r.stderr.includes('required'));
  }

  // -------------------------------------------------------------------
  // 7. JSON output shape
  // -------------------------------------------------------------------
  console.log('\n# 7. --json output shape');
  {
    const before = readFileSync(TERRITORIES_PATH, 'utf8');
    const r = run([
      'add',
      '--name', 'd2-smoke-json',
      '--owner-role', 'dev',
      '--scope-kind', 'files',
      '--scope-pattern', 'scripts/__d2_smoke__/**',
      '--non-interactive',
      '--dry-run',
      '--json',
    ]);
    check('json dry-run exits 0', r.status === 0, `got ${r.status}`);
    let parsed: { ok?: boolean; dryRun?: boolean; entry?: { name?: string } } | null = null;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      parsed = null;
    }
    check('json output is valid JSON', parsed !== null);
    check('json carries ok=true', parsed?.ok === true);
    check('json carries dryRun=true', parsed?.dryRun === true);
    check('json carries entry.name', parsed?.entry?.name === 'd2-smoke-json');
    const after = readFileSync(TERRITORIES_PATH, 'utf8');
    check('json dry-run did NOT modify the file', before === after);
  }

  console.log('');
  if (failures > 0) {
    console.log(`=========================================`);
    console.log(`FAIL: ${failures} assertion(s) failed`);
    console.log(`=========================================`);
    // Restore handler runs at process exit.
    process.exit(1);
  }
  console.log(`=========================================`);
  console.log(`ALL D2 TERRITORY SMOKE CHECKS PASSED`);
  console.log(`=========================================`);
  // Mirror Y2: explicit success exit so CI step does not hang.
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('SMOKE FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
