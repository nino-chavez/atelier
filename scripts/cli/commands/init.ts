// `atelier init` (US-11.1; BUILD-SEQUENCE §9; D5 polished form).
//
// Scaffolds a brand-new Atelier project from the reference repo as a
// template. Replaces the manual local-bootstrap dance:
//   git clone <atelier> <name> && cd <name> && rm -rf .git && git init
//   <customize .atelier/config.yaml>
//   atelier datastore init && atelier invite ...
//
// with a single command:
//   atelier init <project-name> [--email you@example.com]
//
// Behavior (in order, all skippable / configurable):
//   1. Validate inputs (name pattern, output directory non-existence)
//   2. Pre-flight: git binary present (clone-required); supabase CLI +
//      docker if --datastore-mode local
//   3. git clone --depth=1 the atelier reference repo into <output-dir>
//   4. rm -rf <output-dir>/.git; (unless --skip-git) git init + initial commit
//   5. Strip atelier-specific discovery content from docs/strategic/,
//      docs/functional/, docs/architecture/decisions/ down to template
//      skeletons (per brief decision (a): keep structure, replace content
//      with TODO placeholders + pointer to atelier upstream as reference)
//   6. Customize .atelier/config.yaml project block (id/name/created_at/
//      description; preserve all other fields)
//   7. Customize README.md (top-level title + intro; preserve doc map)
//   8. Reset traceability.json to a minimal new-project shape
//   9. Datastore mode dispatch:
//        local   → exec `atelier datastore init` inside <output-dir>
//        cloud   → print operator instructions (no auto-provisioning)
//        skip    → print deferral note
//  10. If --email + datastore configured: exec `atelier invite ...`
//  11. Print final next-step summary
//
// Per the brief: cloud-mode provisioning (creating new Supabase Cloud
// project, Vercel project) is intentionally NOT in D5. That's adopter-side
// choice (tier, region, billing, naming). D5 hands off to operator
// instructions for cloud; D6 (atelier deploy) handles the Vercel push.
//
// Per ADR-029: stay GCP-portable. Use `git` shell commands (portable),
// not @vercel/* or Supabase-cloud-specific provisioning APIs.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const ATELIER_TEMPLATE_URL_DEFAULT = 'https://github.com/Signal-x-Studio-LLC/atelier';
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const DISCIPLINES = ['analyst', 'dev', 'pm', 'designer', 'architect'] as const;
type Discipline = (typeof DISCIPLINES)[number];
const DATASTORE_MODES = ['local', 'cloud', 'skip'] as const;
type DatastoreMode = (typeof DATASTORE_MODES)[number];

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const SELF_CLI = resolve(REPO_ROOT, 'scripts', 'cli', 'atelier.ts');

export const initUsage = `atelier init — scaffold a new Atelier project

Usage:
  atelier init <project-name> [options]

Required:
  <project-name>             Project directory + display name. Must match
                             /^[a-z0-9][a-z0-9-]{1,63}$/ (kebab-case;
                             leading alphanumeric; max 64 chars).

Optional:
  --output-dir <path>        Default: ./<project-name>. Errors if directory
                             already exists unless --force.
  --force                    Allow scaffolding into an existing directory.
                             USE WITH CARE: clones into the directory and
                             may overwrite files of the same name.
  --datastore-mode <mode>    One of: local | cloud | skip. Default: local.
                             local runs \`atelier datastore init\` (local
                             Supabase via supabase start). cloud prints
                             operator instructions. skip leaves it
                             unconfigured.
  --discipline <role>        Operator's discipline. One of:
                             ${DISCIPLINES.join(' | ')}. Default: architect.
  --email <addr>             When supplied, runs \`atelier invite\` for the
                             operator after scaffolding (datastore must be
                             configured). Default: skip; operator runs
                             \`atelier invite\` manually.
  --skip-git                 Do not init a fresh git repo after scaffolding.
                             Useful for adopters integrating into an
                             existing repo structure.
  --template-url <url>       Override the atelier template repo URL.
                             Default: ${ATELIER_TEMPLATE_URL_DEFAULT}
  --dry-run                  Preview the full flow without writing anything.
  --json                     Emit machine-readable JSON output.
  -h, --help                 Show this help.

Behavior contract:
  Exits 0 on success; 1 on git/datastore/invite failure;
  2 on argument or precondition error (missing positional, invalid name,
  output directory exists without --force, missing git binary).

What gets scaffolded:
  - Atelier reference repo cloned via \`git clone --depth=1\` (shallow)
  - .git wiped; fresh git init + initial commit (unless --skip-git)
  - .atelier/config.yaml customized (project block: id/name/created_at)
  - README.md customized (top-level title + intro)
  - docs/strategic/, docs/functional/, docs/architecture/decisions/
    stripped to template skeletons (atelier's own discovery is the
    reference, not the new project's content)
  - traceability.json reset to a fresh new-project shape

What does NOT get scaffolded (intentionally — adopter-side choice):
  - Supabase Cloud project (which tier, region, billing — operator picks)
  - Vercel deploy (D6 \`atelier deploy\` handles this against an existing
    Vercel project; no auto-provisioning at v1)

Cross-references:
  - docs/user/tutorials/local-bootstrap.md (the runbook this command
    consolidates into one command)
  - scripts/cli/commands/datastore.ts (D3 — delegate target for local mode)
  - scripts/cli/commands/invite.ts (D4 — delegate target for --email)
  - BUILD-SEQUENCE.md §9 (12 v1 CLI commands; this is row 1)
  - ADR-029 (GCP-portability — clone + git, not vendor SDK)
`;

interface ParsedArgs {
  positional: string[];
  outputDir?: string;
  force: boolean;
  datastoreMode: DatastoreMode;
  discipline: Discipline;
  email?: string;
  skipGit: boolean;
  templateUrl: string;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    positional: [],
    force: false,
    datastoreMode: 'local',
    discipline: 'architect',
    skipGit: false,
    templateUrl: ATELIER_TEMPLATE_URL_DEFAULT,
    dryRun: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    const next = (): string => {
      const v = args[i + 1];
      if (v === undefined) throw new Error(`flag ${a} requires a value`);
      i += 1;
      return v;
    };
    switch (a) {
      case '--output-dir': out.outputDir = next(); break;
      case '--force': out.force = true; break;
      case '--datastore-mode': {
        const v = next();
        if (!DATASTORE_MODES.includes(v as DatastoreMode)) {
          throw new Error(`--datastore-mode must be one of ${DATASTORE_MODES.join(' | ')} (got "${v}")`);
        }
        out.datastoreMode = v as DatastoreMode;
        break;
      }
      case '--discipline': {
        const v = next();
        if (!DISCIPLINES.includes(v as Discipline)) {
          throw new Error(`--discipline must be one of ${DISCIPLINES.join(' | ')} (got "${v}")`);
        }
        out.discipline = v as Discipline;
        break;
      }
      case '--email': out.email = next(); break;
      case '--skip-git': out.skipGit = true; break;
      case '--template-url': out.templateUrl = next(); break;
      case '--dry-run': out.dryRun = true; break;
      case '--json': out.json = true; break;
      case '--help':
      case '-h': out.help = true; break;
      default:
        if (a.startsWith('--')) {
          throw new Error(`unknown flag: ${a}`);
        }
        out.positional.push(a);
    }
  }
  return out;
}

interface ValidationError {
  field: string;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(parsed: ParsedArgs): ValidationError[] {
  const errors: ValidationError[] = [];
  if (parsed.positional.length === 0) {
    errors.push({ field: 'project-name', message: 'is required (positional argument)' });
  } else if (parsed.positional.length > 1) {
    errors.push({
      field: 'project-name',
      message: `expected exactly one positional argument; got ${parsed.positional.length}`,
    });
  } else if (!NAME_RE.test(parsed.positional[0]!)) {
    errors.push({
      field: 'project-name',
      message: `must match /^[a-z0-9][a-z0-9-]{1,63}$/ (got "${parsed.positional[0]}")`,
    });
  }
  if (parsed.email && !EMAIL_RE.test(parsed.email)) {
    errors.push({
      field: 'email',
      message: `does not look like an email address (got "${parsed.email}")`,
    });
  }
  if (parsed.email && parsed.datastoreMode === 'skip') {
    errors.push({
      field: 'email',
      message: 'requires --datastore-mode local or cloud (cannot invite without a configured datastore)',
    });
  }
  return errors;
}

interface Plan {
  projectName: string;
  outputDir: string;
  outputDirAbs: string;
  alreadyExists: boolean;
  templateUrl: string;
  datastoreMode: DatastoreMode;
  discipline: Discipline;
  email: string | undefined;
  skipGit: boolean;
  force: boolean;
  projectUuid: string;
  createdAt: string;
}

function buildPlan(parsed: ParsedArgs): Plan {
  const projectName = parsed.positional[0]!;
  const outputDir = parsed.outputDir ?? `./${projectName}`;
  const outputDirAbs = resolve(process.cwd(), outputDir);
  return {
    projectName,
    outputDir,
    outputDirAbs,
    alreadyExists: existsSync(outputDirAbs),
    templateUrl: parsed.templateUrl,
    datastoreMode: parsed.datastoreMode,
    discipline: parsed.discipline,
    email: parsed.email,
    skipGit: parsed.skipGit,
    force: parsed.force,
    projectUuid: randomUUID(),
    createdAt: new Date().toISOString().slice(0, 10),
  };
}

function renderPlan(p: Plan, dryRun: boolean): string {
  const lines: string[] = [];
  lines.push(`atelier init -- ${dryRun ? 'PLAN (dry-run)' : 'PLAN'}`);
  lines.push('');
  lines.push(`  project_name     ${p.projectName}`);
  lines.push(`  output_dir       ${p.outputDir}  (${p.outputDirAbs})`);
  lines.push(`  template_url     ${p.templateUrl}`);
  lines.push(`  datastore_mode   ${p.datastoreMode}`);
  lines.push(`  discipline       ${p.discipline}`);
  lines.push(`  email            ${p.email ?? '<skip — operator runs invite manually>'}`);
  lines.push(`  skip_git         ${p.skipGit}`);
  lines.push(`  project_uuid     ${p.projectUuid}`);
  lines.push(`  created_at       ${p.createdAt}`);
  lines.push('');
  const verb = dryRun ? 'would' : 'will';
  lines.push(`Steps (${dryRun ? 'no mutations' : 'in order'}):`);
  lines.push(`  1. ${verb} pre-flight: git binary present`);
  if (p.datastoreMode === 'local') {
    lines.push(`  2. ${verb} pre-flight: supabase CLI + docker (datastore-mode local)`);
  }
  lines.push(`  3. ${verb} git clone --depth=1 ${p.templateUrl} ${p.outputDir}`);
  lines.push(`  4. ${verb} rm -rf ${p.outputDir}/.git`);
  if (!p.skipGit) {
    lines.push(`  5. ${verb} git init + initial commit inside ${p.outputDir}`);
  } else {
    lines.push(`  5. (skip-git) ${verb} NOT initialize git`);
  }
  lines.push(`  6. ${verb} strip discovery docs (docs/strategic, docs/functional, docs/architecture/decisions)`);
  lines.push(`  7. ${verb} customize .atelier/config.yaml (project block)`);
  lines.push(`  8. ${verb} customize README.md (title + intro)`);
  lines.push(`  9. ${verb} reset traceability.json`);
  if (p.datastoreMode === 'local') {
    lines.push(` 10. ${verb} exec \`atelier datastore init\` inside ${p.outputDir}`);
  } else if (p.datastoreMode === 'cloud') {
    lines.push(` 10. ${verb} print cloud operator instructions`);
  } else {
    lines.push(` 10. (skip) datastore left unconfigured`);
  }
  if (p.email) {
    lines.push(` 11. ${verb} exec \`atelier invite --email ${p.email} --discipline ${p.discipline} --access-level admin\``);
  }
  lines.push(` 12. ${verb} print final next-step summary`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

function checkGit(): { ok: boolean; detail?: string } {
  const out = spawnSync('git', ['--version'], { stdio: 'pipe', encoding: 'utf8' });
  if (out.status !== 0) {
    return { ok: false, detail: 'git not installed; install via your package manager (brew install git, apt install git, etc.)' };
  }
  return { ok: true, detail: out.stdout.trim() };
}

function checkSupabaseCli(): { ok: boolean; detail?: string } {
  const out = spawnSync('supabase', ['--version'], { stdio: 'pipe', encoding: 'utf8' });
  if (out.status !== 0) {
    return { ok: false, detail: 'supabase CLI not installed; install via `npm install -g supabase`' };
  }
  return { ok: true, detail: out.stdout.trim() };
}

function checkDocker(): { ok: boolean; detail?: string } {
  const out = spawnSync('docker', ['info'], { stdio: 'ignore' });
  return out.status === 0
    ? { ok: true }
    : { ok: false, detail: 'docker daemon not reachable; start Docker Desktop or compatible runtime' };
}

// ---------------------------------------------------------------------------
// Scaffolding mutations
// ---------------------------------------------------------------------------

function execGit(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function gitClone(templateUrl: string, outputDirAbs: string): void {
  const parent = dirname(outputDirAbs);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  const r = spawnSync(
    'git',
    ['clone', '--depth=1', '--quiet', templateUrl, outputDirAbs],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if (r.status !== 0) {
    throw new Error(`git clone failed (exit ${r.status}); is ${templateUrl} reachable?`);
  }
}

function resetGit(outputDirAbs: string, projectName: string, skipGit: boolean): void {
  const dotGit = join(outputDirAbs, '.git');
  if (existsSync(dotGit)) {
    rmSync(dotGit, { recursive: true, force: true });
  }
  if (skipGit) return;
  const init = execGit(['init', '--quiet', '--initial-branch=main'], outputDirAbs);
  if (init.code !== 0) {
    // Fall back without --initial-branch for older git versions.
    const initFallback = execGit(['init', '--quiet'], outputDirAbs);
    if (initFallback.code !== 0) {
      throw new Error(`git init failed (exit ${initFallback.code}): ${initFallback.stderr.trim()}`);
    }
  }
  const add = execGit(['add', '-A'], outputDirAbs);
  if (add.code !== 0) {
    throw new Error(`git add failed (exit ${add.code}): ${add.stderr.trim()}`);
  }
  // Use a commit env that does not depend on the operator's git config; if
  // git config user.name/user.email isn't set globally, spawn the commit with
  // explicit author env vars.
  const commit = spawnSync(
    'git',
    ['commit', '--quiet', '-m', `atelier init: ${projectName}`],
    {
      cwd: outputDirAbs,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? 'Atelier Init',
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? 'init@atelier.local',
        GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? 'Atelier Init',
        GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? 'init@atelier.local',
      },
    },
  );
  if (commit.status !== 0) {
    throw new Error(`git commit failed (exit ${commit.status}): ${(commit.stderr ?? '').toString().trim()}`);
  }
}

function customizeConfigYaml(plan: Plan): void {
  const path = join(plan.outputDirAbs, '.atelier', 'config.yaml');
  if (!existsSync(path)) {
    throw new Error(`.atelier/config.yaml missing in template at ${path}`);
  }
  const body = readFileSync(path, 'utf8');
  // Replace the `project:` block (top-level key through next top-level key).
  // YAML top-level keys are unindented identifiers; project block runs from
  // the `project:` line through the line BEFORE the next unindented key.
  const lines = body.split('\n');
  const startIdx = lines.findIndex((l) => /^project:\s*$/.test(l));
  if (startIdx === -1) {
    throw new Error('.atelier/config.yaml has no top-level `project:` block');
  }
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const l = lines[i]!;
    // Next top-level key: column-0 letter followed by colon. Comments and
    // blank lines are part of the current block (preserve).
    if (/^[A-Za-z_][A-Za-z0-9_-]*:/.test(l)) {
      endIdx = i;
      break;
    }
  }
  const replacement = [
    'project:',
    `  id: ${plan.projectUuid}`,
    `  name: ${plan.projectName}`,
    '  description: >',
    `    ${plan.projectName} coordination project (created via atelier init).`,
    `    Uses Atelier (${ATELIER_TEMPLATE_URL_DEFAULT}) as its substrate template.`,
    `  created_at: ${plan.createdAt}`,
    '  template_version: "1.0"',
    '',
  ];
  const newBody = [...lines.slice(0, startIdx), ...replacement, ...lines.slice(endIdx)].join('\n');
  writeFileSync(path, newBody);
}

function customizeReadme(plan: Plan): void {
  const path = join(plan.outputDirAbs, 'README.md');
  if (!existsSync(path)) {
    // README.md is not strictly required; warn but continue.
    return;
  }
  const body = readFileSync(path, 'utf8');
  const lines = body.split('\n');

  // Replace the top-level title (first `# ` line) with the new project name.
  const titleIdx = lines.findIndex((l) => /^# .+/.test(l));
  if (titleIdx !== -1) {
    lines[titleIdx] = `# ${plan.projectName}`;
  }

  // Replace the "What this repo is" body up to the "## Pick your path" header
  // with a project-specific one-liner. Atelier's README is the canonical
  // reference template; new projects don't need the three-tier intro.
  const whatIdx = lines.findIndex((l) => /^## What this repo is\s*$/.test(l));
  const pickIdx = lines.findIndex((l) => /^## Pick your path\s*$/.test(l));
  if (whatIdx !== -1 && pickIdx !== -1 && pickIdx > whatIdx) {
    const replacement = [
      '## What this repo is',
      '',
      `${plan.projectName} uses Atelier (${ATELIER_TEMPLATE_URL_DEFAULT}) for coordination.`,
      '',
      'Atelier is the spine that lets mixed teams of humans and AI agents author one canonical artifact across IDE, browser, and terminal surfaces without drift. This repo is your project; Atelier is the template + protocol it was scaffolded from.',
      '',
      'See `docs/methodology/` for the way-of-working, `docs/architecture/` for the architectural surface, and `.atelier/config.yaml` for project-specific configuration.',
      '',
    ];
    lines.splice(whatIdx, pickIdx - whatIdx, ...replacement);
  }

  writeFileSync(path, lines.join('\n'));
}

const STRATEGIC_FILES: readonly { path: string; title: string; intent: string }[] = [
  { path: 'docs/strategic/NORTH-STAR.md', title: 'North Star', intent: 'the complete v1 design scope for this project' },
  { path: 'docs/strategic/STRATEGY.md', title: 'Strategy', intent: 'why this project exists and what is explicitly out of scope' },
  { path: 'docs/strategic/BUILD-SEQUENCE.md', title: 'Build Sequence', intent: 'the milestone sequencing for delivering the v1 design scope' },
  { path: 'docs/strategic/risks.md', title: 'Risks', intent: 'load-bearing strategic bets and their fallback paths' },
];

const FUNCTIONAL_FILES: readonly { path: string; title: string; intent: string }[] = [
  { path: 'docs/functional/PRD.md', title: 'Product Requirements', intent: 'capability-level product requirements' },
  { path: 'docs/functional/BRD.md', title: 'Business Requirements', intent: 'user stories with trace IDs (US-X.Y)' },
  { path: 'docs/functional/PRD-COMPANION.md', title: 'PRD Companion', intent: 'design-time decisions with rationale' },
  { path: 'docs/functional/BRD-OPEN-QUESTIONS.md', title: 'BRD Open Questions', intent: 'known open items pending resolution' },
];

function skeletonFor(title: string, intent: string, projectName: string): string {
  return [
    `# ${title}`,
    '',
    `**Status:** TODO. Author ${intent} for ${projectName}.`,
    '',
    `**Reference:** Atelier's own ${title.toLowerCase()} is at ${ATELIER_TEMPLATE_URL_DEFAULT}/blob/main/<this-path> for shape reference. Replace this file with content specific to ${projectName}; do not include Atelier's own content verbatim.`,
    '',
    '## Sections',
    '',
    'TODO: Outline the sections this document will contain.',
    '',
  ].join('\n');
}

function adrIndexSkeleton(projectName: string): string {
  return [
    '# Architecture Decision Records (ADRs)',
    '',
    '**Audience question:** What are the canonical decisions for this project, in what order, and why?',
    '',
    `Append-only canonical decision log per Atelier methodology (decisions write to repo first; per-ADR file split). New ADRs are new files. Existing ADRs are never edited; reversals are new ADRs with \`reverses: ADR-NNN\` frontmatter.`,
    '',
    '## Index',
    '',
    '| ADR | Title | Summary |',
    '|---|---|---|',
    `| ADR-001 | TODO: First decision for ${projectName} | TODO |`,
    '',
    `**Reference:** Atelier's own ADRs are at ${ATELIER_TEMPLATE_URL_DEFAULT}/tree/main/docs/architecture/decisions for shape and convention reference (frontmatter format, naming convention, reversal pattern). Replace this index with your project's own decisions.`,
    '',
  ].join('\n');
}

function stripDiscoveryDocs(plan: Plan): { stripped: string[]; deleted: string[] } {
  const stripped: string[] = [];
  const deleted: string[] = [];

  for (const f of [...STRATEGIC_FILES, ...FUNCTIONAL_FILES]) {
    const abs = join(plan.outputDirAbs, f.path);
    if (existsSync(abs)) {
      writeFileSync(abs, skeletonFor(f.title, f.intent, plan.projectName));
      stripped.push(f.path);
    }
  }

  // Strip docs/strategic/addenda/ subdirectory (atelier-specific).
  const addendaDir = join(plan.outputDirAbs, 'docs', 'strategic', 'addenda');
  if (existsSync(addendaDir)) {
    rmSync(addendaDir, { recursive: true, force: true });
    deleted.push('docs/strategic/addenda/');
  }

  // Strip atelier-specific strategic kickoff drafts (m7-kickoff-draft.md etc.).
  const strategicDir = join(plan.outputDirAbs, 'docs', 'strategic');
  if (existsSync(strategicDir)) {
    for (const entry of readdirSync(strategicDir)) {
      const full = join(strategicDir, entry);
      const stat = statSync(full);
      if (stat.isFile() && /-kickoff-draft\.md$/.test(entry)) {
        rmSync(full, { force: true });
        deleted.push(`docs/strategic/${entry}`);
      }
    }
  }

  // Wipe ADR files; replace ADR README with skeleton.
  const adrDir = join(plan.outputDirAbs, 'docs', 'architecture', 'decisions');
  if (existsSync(adrDir)) {
    for (const entry of readdirSync(adrDir)) {
      const full = join(adrDir, entry);
      const stat = statSync(full);
      if (stat.isFile() && /^ADR-\d+.*\.md$/.test(entry)) {
        rmSync(full, { force: true });
        deleted.push(`docs/architecture/decisions/${entry}`);
      }
    }
    const readmePath = join(adrDir, 'README.md');
    writeFileSync(readmePath, adrIndexSkeleton(plan.projectName));
    stripped.push('docs/architecture/decisions/README.md');
  }

  return { stripped, deleted };
}

function resetTraceability(plan: Plan): void {
  const path = join(plan.outputDirAbs, 'traceability.json');
  const minimal = {
    $schema: './scripts/traceability/schema.json',
    generated_at: new Date().toISOString(),
    project_id: plan.projectUuid,
    project_name: plan.projectName,
    template_version: '1.0',
    counts: {
      'brd-epics': 0,
      'brd-stories': 0,
      decisions: 0,
      'open-questions': 0,
      sections: 0,
      'prototype-slices': 0,
      adrs: 0,
    },
    entries: [] as unknown[],
  };
  writeFileSync(path, JSON.stringify(minimal, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Datastore + invite delegation
// ---------------------------------------------------------------------------

function execAtelierIn(outputDirAbs: string, args: readonly string[]): Promise<number> {
  return new Promise((res) => {
    // The scaffolded project ships its own scripts/cli/atelier.ts (since we
    // cloned the template). Use that copy so the new project is self-contained.
    const childCli = resolve(outputDirAbs, 'scripts', 'cli', 'atelier.ts');
    const cli = existsSync(childCli) ? childCli : SELF_CLI;
    const proc = spawn('npx', ['tsx', cli, ...args], {
      cwd: outputDirAbs,
      stdio: 'inherit',
    });
    proc.on('exit', (code) => res(code ?? 1));
    proc.on('error', () => res(1));
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface RunResult {
  ok: boolean;
  plan?: Plan | undefined;
  errors?: ValidationError[] | undefined;
  error?: string | undefined;
  stripped?: string[] | undefined;
  deleted?: string[] | undefined;
  datastoreExitCode?: number | undefined;
  inviteExitCode?: number | undefined;
}

async function runMutation(plan: Plan, parsed: ParsedArgs): Promise<RunResult> {
  // 1+2 pre-flight
  const git = checkGit();
  if (!git.ok) {
    return { ok: false, error: git.detail };
  }
  if (plan.datastoreMode === 'local') {
    const cli = checkSupabaseCli();
    if (!cli.ok) {
      return { ok: false, error: `${cli.detail} (required by --datastore-mode local; pass --datastore-mode skip to defer)` };
    }
    const dock = checkDocker();
    if (!dock.ok) {
      return { ok: false, error: `${dock.detail} (required by --datastore-mode local; pass --datastore-mode skip to defer)` };
    }
  }

  // Output directory pre-condition
  if (plan.alreadyExists && !plan.force) {
    return {
      ok: false,
      error: `output directory exists: ${plan.outputDirAbs} (pass --force to scaffold into it anyway)`,
    };
  }

  // 3. Clone
  if (!parsed.json) console.log(`[atelier init] cloning ${plan.templateUrl} -> ${plan.outputDir}`);
  try {
    gitClone(plan.templateUrl, plan.outputDirAbs);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // 4-5. Reset .git
  if (!parsed.json) console.log(`[atelier init] resetting .git${plan.skipGit ? ' (skip-git: leaving uninitialized)' : ' + git init'}`);
  try {
    resetGit(plan.outputDirAbs, plan.projectName, plan.skipGit);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // 6. Strip discovery docs
  if (!parsed.json) console.log('[atelier init] stripping discovery docs to template skeletons');
  let stripResult: { stripped: string[]; deleted: string[] };
  try {
    stripResult = stripDiscoveryDocs(plan);
  } catch (err) {
    return { ok: false, error: `strip discovery docs failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 7. Customize config.yaml
  if (!parsed.json) console.log('[atelier init] customizing .atelier/config.yaml');
  try {
    customizeConfigYaml(plan);
  } catch (err) {
    return { ok: false, error: `customize config.yaml failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 8. Customize README.md
  if (!parsed.json) console.log('[atelier init] customizing README.md');
  try {
    customizeReadme(plan);
  } catch (err) {
    return { ok: false, error: `customize README.md failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 9. Reset traceability
  try {
    resetTraceability(plan);
  } catch (err) {
    return { ok: false, error: `reset traceability.json failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Optional re-commit so the customizations land in the initial commit
  // history. Skip silently if git wasn't initialized (--skip-git).
  if (!plan.skipGit) {
    const add = execGit(['add', '-A'], plan.outputDirAbs);
    if (add.code === 0) {
      // Amend the initial commit so adopters see one clean commit, not two.
      spawnSync(
        'git',
        ['commit', '--amend', '--quiet', '--no-edit'],
        {
          cwd: plan.outputDirAbs,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? 'Atelier Init',
            GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? 'init@atelier.local',
            GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? 'Atelier Init',
            GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? 'init@atelier.local',
          },
        },
      );
    }
  }

  // 10. Datastore mode dispatch
  let datastoreExitCode: number | undefined;
  if (plan.datastoreMode === 'local') {
    if (!parsed.json) {
      console.log('');
      console.log(`[atelier init] running \`atelier datastore init\` inside ${plan.outputDir}`);
      console.log('');
    }
    datastoreExitCode = await execAtelierIn(plan.outputDirAbs, ['datastore', 'init']);
    if (datastoreExitCode !== 0) {
      // Project dir is left scaffolded; operator can re-run after fixing.
      return {
        ok: false,
        error: `\`atelier datastore init\` failed (exit ${datastoreExitCode}); project dir is scaffolded at ${plan.outputDirAbs}. Fix the underlying issue and re-run \`atelier datastore init\` from inside the project.`,
        stripped: stripResult.stripped,
        deleted: stripResult.deleted,
        datastoreExitCode,
      };
    }
  } else if (plan.datastoreMode === 'cloud') {
    if (!parsed.json) {
      console.log('');
      console.log('Cloud datastore configuration (operator-side):');
      console.log('  1. Create a Supabase Cloud project (or pick an existing one).');
      console.log('  2. Set ATELIER_DATASTORE_URL to your Supabase Cloud Postgres URL.');
      console.log(`     Example: export ATELIER_DATASTORE_URL=postgresql://...`);
      console.log(`  3. From inside ${plan.outputDir}, run: atelier datastore init --remote`);
      console.log('');
      console.log('Atelier does not provision Supabase projects automatically — tier,');
      console.log('region, billing, and naming are adopter-side decisions.');
    }
  } else {
    if (!parsed.json) {
      console.log('');
      console.log('Datastore not configured (--datastore-mode skip).');
      console.log(`Run \`atelier datastore init\` from inside ${plan.outputDir} when ready.`);
    }
  }

  // 11. Invite delegation
  let inviteExitCode: number | undefined;
  if (plan.email && plan.datastoreMode !== 'skip') {
    if (!parsed.json) {
      console.log('');
      console.log(`[atelier init] running \`atelier invite\` for ${plan.email}`);
      console.log('');
    }
    inviteExitCode = await execAtelierIn(plan.outputDirAbs, [
      'invite',
      '--email', plan.email,
      '--discipline', plan.discipline,
      '--access-level', 'admin',
    ]);
    if (inviteExitCode !== 0) {
      return {
        ok: false,
        error: `\`atelier invite\` failed (exit ${inviteExitCode}); project dir is scaffolded + datastore is up. Re-run \`atelier invite\` manually from inside the project.`,
        stripped: stripResult.stripped,
        deleted: stripResult.deleted,
        datastoreExitCode,
        inviteExitCode,
      };
    }
  }

  return {
    ok: true,
    plan,
    stripped: stripResult.stripped,
    deleted: stripResult.deleted,
    datastoreExitCode,
    inviteExitCode,
  };
}

function printFinalSummary(plan: Plan): void {
  console.log('');
  console.log('atelier init -- DONE');
  console.log('');
  console.log(`  project          ${plan.projectName} (${plan.projectUuid})`);
  console.log(`  output_dir       ${plan.outputDirAbs}`);
  console.log(`  datastore_mode   ${plan.datastoreMode}`);
  console.log('');
  console.log('Next steps:');
  console.log('');
  console.log(`  cd ${plan.outputDir}`);
  if (!plan.email) {
    console.log(`  atelier invite --email you@example.com --discipline ${plan.discipline} --access-level admin`);
  }
  console.log('  atelier dev');
  console.log('');
  console.log('Then open the magic link from your inbox to sign in at http://127.0.0.1:3030/atelier');
}

export async function runInit(args: readonly string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    console.error(`atelier init: ${err instanceof Error ? err.message : err}`);
    console.error('');
    console.error(initUsage);
    return 2;
  }

  if (parsed.help) {
    console.log(initUsage);
    return 0;
  }

  const errors = validate(parsed);
  if (errors.length > 0) {
    if (parsed.json) {
      console.log(JSON.stringify({ ok: false, errors }, null, 2));
    } else {
      console.error('atelier init: validation failed');
      for (const e of errors) {
        console.error(`  ${e.field}: ${e.message}`);
      }
      console.error('');
      console.error(initUsage);
    }
    return 2;
  }

  const plan = buildPlan(parsed);

  // Pre-mutation: if output dir exists without --force, fail before printing
  // the plan (operator should fix that first).
  if (plan.alreadyExists && !plan.force && !parsed.dryRun) {
    const msg = `output directory exists: ${plan.outputDirAbs} (pass --force to scaffold into it anyway)`;
    if (parsed.json) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.error(`atelier init: ${msg}`);
    }
    return 2;
  }

  if (parsed.dryRun) {
    if (parsed.json) {
      console.log(JSON.stringify({ ok: true, dryRun: true, plan }, null, 2));
    } else {
      console.log(renderPlan(plan, true));
      console.log('');
      console.log('No mutations performed. Re-run without --dry-run to apply.');
    }
    return 0;
  }

  if (!parsed.json) {
    console.log(renderPlan(plan, false));
    console.log('');
  }

  const result = await runMutation(plan, parsed);

  if (!result.ok) {
    if (parsed.json) {
      console.log(JSON.stringify({ ok: false, error: result.error, plan }, null, 2));
    } else {
      console.error('');
      console.error('atelier init -- FAILED');
      console.error(`  ${result.error}`);
    }
    return 1;
  }

  if (parsed.json) {
    console.log(JSON.stringify({ ok: true, plan, stripped: result.stripped, deleted: result.deleted, datastoreExitCode: result.datastoreExitCode, inviteExitCode: result.inviteExitCode }, null, 2));
  } else {
    printFinalSummary(plan);
  }
  return 0;
}

