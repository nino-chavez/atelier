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
// [6] Polished-form commands honor argument-handling contract (no stub banner)
// ---------------------------------------------------------------------------
//
// Per Nino's 2026-05-02 brief: stubs print "polished form lands in v1.x" and
// the v1 raw equivalent. `atelier init` flipped to polished form at D5;
// `atelier deploy` at D6; `atelier upgrade` at E2 (this PR; consumes the E1
// migration runner; resolves BRD-OPEN-QUESTIONS §29). Each polished command
// has dedicated assertions further down. This section asserts the cross-
// cutting contract: polished commands do NOT surface the v1.x deferral
// banner, and unknown flags exit 2.
console.log('\n[6] polished commands surface argument-handling contract');
{
  // upgrade --help is asserted in [11] below. The minimal polished-contract
  // assertion here: no v1.x deferral banner with --help.
  const upgradeHelp = run(['upgrade', '--help']);
  check('atelier upgrade --help exits 0', upgradeHelp.status === 0, `got ${upgradeHelp.status}`);
  check(
    'atelier upgrade --help does NOT print v1.x deferral banner',
    !upgradeHelp.stdout.includes('polished form lands in v1.x') &&
      !upgradeHelp.stdout.includes('SCOPE-DEFERRED'),
  );
}

// ---------------------------------------------------------------------------
// [7] Multi-word command dispatch (datastore init, territory add, eval find_similar)
// ---------------------------------------------------------------------------
//
// Each multi-word command is now polished (D2 territory add, D3 datastore init,
// E2 upgrade). This section asserts only the dispatch contract: the dispatcher
// routes <command> <subcommand> correctly, unknown subcommands exit 2, and
// the polished forms are not stub-deferral banners. Behavior is covered by
// per-command sections [12]–[14] above and dedicated *.smoke.ts files.
console.log('\n[7] multi-word commands dispatch correctly');
{
  const dsBad = run(['datastore', 'invalid']);
  check('datastore <invalid> exits 2', dsBad.status === 2, `got ${dsBad.status}`);
  check('datastore <invalid> names the unknown subcommand', dsBad.stderr.includes('unknown subcommand'));

  const terBad = run(['territory', 'invalid']);
  check('territory <invalid> exits 2', terBad.status === 2, `got ${terBad.status}`);
  check('territory <invalid> names the unknown subcommand', terBad.stderr.includes('unknown subcommand'));

  // territory add --dry-run --json is a quick polished-routing probe (no file write).
  const terAddDry = run([
    'territory', 'add',
    '--name', 'sec7-routing-probe',
    '--owner-role', 'dev',
    '--scope-kind', 'files',
    '--scope-pattern', '__sec7_probe__/**',
    '--non-interactive',
    '--dry-run',
    '--json',
  ]);
  check('territory add --dry-run --json exits 0', terAddDry.status === 0, `got ${terAddDry.status}`);

  // datastore init --dry-run --json is a quick polished-routing probe (no DB).
  const dsInitDry = run(['datastore', 'init', '--dry-run', '--json']);
  // Local mode dry-run renders a plan that doesn't require docker to actually
  // be reachable (preflight is read-only). Exit may be 0 or 1 depending on
  // env (preflight reports docker absence), but should not be 2 (which would
  // be a flag/argument error).
  check('datastore init --dry-run --json exits 0 or 1 (not 2)', dsInitDry.status === 0 || dsInitDry.status === 1, `got ${dsInitDry.status}`);

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
// [9] atelier init (D5 polished form; argument-handling contract only)
// ---------------------------------------------------------------------------
//
// Substrate-touching scaffolding (real git clone + datastore init) lives in
// scripts/cli/__smoke__/init.smoke.ts (gated on git binary presence).
// This section asserts only the argument-handling contract: missing
// positional exits 2, invalid name exits 2, --dry-run renders a plan
// without mutating, --help cross-references local-bootstrap.md and ADR-029.
console.log('\n[9] atelier init (D5 polished form)');
{
  const help = run(['init', '--help']);
  check('init --help exits 0', help.status === 0, `got ${help.status}`);
  check('init --help mentions Required', help.stdout.includes('Required:'));
  check('init --help mentions <project-name>', help.stdout.includes('<project-name>'));
  check('init --help mentions --datastore-mode', help.stdout.includes('--datastore-mode'));
  check('init --help mentions --discipline', help.stdout.includes('--discipline'));
  check('init --help mentions --email', help.stdout.includes('--email'));
  check('init --help mentions --skip-git', help.stdout.includes('--skip-git'));
  check('init --help mentions --template-url', help.stdout.includes('--template-url'));
  check('init --help cross-references local-bootstrap.md', help.stdout.includes('local-bootstrap.md'));
  check('init --help cross-references ADR-029', help.stdout.includes('ADR-029'));

  const noPositional = run(['init']);
  check('init (no positional) exits 2', noPositional.status === 2, `got ${noPositional.status}`);
  check(
    'init (no positional) names project-name as required',
    noPositional.stderr.includes('project-name'),
  );

  const tooMany = run(['init', 'one', 'two']);
  check('init (>1 positional) exits 2', tooMany.status === 2, `got ${tooMany.status}`);

  const badName = run(['init', 'BadName_Underscore']);
  check('init <invalid-name> exits 2', badName.status === 2, `got ${badName.status}`);
  check(
    'init <invalid-name> names the pattern',
    badName.stderr.includes('project-name') && badName.stderr.includes('a-z'),
  );

  const badNameLeading = run(['init', '-bad']);
  check('init <leading-dash> exits 2', badNameLeading.status === 2, `got ${badNameLeading.status}`);

  const badEmail = run([
    'init', 'demo-project',
    '--email', 'not-an-email',
    '--datastore-mode', 'skip',
    '--dry-run',
  ]);
  check('init --email <invalid> exits 2', badEmail.status === 2, `got ${badEmail.status}`);

  const emailWithoutDatastore = run([
    'init', 'demo-project',
    '--email', 'a@b.co',
    '--datastore-mode', 'skip',
    '--dry-run',
  ]);
  check(
    'init --email + --datastore-mode skip exits 2',
    emailWithoutDatastore.status === 2,
    `got ${emailWithoutDatastore.status}`,
  );

  const badMode = run(['init', 'demo-project', '--datastore-mode', 'wizard']);
  check('init --datastore-mode <invalid> exits 2', badMode.status === 2, `got ${badMode.status}`);

  const badDiscipline = run(['init', 'demo-project', '--discipline', 'wizard']);
  check('init --discipline <invalid> exits 2', badDiscipline.status === 2, `got ${badDiscipline.status}`);

  // --dry-run does not touch git or supabase, so it runs without env.
  const dry = run([
    'init', 'demo-project',
    '--datastore-mode', 'skip',
    '--dry-run',
  ]);
  check('init --dry-run exits 0', dry.status === 0, `got ${dry.status}`);
  check('init --dry-run renders PLAN header', dry.stdout.includes('PLAN'));
  check('init --dry-run echoes project_name', dry.stdout.includes('demo-project'));
  check('init --dry-run lists steps', dry.stdout.includes('Steps'));
  check('init --dry-run notes no mutations', dry.stdout.includes('No mutations performed'));
  check('init --dry-run does NOT print DONE', !dry.stdout.includes('DONE'));

  const dryJson = run([
    'init', 'demo-project',
    '--datastore-mode', 'skip',
    '--dry-run',
    '--json',
  ]);
  check('init --dry-run --json exits 0', dryJson.status === 0, `got ${dryJson.status}`);
  let parsed: { ok?: boolean; dryRun?: boolean; plan?: { projectName?: string; projectUuid?: string } } | null = null;
  try {
    parsed = JSON.parse(dryJson.stdout);
  } catch {
    parsed = null;
  }
  check('init --dry-run --json emits valid JSON', parsed !== null);
  check('init --dry-run --json sets ok=true', parsed?.ok === true);
  check('init --dry-run --json sets dryRun=true', parsed?.dryRun === true);
  check('init --dry-run --json carries plan.projectName', parsed?.plan?.projectName === 'demo-project');
  check(
    'init --dry-run --json carries plan.projectUuid',
    typeof parsed?.plan?.projectUuid === 'string' && /^[0-9a-f-]{36}$/.test(parsed!.plan!.projectUuid!),
  );
}

// ---------------------------------------------------------------------------
// [10] atelier deploy (D6 polished form; argument-handling contract only)
// ---------------------------------------------------------------------------
//
// Real deploy invokes the `vercel` CLI against a real Vercel project; not
// testable in CI without a staging Vercel project + bound credentials.
// The dry-run path + preflight rejection paths live in
// scripts/cli/__smoke__/deploy.smoke.ts. This section asserts the
// argument-handling contract: --help dispatches, unknown flag exits 2,
// flags are documented, no positional args.
console.log('\n[10] atelier deploy (D6 polished form)');
{
  const help = run(['deploy', '--help']);
  check('deploy --help exits 0', help.status === 0, `got ${help.status}`);
  check('deploy --help mentions Usage:', help.stdout.includes('Usage:'));
  check('deploy --help mentions --preview', help.stdout.includes('--preview'));
  check('deploy --help mentions --skip-checks', help.stdout.includes('--skip-checks'));
  check('deploy --help mentions --skip-build', help.stdout.includes('--skip-build'));
  check('deploy --help mentions --dry-run', help.stdout.includes('--dry-run'));
  check('deploy --help mentions --json', help.stdout.includes('--json'));
  check('deploy --help cross-references ADR-046', help.stdout.includes('ADR-046'));
  check('deploy --help cross-references first-deploy.md', help.stdout.includes('first-deploy.md'));
  check('deploy --help cross-references enable-auto-deploy.md', help.stdout.includes('enable-auto-deploy.md'));
  check(
    'deploy --help lists required env vars',
    help.stdout.includes('POSTGRES_URL') &&
      help.stdout.includes('NEXT_PUBLIC_SUPABASE_URL') &&
      help.stdout.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );

  const unknownFlag = run(['deploy', '--bogus']);
  check('deploy --bogus exits 2', unknownFlag.status === 2, `got ${unknownFlag.status}`);
  check(
    'deploy --bogus names the unknown flag',
    unknownFlag.stderr.includes('--bogus'),
  );

  // Polished deploy is no longer the v1.x stub: should NOT print the
  // "polished form lands in v1.x" deferral banner with no flags.
  // Without --dry-run, deploy enters preflight which will fail in this
  // smoke env (no vercel CLI / not logged in / not linked); we only
  // assert that it does not surface the stub deferral banner.
  const noFlags = run(['deploy']);
  check(
    'deploy (no flags) does NOT print v1.x deferral banner',
    !noFlags.stdout.includes('polished form lands in v1.x'),
  );
}

// ---------------------------------------------------------------------------
// [11] atelier upgrade (E2 polished form; argument-handling contract only)
// ---------------------------------------------------------------------------
//
// Substrate-touching behavior (real Postgres connect + apply migrations) lives
// in scripts/cli/__smoke__/upgrade.smoke.ts (gated on local Supabase running).
// This section asserts the argument-handling contract: --help dispatches,
// unknown flag exits 2, conflicting actions exit 2, --remote without
// POSTGRES_URL exits 2.
console.log('\n[11] atelier upgrade (E2 polished form)');
{
  const help = run(['upgrade', '--help']);
  check('upgrade --help exits 0', help.status === 0, `got ${help.status}`);
  check('upgrade --help mentions Usage:', help.stdout.includes('Usage:'));
  check('upgrade --help mentions --check', help.stdout.includes('--check'));
  check('upgrade --help mentions --apply', help.stdout.includes('--apply'));
  check('upgrade --help mentions --force-apply-modified', help.stdout.includes('--force-apply-modified'));
  check('upgrade --help mentions --dry-run', help.stdout.includes('--dry-run'));
  check('upgrade --help mentions --json', help.stdout.includes('--json'));
  check('upgrade --help mentions --remote', help.stdout.includes('--remote'));
  check('upgrade --help mentions LOCAL / CLOUD modes', help.stdout.includes('LOCAL') && help.stdout.includes('CLOUD'));
  check('upgrade --help cross-references ADR-005', help.stdout.includes('ADR-005'));
  check('upgrade --help cross-references BRD-OPEN-QUESTIONS', help.stdout.includes('BRD-OPEN-QUESTIONS'));
  check('upgrade --help cross-references migration-system.md', help.stdout.includes('migration-system.md'));
  check('upgrade --help cross-references upgrade-schema.md', help.stdout.includes('upgrade-schema.md'));

  const unknownFlag = run(['upgrade', '--bogus']);
  check('upgrade --bogus exits 2', unknownFlag.status === 2, `got ${unknownFlag.status}`);
  check('upgrade --bogus names the unknown flag', unknownFlag.stderr.includes('--bogus'));

  const conflicting = run(['upgrade', '--check', '--apply']);
  check('upgrade --check --apply exits 2', conflicting.status === 2, `got ${conflicting.status}`);
  check(
    'upgrade --check --apply names the conflict',
    conflicting.stderr.includes('mutually exclusive'),
  );

  // --remote without POSTGRES_URL must exit 2 (precondition error).
  // We override the env for this single invocation by spawning with explicit env.
  const remoteNoEnv = spawnSync(
    'npx',
    ['tsx', CLI, 'upgrade', '--remote', '--check'],
    {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      // Strip POSTGRES_URL so the precondition fires regardless of the
      // surrounding shell. Keep PATH + HOME so npx + tsx still resolve.
      env: { ...process.env, POSTGRES_URL: '' },
    },
  );
  check('upgrade --remote (no env) exits 2', remoteNoEnv.status === 2, `got ${remoteNoEnv.status}`);
  check(
    'upgrade --remote (no env) names the missing env var',
    remoteNoEnv.stderr.includes('POSTGRES_URL'),
  );

  // Polished upgrade is no longer the v1.x stub: should NOT print the
  // "polished form lands in v1.x" deferral banner. With no args, upgrade
  // defaults to --check which will attempt a connection and either
  // succeed (local stack up) or fail at the connect step (exit 2). We
  // only assert that the stub deferral banner is absent in either case.
  const noFlags = run(['upgrade']);
  check(
    'upgrade (no flags) does NOT print v1.x deferral banner',
    !noFlags.stdout.includes('polished form lands in v1.x') &&
      !noFlags.stdout.includes('SCOPE-DEFERRED'),
  );
}

// ---------------------------------------------------------------------------
// [12] atelier invite (D4 polished form; A1 magic-link redaction default)
// ---------------------------------------------------------------------------
//
// Substrate-touching behavior (real Supabase Auth + composer insert) lives
// in scripts/cli/__smoke__/invite.smoke.ts (gated on local Supabase running).
// This section asserts the argument-handling contract + the A1 redaction
// default per BRD-OPEN-QUESTIONS §31:
//   - --help dispatches and documents required + optional flags
//   - missing required flag exits 2
//   - unknown flag exits 2
//   - --dry-run renders a plan without touching Supabase (no service role
//     env required) and renders the print_link surface line
//   - --dry-run --json emits the redaction posture in the plan payload
console.log('\n[12] atelier invite (D4 polished form + A1 redaction default)');
{
  const help = run(['invite', '--help']);
  check('invite --help exits 0', help.status === 0, `got ${help.status}`);
  check('invite --help mentions Usage:', help.stdout.includes('Usage:'));
  check('invite --help mentions --email', help.stdout.includes('--email'));
  check('invite --help mentions --discipline', help.stdout.includes('--discipline'));
  check('invite --help mentions --access-level', help.stdout.includes('--access-level'));
  check('invite --help mentions --project-id', help.stdout.includes('--project-id'));
  check('invite --help mentions --no-send-email', help.stdout.includes('--no-send-email'));
  check('invite --help mentions --reinvite', help.stdout.includes('--reinvite'));
  check('invite --help mentions --print-link', help.stdout.includes('--print-link'));
  check('invite --help mentions --dry-run', help.stdout.includes('--dry-run'));
  check('invite --help mentions --json', help.stdout.includes('--json'));
  check('invite --help cross-references ADR-009', help.stdout.includes('ADR-009'));
  check('invite --help cross-references ADR-028', help.stdout.includes('ADR-028'));
  check('invite --help cross-references ADR-038', help.stdout.includes('ADR-038'));
  check(
    'invite --help documents the redaction default (A1 / BRD §31)',
    help.stdout.includes('magic-link suppressed'),
  );

  const noFlags = run(['invite']);
  check('invite (no flags) exits 2', noFlags.status === 2, `got ${noFlags.status}`);
  check(
    'invite (no flags) names email + discipline as required',
    noFlags.stderr.includes('email') && noFlags.stderr.includes('discipline'),
  );

  const badEmail = run(['invite', '--email', 'not-an-email', '--discipline', 'dev']);
  check('invite --email <invalid> exits 2', badEmail.status === 2, `got ${badEmail.status}`);

  const badDiscipline = run(['invite', '--email', 'a@b.co', '--discipline', 'wizard']);
  check('invite --discipline <invalid> exits 2', badDiscipline.status === 2, `got ${badDiscipline.status}`);

  const unknownFlag = run(['invite', '--email', 'a@b.co', '--discipline', 'dev', '--bogus']);
  check('invite --bogus exits 2', unknownFlag.status === 2, `got ${unknownFlag.status}`);
  check('invite --bogus names the unknown flag', unknownFlag.stderr.includes('--bogus'));

  // --dry-run does not touch Supabase, so it runs without env. The plan
  // surfaces print_link so the redaction posture is visible up-front.
  const dry = run([
    'invite',
    '--email', 'alice@example.com',
    '--discipline', 'dev',
    '--no-send-email',
    '--dry-run',
  ]);
  check('invite --dry-run exits 0', dry.status === 0, `got ${dry.status}`);
  check('invite --dry-run renders PLAN header', dry.stdout.includes('PLAN'));
  check('invite --dry-run echoes email', dry.stdout.includes('alice@example.com'));
  check('invite --dry-run surfaces print_link line', dry.stdout.includes('print_link'));
  check('invite --dry-run notes no mutations', dry.stdout.includes('No mutations performed'));
  check('invite --dry-run does NOT print DONE', !dry.stdout.includes('atelier invite -- DONE'));

  // --dry-run --json carries the plan including the print_link posture.
  const dryJson = run([
    'invite',
    '--email', 'alice@example.com',
    '--discipline', 'dev',
    '--no-send-email',
    '--dry-run',
    '--json',
  ]);
  check('invite --dry-run --json exits 0', dryJson.status === 0, `got ${dryJson.status}`);
  let parsed: { ok?: boolean; dryRun?: boolean; plan?: { email?: string; printLink?: boolean } } | null = null;
  try {
    parsed = JSON.parse(dryJson.stdout);
  } catch {
    parsed = null;
  }
  check('invite --dry-run --json emits valid JSON', parsed !== null);
  check('invite --dry-run --json sets ok=true', parsed?.ok === true);
  check('invite --dry-run --json sets dryRun=true', parsed?.dryRun === true);
  check('invite --dry-run --json carries plan.email', parsed?.plan?.email === 'alice@example.com');
  check('invite --dry-run --json carries plan.printLink=false default', parsed?.plan?.printLink === false);

  // --print-link flips the dry-run plan posture (still no mutations).
  const dryPrint = run([
    'invite',
    '--email', 'alice@example.com',
    '--discipline', 'dev',
    '--no-send-email',
    '--print-link',
    '--dry-run',
    '--json',
  ]);
  check('invite --dry-run --print-link --json exits 0', dryPrint.status === 0, `got ${dryPrint.status}`);
  let parsedPrint: { plan?: { printLink?: boolean } } | null = null;
  try {
    parsedPrint = JSON.parse(dryPrint.stdout);
  } catch {
    parsedPrint = null;
  }
  check('invite --print-link sets plan.printLink=true', parsedPrint?.plan?.printLink === true);

  // Polished invite is no longer the v1.x stub.
  check(
    'invite --help does NOT print v1.x deferral banner',
    !help.stdout.includes('polished form lands in v1.x') &&
      !help.stdout.includes('SCOPE-DEFERRED'),
  );
}

// ---------------------------------------------------------------------------
// [13] atelier territory (D2 polished form; argument-handling contract)
// ---------------------------------------------------------------------------
//
// File-mutating behavior (real .atelier/territories.yaml writes) lives in
// scripts/cli/__smoke__/territory.smoke.ts. This section asserts the
// argument-handling contract: --help dispatches and documents every flag,
// missing required flags in non-interactive mode exit 2, validation
// errors exit 1, --dry-run --json renders a structured plan without
// writing.
console.log('\n[13] atelier territory (D2 polished form)');
{
  const help = run(['territory', '--help']);
  check('territory --help exits 0', help.status === 0, `got ${help.status}`);
  check('territory --help mentions Usage:', help.stdout.includes('Usage:'));
  check('territory --help mentions add', help.stdout.includes('add'));
  check('territory --help mentions --name', help.stdout.includes('--name'));
  check('territory --help mentions --owner-role', help.stdout.includes('--owner-role'));
  check('territory --help mentions --review-role', help.stdout.includes('--review-role'));
  check('territory --help mentions --scope-kind', help.stdout.includes('--scope-kind'));
  check('territory --help mentions --scope-pattern', help.stdout.includes('--scope-pattern'));
  check('territory --help mentions --requires-plan-review', help.stdout.includes('--requires-plan-review'));
  check('territory --help mentions --non-interactive', help.stdout.includes('--non-interactive'));
  check('territory --help mentions --dry-run', help.stdout.includes('--dry-run'));
  check('territory --help mentions --json', help.stdout.includes('--json'));
  check('territory --help cross-references ADR-014', help.stdout.includes('ADR-014') || help.stdout.includes('territories.yaml'));
  check('territory --help cross-references ADR-039', help.stdout.includes('ADR-039'));

  const addHelp = run(['territory', 'add', '--help']);
  check('territory add --help exits 0', addHelp.status === 0, `got ${addHelp.status}`);

  const unknownSub = run(['territory', 'remove']);
  check('territory <unknown-sub> exits 2', unknownSub.status === 2, `got ${unknownSub.status}`);
  check('territory <unknown-sub> names the subcommand', unknownSub.stderr.includes('unknown subcommand'));

  const missingFlags = run(['territory', 'add', '--non-interactive']);
  check('territory add --non-interactive (no flags) exits 2', missingFlags.status === 2, `got ${missingFlags.status}`);
  check('territory add (no flags) names required flags', missingFlags.stderr.includes('required'));

  const unknownFlag = run([
    'territory', 'add',
    '--name', 'd2-cli-smoke-bogus',
    '--owner-role', 'dev',
    '--scope-kind', 'files',
    '--scope-pattern', '__d2_cli_smoke__/**',
    '--non-interactive',
    '--bogus',
  ]);
  check('territory add --bogus exits 2', unknownFlag.status === 2, `got ${unknownFlag.status}`);

  // --dry-run --json renders the plan structure without writing.
  const dryJson = run([
    'territory', 'add',
    '--name', 'd2-cli-smoke-dryrun',
    '--owner-role', 'dev',
    '--scope-kind', 'files',
    '--scope-pattern', '__d2_cli_smoke__/**',
    '--non-interactive',
    '--dry-run',
    '--json',
  ]);
  check('territory add --dry-run --json exits 0', dryJson.status === 0, `got ${dryJson.status}`);
  let parsed: { ok?: boolean; dryRun?: boolean; entry?: { name?: string; owner_role?: string } } | null = null;
  try {
    parsed = JSON.parse(dryJson.stdout);
  } catch {
    parsed = null;
  }
  check('territory --dry-run --json is valid JSON', parsed !== null);
  check('territory --dry-run --json sets ok=true', parsed?.ok === true);
  check('territory --dry-run --json sets dryRun=true', parsed?.dryRun === true);
  check('territory --dry-run --json carries entry.name', parsed?.entry?.name === 'd2-cli-smoke-dryrun');
  check('territory --dry-run --json carries entry.owner_role', parsed?.entry?.owner_role === 'dev');

  // Polished territory is no longer the v1.x stub.
  check(
    'territory --help does NOT print v1.x deferral banner',
    !help.stdout.includes('polished form lands in v1.x') &&
      !help.stdout.includes('SCOPE-DEFERRED'),
  );
}

// ---------------------------------------------------------------------------
// [14] atelier datastore (D3 polished form; argument-handling contract)
// ---------------------------------------------------------------------------
//
// Substrate-touching behavior (real local Supabase orchestration + schema
// verification) lives in scripts/cli/__smoke__/datastore.smoke.ts. This
// section asserts the argument-handling contract: --help dispatches and
// documents every flag, --reset gating works, --remote without env
// surfaces the precondition error, --remote + --local mutex exits 2.
console.log('\n[14] atelier datastore (D3 polished form)');
{
  const help = run(['datastore', '--help']);
  check('datastore --help exits 0', help.status === 0, `got ${help.status}`);
  check('datastore --help mentions Usage:', help.stdout.includes('Usage:'));
  check('datastore --help mentions init', help.stdout.includes('init'));
  check('datastore --help mentions --remote / --local', help.stdout.includes('--remote') && help.stdout.includes('--local'));
  check('datastore --help mentions --reset', help.stdout.includes('--reset'));
  check('datastore --help mentions --seed', help.stdout.includes('--seed'));
  check('datastore --help mentions --dry-run', help.stdout.includes('--dry-run'));
  check('datastore --help mentions --json', help.stdout.includes('--json'));
  check('datastore --help mentions ARCH 5.1', help.stdout.includes('ARCH 5.1'));
  check('datastore --help references local-bootstrap.md', help.stdout.includes('local-bootstrap.md'));
  check('datastore --help references first-deploy.md', help.stdout.includes('first-deploy.md'));

  const initHelp = run(['datastore', 'init', '--help']);
  check('datastore init --help exits 0', initHelp.status === 0, `got ${initHelp.status}`);

  const unknownSub = run(['datastore', 'nonexistent']);
  check('datastore <unknown-sub> exits 2', unknownSub.status === 2, `got ${unknownSub.status}`);

  const unknownFlag = run(['datastore', 'init', '--bogus']);
  check('datastore init --bogus exits 2', unknownFlag.status === 2, `got ${unknownFlag.status}`);
  check('datastore init --bogus names the flag', unknownFlag.stderr.includes('--bogus'));

  // --remote + --local mutex
  const mutex = run(['datastore', 'init', '--remote', '--local']);
  check('datastore init --remote --local exits 2', mutex.status === 2, `got ${mutex.status}`);
  check('datastore init --remote --local names mutex', mutex.stderr.includes('mutually exclusive'));

  // --remote without env, run with explicit empty env override.
  const remoteNoEnv = spawnSync(
    'npx',
    ['tsx', CLI, 'datastore', 'init', '--remote', '--dry-run'],
    {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env, POSTGRES_URL: '' },
    },
  );
  check('datastore init --remote (no env) exits 2', remoteNoEnv.status === 2, `got ${remoteNoEnv.status}`);
  check(
    'datastore init --remote (no env) names the missing env',
    remoteNoEnv.stderr.includes('POSTGRES_URL'),
  );

  // --reset --non-interactive without --yes exits 2 (gating).
  const resetGate = run(['datastore', 'init', '--reset', '--non-interactive']);
  check('datastore init --reset --non-interactive (no --yes) exits 2', resetGate.status === 2, `got ${resetGate.status}`);
  check('datastore init --reset (no --yes) names the requirement', resetGate.stderr.includes('--yes'));

  // --seed --non-interactive without creds exits 2 (gating).
  const seedGate = run(['datastore', 'init', '--seed', '--non-interactive']);
  check('datastore init --seed --non-interactive (no creds) exits 2', seedGate.status === 2, `got ${seedGate.status}`);
  check('datastore init --seed (no creds) names --email + --password', seedGate.stderr.includes('--email') && seedGate.stderr.includes('--password'));

  // Polished datastore is no longer the v1.x stub.
  check(
    'datastore --help does NOT print v1.x deferral banner',
    !help.stdout.includes('polished form lands in v1.x') &&
      !help.stdout.includes('SCOPE-DEFERRED'),
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
console.log(`ALL CLI SMOKE CHECKS PASSED`);
console.log(`=========================================`);
