// `atelier deploy` (US-11.3; BUILD-SEQUENCE §9; D6 polished form).
//
// Wraps the canonical first-deploy.md sequence into one command:
//   1. Pre-flight: vercel CLI installed + logged in; prototype project linked;
//      required env vars set on Vercel (production scope)
//   2. Pre-deploy validation: typecheck (root + prototype), portability lint,
//      yaml lint  (skippable via --skip-checks)
//   3. Build: cd prototype && npm run build  (skippable via --skip-build)
//   4. Deploy: cd prototype && vercel deploy [--prod]
//   5. Post-deploy verification: discovery published + /api/mcp dispatches
//      (warn on failure; do not fail the run -- substrate is up either way)
//   6. Confirmation summary with next-steps (sign-in URL, auto-deploy hint,
//      bearer-rotation hint)
//
// Per ADR-046 the canonical deploy is Vercel + Supabase Cloud + rootDirectory
// =prototype + URL split inheritance. This wrapper invokes the `vercel` CLI
// (installed by the operator) -- it does NOT introduce @vercel/sdk imports
// (per ADR-029 GCP-portability; the CLI is the right boundary).
//
// What this command does NOT do (intentionally; adopter-side decisions):
//   - `vercel link`: interactive (org + project picker); operator invokes once
//   - `vercel env add`: env vars may contain secrets the operator manages
//     outside the repo; deploy reads them but does not write them
//   - Provision Supabase Cloud / Vercel projects: see first-deploy.md Step 1
//     and Step 3 for the one-time setup
//
// Companion runbooks:
//   - docs/user/tutorials/first-deploy.md (one-time setup)
//   - docs/user/guides/enable-auto-deploy.md (git auto-deploy companion)
//   - docs/user/guides/rotate-bearer.md (bearer rotation post-deploy)

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const PROTOTYPE_DIR = resolve(REPO_ROOT, 'prototype');
const PROJECT_LINK_PATH = resolve(PROTOTYPE_DIR, '.vercel', 'project.json');

// Per docs/user/tutorials/first-deploy.md (rewritten for the canonical
// rebuild) the recommended env-provisioning path is the Vercel-Supabase
// Marketplace integration, which auto-provisions POSTGRES_URL,
// NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (Supabase keeps
// the legacy name in the integration), SUPABASE_SERVICE_ROLE_KEY, and
// POSTGRES_URL_NON_POOLING. OPENAI_API_KEY remains a manual setting.
const REQUIRED_ENV_VARS = [
  'POSTGRES_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
] as const;

export const deployUsage = `atelier deploy — push prototype + endpoint to Vercel

Usage:
  atelier deploy [options]

Options:
  --preview        Deploy to a Vercel preview URL instead of production.
                   Default: production (\`vercel deploy --prod\`).
  --skip-checks    Bypass pre-deploy typecheck + lint. For emergencies only;
                   shipping unverified code into production is not the path.
  --skip-build     Trust the most recent prototype/.next build; skip rebuild.
                   Errors if prototype/.next is missing.
  --dry-run        Preview the full sequence (preflight + plan) without
                   invoking vercel. Exits 0.
  --json           Machine-readable JSON output.
  -h, --help       Show this help.

Behavior contract:
  Exit 0 on successful deploy (post-deploy verification warnings do not
  fail the run; the deploy itself succeeded).
  Exit 1 on validation, build, or vercel-CLI failure.
  Exit 2 on argument or precondition error (Vercel CLI missing, not logged
  in, project not linked, required env vars missing, unknown flag).

Pre-flight checks:
  - vercel CLI installed (\`vercel --version\`)
  - logged in to Vercel (\`vercel whoami\`)
  - project linked to Vercel (prototype/.vercel/project.json present)
  - required env vars set (production scope when --preview is unset):
      ${REQUIRED_ENV_VARS.join(', ')}

This command does NOT:
  - run \`vercel link\` (interactive; operator picks org + project once)
  - set env vars (they may carry secrets the operator manages outside repo)
  - provision Supabase Cloud / Vercel projects (one-time per first-deploy.md)

Cross-references:
  - ADR-046 (canonical deploy strategy: Vercel + Supabase Cloud +
    rootDirectory=prototype + URL split inheritance)
  - docs/user/tutorials/first-deploy.md (one-time setup runbook)
  - docs/user/guides/enable-auto-deploy.md (git auto-deploy companion)
  - docs/user/guides/rotate-bearer.md (bearer rotation post-deploy)
  - BUILD-SEQUENCE.md §9 (12 v1 CLI commands; this is row 3)
`;

// ---------------------------------------------------------------------------
// Argument parsing + plan
// ---------------------------------------------------------------------------

interface ParsedArgs {
  preview: boolean;
  skipChecks: boolean;
  skipBuild: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    preview: false,
    skipChecks: false,
    skipBuild: false,
    dryRun: false,
    json: false,
    help: false,
  };
  for (const a of args) {
    switch (a) {
      case '--preview': out.preview = true; break;
      case '--skip-checks': out.skipChecks = true; break;
      case '--skip-build': out.skipBuild = true; break;
      case '--dry-run': out.dryRun = true; break;
      case '--json': out.json = true; break;
      case '--help':
      case '-h': out.help = true; break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

interface Plan {
  mode: 'production' | 'preview';
  vercelEnvironment: 'production' | 'preview';
  skipChecks: boolean;
  skipBuild: boolean;
}

function buildPlan(parsed: ParsedArgs): Plan {
  return {
    mode: parsed.preview ? 'preview' : 'production',
    vercelEnvironment: parsed.preview ? 'preview' : 'production',
    skipChecks: parsed.skipChecks,
    skipBuild: parsed.skipBuild,
  };
}

function renderPlan(p: Plan, dryRun: boolean): string {
  const lines: string[] = [];
  lines.push(`atelier deploy -- ${dryRun ? 'PLAN (dry-run)' : 'PLAN'}`);
  lines.push('');
  lines.push(`  mode             ${p.mode}`);
  lines.push(`  vercel env scope ${p.vercelEnvironment}`);
  lines.push(`  skip_checks      ${p.skipChecks}`);
  lines.push(`  skip_build       ${p.skipBuild}`);
  lines.push('');
  const verb = dryRun ? 'would' : 'will';
  lines.push(`Steps (${dryRun ? 'no mutations' : 'in order'}):`);
  lines.push(`  1. ${verb} pre-flight: vercel CLI, login, project link, env vars`);
  if (p.skipChecks) {
    lines.push(`  2. (skip-checks) ${verb} NOT run typecheck + portability lint + yaml lint`);
  } else {
    lines.push(`  2. ${verb} run typecheck (root + prototype) + portability lint + yaml lint`);
  }
  if (p.skipBuild) {
    lines.push(`  3. (skip-build) ${verb} trust most recent prototype/.next; skip \`npm run build\``);
  } else {
    lines.push(`  3. ${verb} run \`cd prototype && npm run build\``);
  }
  const deployCmd = p.mode === 'production' ? '`vercel deploy --prod`' : '`vercel deploy`';
  lines.push(`  4. ${verb} run ${deployCmd} from prototype/`);
  lines.push(`  5. ${verb} verify discovery + /api/mcp dispatch (warn on failure; non-blocking)`);
  lines.push(`  6. ${verb} print confirmation summary (URL, sign-in, auto-deploy hint)`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

interface CheckResult { ok: boolean; detail?: string }

function checkVercelCli(): CheckResult {
  const r = spawnSync('vercel', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error || r.status !== 0) {
    return {
      ok: false,
      detail: 'vercel CLI not installed; install via `npm install -g vercel` (or `pnpm add -g vercel`)',
    };
  }
  return { ok: true, detail: r.stdout.trim() };
}

function checkVercelLogin(): CheckResult {
  const r = spawnSync('vercel', ['whoami'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error || r.status !== 0) {
    const stderr = (r.stderr ?? '').trim();
    return {
      ok: false,
      detail: `not logged in to Vercel; run \`vercel login\`${stderr ? ` (saw: ${stderr.split('\n')[0]})` : ''}`,
    };
  }
  return { ok: true, detail: r.stdout.trim() };
}

function checkProjectLink(): CheckResult {
  if (!existsSync(PROJECT_LINK_PATH)) {
    return {
      ok: false,
      detail: [
        `prototype/.vercel/project.json missing — Vercel project not linked.`,
        '  Link once via the operator-driven flow (see docs/user/tutorials/first-deploy.md "Step 3: Configure the Vercel project"):',
        '    cd prototype && vercel link',
        '  This command does NOT auto-run vercel link (it requires interactive org + project selection).',
      ].join('\n'),
    };
  }
  return { ok: true };
}

interface EnvCheckResult { ok: boolean; missing: string[]; detail?: string }

function checkVercelEnvVars(envScope: 'production' | 'preview'): EnvCheckResult {
  const r = spawnSync(
    'vercel',
    ['env', 'ls', envScope],
    { encoding: 'utf8', cwd: PROTOTYPE_DIR, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (r.error || r.status !== 0) {
    const stderr = (r.stderr ?? '').trim();
    return {
      ok: false,
      missing: [],
      detail: `\`vercel env ls ${envScope}\` failed${stderr ? ` (saw: ${stderr.split('\n')[0]})` : ''}; verify the project is linked + you have read access`,
    };
  }
  // `vercel env ls <env>` prints a table; each var name appears as a token in
  // the leading columns. We match by whole-word presence on any line.
  const out = r.stdout;
  const missing = REQUIRED_ENV_VARS.filter((name) => {
    const re = new RegExp(`(^|\\s)${name}(\\s|$)`, 'm');
    return !re.test(out);
  });
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      detail: [
        `${missing.length} required env var(s) missing in Vercel ${envScope} scope:`,
        ...missing.map((n) => `  - ${n}`),
        `  Set via:`,
        ...missing.map((n) => `    vercel env add ${n} ${envScope}`),
        `  (or via the Vercel dashboard UI; see first-deploy.md Step 3.4 for sources)`,
      ].join('\n'),
    };
  }
  return { ok: true, missing: [] };
}

interface PreflightReport {
  cli: CheckResult;
  login: CheckResult;
  link: CheckResult;
  env: EnvCheckResult;
  ok: boolean;
}

function runPreflight(envScope: 'production' | 'preview'): PreflightReport {
  const cli = checkVercelCli();
  if (!cli.ok) {
    return {
      cli,
      login: { ok: false, detail: 'skipped (vercel CLI missing)' },
      link: { ok: false, detail: 'skipped (vercel CLI missing)' },
      env: { ok: false, missing: [], detail: 'skipped (vercel CLI missing)' },
      ok: false,
    };
  }
  const login = checkVercelLogin();
  if (!login.ok) {
    return {
      cli,
      login,
      link: { ok: false, detail: 'skipped (not logged in)' },
      env: { ok: false, missing: [], detail: 'skipped (not logged in)' },
      ok: false,
    };
  }
  const link = checkProjectLink();
  if (!link.ok) {
    return {
      cli,
      login,
      link,
      env: { ok: false, missing: [], detail: 'skipped (project not linked)' },
      ok: false,
    };
  }
  const env = checkVercelEnvVars(envScope);
  return { cli, login, link, env, ok: env.ok };
}

function formatPreflight(p: PreflightReport): string {
  const lines: string[] = [];
  const fmt = (label: string, ok: boolean, detail: string | undefined): string => {
    const icon = ok ? '[OK]  ' : '[!!]  ';
    return `  ${icon}${label.padEnd(18)} ${detail ?? ''}`;
  };
  lines.push('Pre-flight:');
  lines.push(fmt('vercel CLI', p.cli.ok, p.cli.detail));
  lines.push(fmt('vercel login', p.login.ok, p.login.detail));
  lines.push(fmt('project link', p.link.ok, p.link.detail));
  lines.push(fmt('env vars', p.env.ok, p.env.detail));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Pre-deploy validation
// ---------------------------------------------------------------------------

interface ValidationStep { name: string; cmd: string; cwd: string }

const VALIDATION_STEPS: readonly ValidationStep[] = [
  { name: 'typecheck (root)', cmd: 'npm run typecheck', cwd: REPO_ROOT },
  { name: 'typecheck (prototype)', cmd: 'npm run typecheck', cwd: PROTOTYPE_DIR },
  { name: 'lint:portability', cmd: 'npm run lint:portability', cwd: REPO_ROOT },
  { name: 'lint:yaml', cmd: 'npm run lint:yaml', cwd: REPO_ROOT },
];

function runValidation(json: boolean): { ok: boolean; failedStep?: string; detail?: string } {
  for (const step of VALIDATION_STEPS) {
    if (!json) console.log(`[atelier deploy] ${step.name}: ${step.cmd}`);
    const [bin, ...rest] = step.cmd.split(' ');
    const r = spawnSync(bin!, rest, { cwd: step.cwd, stdio: json ? 'pipe' : 'inherit', encoding: 'utf8' });
    if (r.status !== 0) {
      const tail = json
        ? `${(r.stdout ?? '').slice(-500)}\n${(r.stderr ?? '').slice(-500)}`.trim()
        : '(see output above)';
      return { ok: false, failedStep: step.name, detail: tail };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function runBuild(json: boolean): { ok: boolean; detail?: string } {
  const r = spawnSync('npm', ['run', 'build'], {
    cwd: PROTOTYPE_DIR,
    stdio: json ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    const tail = json ? `${(r.stdout ?? '').slice(-1000)}\n${(r.stderr ?? '').slice(-1000)}`.trim() : '(see output above)';
    return { ok: false, detail: `prototype build failed: ${tail}` };
  }
  return { ok: true };
}

function checkBuildArtifact(): { ok: boolean; detail?: string } {
  const dotNext = resolve(PROTOTYPE_DIR, '.next');
  if (!existsSync(dotNext)) {
    return {
      ok: false,
      detail: '--skip-build requested but prototype/.next is missing; remove --skip-build or run `cd prototype && npm run build` first',
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Deploy (vercel CLI shell-out)
// ---------------------------------------------------------------------------

function runVercelDeploy(plan: Plan, json: boolean): Promise<{ ok: boolean; url?: string; detail?: string }> {
  return new Promise((res) => {
    const args = plan.mode === 'production' ? ['deploy', '--prod'] : ['deploy'];
    if (!json) console.log(`[atelier deploy] vercel ${args.join(' ')} (cwd: prototype/)`);
    let stdout = '';
    let stderr = '';
    const proc = spawn('vercel', args, {
      cwd: PROTOTYPE_DIR,
      stdio: json ? 'pipe' : ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (!json) process.stdout.write(text);
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (!json) process.stderr.write(text);
    });
    proc.on('error', (err) => {
      res({ ok: false, detail: `vercel deploy failed to spawn: ${err.message}` });
    });
    proc.on('exit', (code) => {
      if (code !== 0) {
        res({ ok: false, detail: `vercel deploy exited ${code}; ${stderr.slice(-500).trim() || stdout.slice(-500).trim()}` });
        return;
      }
      // Vercel prints the deploy URL on stdout (and on stderr in some recent
      // CLI versions). Match the first https://...vercel.app or https URL.
      const urlMatch =
        stdout.match(/https:\/\/[^\s]+\.vercel\.app[^\s]*/) ||
        stderr.match(/https:\/\/[^\s]+\.vercel\.app[^\s]*/) ||
        stdout.match(/https:\/\/[^\s]+/) ||
        stderr.match(/https:\/\/[^\s]+/);
      if (urlMatch) {
        res({ ok: true, url: urlMatch[0].replace(/[)\].,]+$/, '') });
      } else {
        res({ ok: true });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Post-deploy verification
// ---------------------------------------------------------------------------

interface ProbeResult { ok: boolean; detail: string; statusCode?: number }

function probeDiscovery(deployUrl: string): Promise<ProbeResult> {
  return new Promise((res) => {
    let url: URL;
    try {
      // Per ADR-046 + first-deploy.md Step 4: discovery is published only at
      // the path-prefixed URL under the OAuth-flow path. Bare-path 404 is
      // intentional (PR #16 catch-all). Probe the path-prefixed URL for 200.
      url = new URL('/.well-known/oauth-authorization-server/oauth/api/mcp', deployUrl);
    } catch {
      res({ ok: false, detail: `invalid deploy URL for discovery probe: ${deployUrl}` });
      return;
    }
    const reqFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = reqFn(
      {
        host: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'GET',
        timeout: 8000,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => {
          if (status !== 200) {
            res({ ok: false, statusCode: status, detail: `discovery probe got HTTP ${status} (expected 200)` });
            return;
          }
          try {
            const parsed = JSON.parse(body) as { issuer?: string; authorization_endpoint?: string };
            if (!parsed.issuer || !parsed.authorization_endpoint) {
              res({ ok: false, statusCode: status, detail: 'discovery JSON missing issuer / authorization_endpoint' });
              return;
            }
            res({ ok: true, statusCode: status, detail: `discovery published (issuer=${parsed.issuer})` });
          } catch (err) {
            res({ ok: false, statusCode: status, detail: `discovery body not valid JSON: ${err instanceof Error ? err.message : String(err)}` });
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      res({ ok: false, detail: 'discovery probe timeout (8s)' });
    });
    req.on('error', (err) => {
      res({ ok: false, detail: `discovery probe transport error: ${err.message}` });
    });
    req.end();
  });
}

function probeMcpUnauth(deployUrl: string): Promise<ProbeResult> {
  return new Promise((res) => {
    let url: URL;
    try {
      url = new URL('/api/mcp', deployUrl);
    } catch {
      res({ ok: false, detail: `invalid deploy URL for /api/mcp probe: ${deployUrl}` });
      return;
    }
    const reqFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = reqFn(
      {
        host: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 8000,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        // Drain the body so the connection closes cleanly.
        response.resume();
        if (status === 401) {
          res({ ok: true, statusCode: status, detail: 'returned 401 (expected without bearer; endpoint dispatches)' });
        } else if (status === 405) {
          res({ ok: true, statusCode: status, detail: 'returned 405 (route reachable; expects POST JSON-RPC)' });
        } else {
          res({ ok: false, statusCode: status, detail: `unexpected HTTP ${status} from /api/mcp without bearer` });
        }
      },
    );
    req.on('timeout', () => {
      req.destroy();
      res({ ok: false, detail: '/api/mcp probe timeout (8s)' });
    });
    req.on('error', (err) => {
      res({ ok: false, detail: `/api/mcp probe transport error: ${err.message}` });
    });
    req.write('{}');
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface DeployResult {
  ok: boolean;
  plan?: Plan;
  preflight?: PreflightReport;
  validation?: { ok: boolean; failedStep?: string; detail?: string };
  build?: { ok: boolean; detail?: string };
  deploy?: { ok: boolean; url?: string; detail?: string };
  verification?: { discovery: ProbeResult; mcp: ProbeResult };
  error?: string;
}

function printSummary(plan: Plan, deployUrl: string, verification: { discovery: ProbeResult; mcp: ProbeResult }): void {
  console.log('');
  console.log('atelier deploy -- DONE');
  console.log('');
  console.log(`  mode             ${plan.mode}`);
  console.log(`  deploy_url       ${deployUrl}`);
  console.log(`  discovery        ${verification.discovery.ok ? 'OK' : 'WARN'} ${verification.discovery.detail}`);
  console.log(`  /api/mcp         ${verification.mcp.ok ? 'OK' : 'WARN'} ${verification.mcp.detail}`);
  console.log('');
  console.log('Next steps:');
  console.log('');
  console.log(`  Sign in via the magic-link UI: ${deployUrl}/sign-in`);
  console.log('  Configure auto-deploy:         see docs/user/guides/enable-auto-deploy.md');
  console.log('  Rotate your MCP-client bearer: see docs/user/guides/rotate-bearer.md');
}

export async function runDeploy(args: readonly string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    console.error(`atelier deploy: ${err instanceof Error ? err.message : err}`);
    console.error('');
    console.error(deployUsage);
    return 2;
  }

  if (parsed.help) {
    console.log(deployUsage);
    return 0;
  }

  const plan = buildPlan(parsed);

  // ------------------ Pre-flight ------------------
  const preflight = runPreflight(plan.vercelEnvironment);

  if (parsed.dryRun) {
    if (parsed.json) {
      const out: DeployResult = { ok: true, plan, preflight };
      console.log(JSON.stringify({ ...out, dryRun: true }, null, 2));
    } else {
      console.log(formatPreflight(preflight));
      console.log('');
      console.log(renderPlan(plan, true));
      console.log('');
      console.log('No mutations performed. Re-run without --dry-run to deploy.');
    }
    return 0;
  }

  if (!preflight.ok) {
    if (parsed.json) {
      const out: DeployResult = { ok: false, plan, preflight, error: 'preflight failed' };
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.error(formatPreflight(preflight));
      console.error('');
      const failingDetail = !preflight.cli.ok
        ? preflight.cli.detail
        : !preflight.login.ok
        ? preflight.login.detail
        : !preflight.link.ok
        ? preflight.link.detail
        : preflight.env.detail;
      console.error('atelier deploy: pre-flight failed');
      console.error('');
      if (failingDetail) console.error(failingDetail);
    }
    return 2;
  }

  if (!parsed.json) {
    console.log(formatPreflight(preflight));
    console.log('');
    console.log(renderPlan(plan, false));
    console.log('');
  }

  // ------------------ Validation ------------------
  let validation: { ok: boolean; failedStep?: string; detail?: string } = { ok: true };
  if (!plan.skipChecks) {
    validation = runValidation(parsed.json);
    if (!validation.ok) {
      const msg = `validation failed at step "${validation.failedStep}"`;
      if (parsed.json) {
        const out: DeployResult = { ok: false, plan, preflight, validation, error: msg };
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.error('');
        console.error(`atelier deploy: ${msg}`);
        console.error('Pass --skip-checks to bypass (not recommended for production).');
      }
      return 1;
    }
  } else if (!parsed.json) {
    console.log('[atelier deploy] (skip-checks) skipping typecheck + lint');
  }

  // ------------------ Build ------------------
  let build: { ok: boolean; detail?: string } = { ok: true };
  if (plan.skipBuild) {
    build = checkBuildArtifact();
    if (!build.ok) {
      const errMsg = build.detail ?? '--skip-build artifact check failed';
      if (parsed.json) {
        const out: DeployResult = { ok: false, plan, preflight, validation, build, error: errMsg };
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.error(`atelier deploy: ${errMsg}`);
      }
      return 1;
    }
    if (!parsed.json) console.log('[atelier deploy] (skip-build) trusting most recent prototype/.next');
  } else {
    if (!parsed.json) console.log('[atelier deploy] building prototype...');
    build = runBuild(parsed.json);
    if (!build.ok) {
      const errMsg = build.detail ?? 'prototype build failed';
      if (parsed.json) {
        const out: DeployResult = { ok: false, plan, preflight, validation, build, error: errMsg };
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.error('');
        console.error(`atelier deploy: ${errMsg}`);
      }
      return 1;
    }
  }

  // ------------------ Deploy ------------------
  const deploy = await runVercelDeploy(plan, parsed.json);
  if (!deploy.ok) {
    const errMsg = deploy.detail ?? 'vercel deploy failed';
    if (parsed.json) {
      const out: DeployResult = { ok: false, plan, preflight, validation, build, deploy, error: errMsg };
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.error('');
      console.error(`atelier deploy: ${errMsg}`);
    }
    return 1;
  }
  if (!deploy.url) {
    // Deploy succeeded but URL parsing failed; degrade to warning rather than
    // failing the run -- the deploy is up either way.
    if (!parsed.json) {
      console.log('');
      console.log('[atelier deploy] deploy succeeded but could not parse the URL from vercel CLI output.');
      console.log('  Run `vercel ls` to find the latest deployment URL.');
    }
    if (parsed.json) {
      const out: DeployResult = { ok: true, plan, preflight, validation, build, deploy };
      console.log(JSON.stringify(out, null, 2));
    }
    return 0;
  }

  // ------------------ Post-deploy verification ------------------
  if (!parsed.json) console.log(`[atelier deploy] verifying ${deploy.url}`);
  const [discovery, mcp] = await Promise.all([
    probeDiscovery(deploy.url),
    probeMcpUnauth(deploy.url),
  ]);

  if (parsed.json) {
    const out: DeployResult = {
      ok: true,
      plan,
      preflight,
      validation,
      build,
      deploy,
      verification: { discovery, mcp },
    };
    console.log(JSON.stringify(out, null, 2));
  } else {
    printSummary(plan, deploy.url, { discovery, mcp });
  }
  return 0;
}
