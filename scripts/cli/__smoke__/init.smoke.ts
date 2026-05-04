#!/usr/bin/env -S npx tsx
//
// Focused smoke for `atelier init` (D5 polished form).
//
// Covers the substrate-touching path that cli.smoke.ts §9 deliberately
// avoids: real git clone + scaffold + customize + strip discovery docs.
// Uses the local repo as the template (file://) so the smoke doesn't
// require network access. --datastore-mode skip + no --email so the
// scaffold completes without bringing up Supabase or running invite.
//
// Validates the scaffold output:
//   - Output directory exists with the expected file tree
//   - .git was reset (fresh git history, not atelier's full history)
//   - .atelier/config.yaml has the new project name + a fresh UUID
//   - README.md starts with the new project name
//   - Discovery docs (docs/strategic, docs/functional,
//     docs/architecture/decisions) stripped to skeletons
//   - traceability.json reset to a minimal new-project shape
//
// Cleanup: removes /tmp/atelier-init-smoke-* directories at end.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CLI = resolve(REPO_ROOT, 'scripts/cli/atelier.ts');

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

function run(args: readonly string[], cwd: string = REPO_ROOT): { status: number | null; stdout: string; stderr: string } {
  const out = spawnSync('npx', ['tsx', CLI, ...args], {
    encoding: 'utf8',
    cwd,
  });
  return { status: out.status, stdout: out.stdout, stderr: out.stderr };
}

// ---------------------------------------------------------------------------
// Pre-flight: git binary required (skip if absent).
// ---------------------------------------------------------------------------
const gitVersion = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (gitVersion.status !== 0) {
  console.log('SKIP: git not installed; init smoke requires git binary');
  process.exit(0);
}

// Track temp dirs for afterAll cleanup.
const tempDirs: string[] = [];
const cleanup = (): void => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; ignore.
    }
  }
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

// ---------------------------------------------------------------------------
// [1] --dry-run produces the expected step list
// ---------------------------------------------------------------------------
console.log('\n[1] --dry-run produces expected step list');
{
  const dry = run([
    'init', 'dry-test',
    '--datastore-mode', 'local',
    '--email', 'alice@example.com',
    '--dry-run',
  ]);
  check('dry-run exits 0', dry.status === 0, `got ${dry.status}`);
  check('PLAN header present', dry.stdout.includes('PLAN (dry-run)'));
  check('lists step 1 (pre-flight git)', dry.stdout.includes('1. would pre-flight: git binary'));
  check('lists step 3 (git clone)', dry.stdout.includes('git clone --depth=1'));
  check('lists step 6 (strip discovery docs)', dry.stdout.includes('strip discovery docs'));
  check('lists step 7 (customize config.yaml)', dry.stdout.includes('customize .atelier/config.yaml'));
  check('lists step 10 (datastore init delegation)', dry.stdout.includes('exec `atelier datastore init`'));
  check(
    'lists step 11 (invite delegation)',
    dry.stdout.includes('exec `atelier invite --email alice@example.com'),
  );
  check('lists step 12 (next-step summary)', dry.stdout.includes('print final next-step summary'));
  check('reports no mutations', dry.stdout.includes('No mutations performed'));
}

// ---------------------------------------------------------------------------
// [2] Real run against a temp dir scaffolds a working project
// ---------------------------------------------------------------------------
console.log('\n[2] real run scaffolds a working project (datastore=skip)');
{
  const tmp = mkdtempSync(join(tmpdir(), 'atelier-init-smoke-'));
  tempDirs.push(tmp);
  const projectName = 'smoke-project';
  const outputDir = join(tmp, projectName);

  // Use the local repo as the template so the smoke is offline-friendly.
  // Clone reflects HEAD, not working tree — that's fine; we're testing
  // init's scaffolding behavior, not the cloned init.ts itself.
  const result = run([
    'init', projectName,
    '--output-dir', outputDir,
    '--datastore-mode', 'skip',
    '--template-url', `file://${REPO_ROOT}`,
  ]);

  if (result.status !== 0) {
    console.log('  STDOUT:');
    console.log(result.stdout.split('\n').map((l) => `    ${l}`).join('\n'));
    console.log('  STDERR:');
    console.log(result.stderr.split('\n').map((l) => `    ${l}`).join('\n'));
  }
  check('init real-run exits 0', result.status === 0, `got ${result.status}`);
  check('output dir exists', existsSync(outputDir));
  check('output dir is non-empty', existsSync(outputDir) && readdirSync(outputDir).length > 0);
  check('output dir has .git (fresh init)', existsSync(join(outputDir, '.git')));
  check('output dir has .atelier/config.yaml', existsSync(join(outputDir, '.atelier', 'config.yaml')));
  check('output dir has README.md', existsSync(join(outputDir, 'README.md')));
  check('output dir has traceability.json', existsSync(join(outputDir, 'traceability.json')));

  // Validate config.yaml customization
  if (existsSync(join(outputDir, '.atelier', 'config.yaml'))) {
    const cfg = readFileSync(join(outputDir, '.atelier', 'config.yaml'), 'utf8');
    check('config.yaml has new project name', cfg.includes(`name: ${projectName}`));
    check('config.yaml has fresh UUID id', /id:\s+[0-9a-f-]{36}/.test(cfg));
    check('config.yaml does NOT have atelier-self id', !cfg.includes('id: atelier-self'));
    check('config.yaml preserves datastore block', cfg.includes('datastore:'));
    check('config.yaml preserves identity block', cfg.includes('identity:'));
    check('config.yaml preserves find_similar block', cfg.includes('find_similar:'));
  }

  // Validate README customization
  if (existsSync(join(outputDir, 'README.md'))) {
    const readme = readFileSync(join(outputDir, 'README.md'), 'utf8');
    check('README starts with new project name', readme.startsWith(`# ${projectName}`));
    check('README references atelier upstream', readme.includes('Signal-x-Studio-LLC/atelier'));
  }

  // Validate fresh git history (one initial commit, not atelier's history)
  if (existsSync(join(outputDir, '.git'))) {
    const log = spawnSync('git', ['log', '--oneline'], { cwd: outputDir, encoding: 'utf8' });
    check('git log succeeds', log.status === 0);
    const commits = (log.stdout ?? '').trim().split('\n').filter((l) => l.length > 0);
    check(
      'fresh git history has exactly 1 commit',
      commits.length === 1,
      `got ${commits.length} commits`,
    );
    check(
      'initial commit message names project',
      commits[0]?.includes(`atelier init: ${projectName}`) ?? false,
    );
  }

  // Validate discovery docs stripped to skeletons
  const northStar = join(outputDir, 'docs', 'strategic', 'NORTH-STAR.md');
  if (existsSync(northStar)) {
    const body = readFileSync(northStar, 'utf8');
    check('NORTH-STAR.md replaced with skeleton', body.includes('TODO'));
    check('NORTH-STAR.md mentions new project', body.includes(projectName));
    check(
      'NORTH-STAR.md does NOT contain atelier verbatim content',
      !body.includes('Atelier owns the lock'),
    );
  }
  const prd = join(outputDir, 'docs', 'functional', 'PRD.md');
  if (existsSync(prd)) {
    const body = readFileSync(prd, 'utf8');
    check('PRD.md replaced with skeleton', body.includes('TODO'));
  }

  // Validate ADR sweep
  const adrDir = join(outputDir, 'docs', 'architecture', 'decisions');
  if (existsSync(adrDir)) {
    const adrs = readdirSync(adrDir).filter((f) => /^ADR-\d+/.test(f));
    check('ADR-NNN files removed', adrs.length === 0, `found ${adrs.length}`);
    const adrReadme = join(adrDir, 'README.md');
    if (existsSync(adrReadme)) {
      const body = readFileSync(adrReadme, 'utf8');
      check('ADR README replaced with skeleton', body.includes('TODO'));
      check(
        'ADR README does NOT contain atelier verbatim ADR-001',
        !body.includes('Prototype is the canonical artifact AND coordination dashboard'),
      );
    }
  }

  // Validate traceability.json reset
  const trace = join(outputDir, 'traceability.json');
  if (existsSync(trace)) {
    let parsed: { project_name?: string; entries?: unknown[]; counts?: { adrs?: number } } | null = null;
    try {
      parsed = JSON.parse(readFileSync(trace, 'utf8'));
    } catch {
      parsed = null;
    }
    check('traceability.json is valid JSON', parsed !== null);
    check(
      'traceability.json project_name matches',
      parsed?.project_name === projectName,
    );
    check(
      'traceability.json entries reset to empty',
      Array.isArray(parsed?.entries) && parsed!.entries!.length === 0,
    );
    check(
      'traceability.json counts.adrs reset to 0',
      parsed?.counts?.adrs === 0,
    );
  }
}

// ---------------------------------------------------------------------------
// [3] --skip-git scaffolds without git init
// ---------------------------------------------------------------------------
console.log('\n[3] --skip-git scaffolds without git init');
{
  const tmp = mkdtempSync(join(tmpdir(), 'atelier-init-smoke-'));
  tempDirs.push(tmp);
  const projectName = 'skip-git-project';
  const outputDir = join(tmp, projectName);

  const result = run([
    'init', projectName,
    '--output-dir', outputDir,
    '--datastore-mode', 'skip',
    '--skip-git',
    '--template-url', `file://${REPO_ROOT}`,
  ]);

  check('--skip-git real-run exits 0', result.status === 0, `got ${result.status}`);
  check('output dir exists', existsSync(outputDir));
  check(
    '--skip-git: no .git directory created',
    !existsSync(join(outputDir, '.git')),
  );
  // config.yaml customization should still happen
  if (existsSync(join(outputDir, '.atelier', 'config.yaml'))) {
    const cfg = readFileSync(join(outputDir, '.atelier', 'config.yaml'), 'utf8');
    check('--skip-git: config.yaml still customized', cfg.includes(`name: ${projectName}`));
  }
}

// ---------------------------------------------------------------------------
// [4] Re-running into existing dir without --force exits 2
// ---------------------------------------------------------------------------
console.log('\n[4] re-running into existing dir without --force exits 2');
{
  const tmp = mkdtempSync(join(tmpdir(), 'atelier-init-smoke-'));
  tempDirs.push(tmp);
  const projectName = 'reused-dir-project';
  const outputDir = join(tmp, projectName);

  // First scaffold
  const first = run([
    'init', projectName,
    '--output-dir', outputDir,
    '--datastore-mode', 'skip',
    '--skip-git',
    '--template-url', `file://${REPO_ROOT}`,
  ]);
  check('first init exits 0', first.status === 0, `got ${first.status}`);

  // Re-run same target without --force
  const second = run([
    'init', projectName,
    '--output-dir', outputDir,
    '--datastore-mode', 'skip',
    '--skip-git',
    '--template-url', `file://${REPO_ROOT}`,
  ]);
  check('re-run without --force exits 2', second.status === 2, `got ${second.status}`);
  check(
    're-run error mentions output directory exists',
    second.stderr.includes('output directory exists'),
  );
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
console.log(`ALL INIT SMOKE CHECKS PASSED`);
console.log(`=========================================`);
