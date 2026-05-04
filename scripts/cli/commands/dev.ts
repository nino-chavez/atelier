// `atelier dev` — bring up the local Atelier substrate end-to-end.
//
// Closes US-11.13 (M7 Track 1 / kickoff highest-leverage CLI addition).
// Bootstrap friction has been the most consistent operational pain through
// M2-M6 (4+ runbook drift findings, 2 bearer-cache incidents, 1 port-mismatch
// fix); `atelier dev` collapses Step 0 + Steps 1, 2, 4, 5 of
// docs/user/tutorials/local-bootstrap.md into one command.
//
// Behavior:
//   1. Run pre-flight checks (docker, supabase CLI, env file present)
//   2. Start supabase if not already running (idempotent)
//   3. Verify port :3030 is free (or that we already own it)
//   4. Start `next dev -p 3030` in prototype/ if not running
//   5. Wait for dev server to signal ready
//   6. Issue or rotate bearer if expired/near-expiry; update .mcp.json
//   7. Print connection summary (the URLs, the bearer expiry, the /atelier link,
//      the load-bearing reminder about Claude Code's bearer cache)
//
// Idempotent: re-running with healthy substrate is a no-op (just re-prints
// the summary). Partial-up substrates resume gracefully (e.g., supabase
// running but dev server stopped → only starts dev server).
//
// Failure modes (per US-11.13 acceptance):
//   - Port :3030 held by foreign process → exit 1 with clear diagnostic
//   - prototype/.env.local missing or missing required keys → exit 1 with
//     "copy from .env.example and fill in OPENAI_API_KEY" hint
//   - Docker unreachable → exit 1 with "start Docker Desktop" hint
//   - Supabase CLI not installed → exit 1 with install hint
//
// Does NOT:
//   - Tear anything down on exit (substrate persists; explicit `supabase stop`
//     + Ctrl-C of dev server still required to clean shut down)
//   - Modify global state outside the repo (no ~/.claude.json edits;
//     .mcp.json is repo-scoped)
//   - Run migrations directly (relies on `supabase start` to apply them per
//     supabase/config.toml)

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  runPreflight,
  formatReport,
  startSupabase,
  startDevServer,
  checkOurDevServer,
  type PreflightReport,
} from '../lib/preflight.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

export const devUsage = `atelier dev — bring up the local Atelier substrate

Usage:
  atelier dev [--no-bearer-rotation] [--preflight-only]

Options:
  --no-bearer-rotation   Skip bearer issuance/rotation (use existing .mcp.json as-is)
  --preflight-only       Run pre-flight checks and exit (no orchestration)

Behavior:
  1. Run pre-flight checks (docker, supabase CLI, prototype/.env.local)
  2. Start supabase if not already running
  3. Start prototype dev server (next dev -p 3030) if not already running
  4. Issue or rotate bearer if expired/near-expiry; update .mcp.json
  5. Print connection summary

Re-running is idempotent: healthy substrates resume cleanly; partial-up
substrates start only what's missing. Port :3030 conflicts (foreign process)
exit non-zero rather than silently falling back.

Pre-requisites:
  - Node 22+, supabase CLI, Docker Desktop (or compatible runtime)
  - prototype/.env.local with POSTGRES_URL, NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY,
    OPENAI_API_KEY (copy from prototype/.env.example)
  - A composer seeded for your email (per scripts/bootstrap/seed-composer.ts;
    see docs/user/tutorials/local-bootstrap.md Step 3)

Cross-references:
  - docs/user/tutorials/local-bootstrap.md (the runbook this command condenses)
  - scripts/bootstrap/{issue-bearer,rotate-bearer,seed-composer}.ts (helpers)
  - BRD US-11.13 (story this command satisfies)
`;

export async function runDev(args: readonly string[]): Promise<number> {
  const flags = new Set(args);
  const noBearerRotation = flags.has('--no-bearer-rotation');
  const preflightOnly = flags.has('--preflight-only');

  console.log('[atelier dev] running pre-flight checks...');
  let report = await runPreflight();
  console.log(formatReport(report));

  if (preflightOnly) {
    return reportPasses(report) ? 0 : 1;
  }

  // Hard-fail conditions surfaced by pre-flight: docker/cli/env missing.
  if (!report.docker.ok) {
    console.error('\n[atelier dev] FAIL: docker not running');
    return 1;
  }
  if (!report.supabaseCli.ok) {
    console.error('\n[atelier dev] FAIL: supabase CLI not installed');
    return 1;
  }
  if (!report.envFile.ok) {
    console.error(`\n[atelier dev] FAIL: ${report.envFile.detail}`);
    return 1;
  }

  // Port :3030 conflict that's NOT our dev server: exit. Per acceptance:
  // don't silently fall back to a different port.
  if (!report.port3030.ok && !report.devServer.ok) {
    console.error('\n[atelier dev] FAIL: port :3030 is held by an unknown process');
    console.error('  diagnose with: lsof -i :3030');
    return 1;
  }

  // Start supabase if not running.
  if (!report.supabaseRunning.ok) {
    try {
      await startSupabase();
    } catch (err) {
      console.error(`\n[atelier dev] FAIL: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  } else {
    console.log('[atelier dev] supabase already running -- skipping start');
  }

  // Start dev server if not running.
  let devServerStartedHere = false;
  if (!report.devServer.ok) {
    try {
      const { ready } = startDevServer();
      await ready;
      devServerStartedHere = true;
    } catch (err) {
      console.error(`\n[atelier dev] FAIL: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  } else {
    console.log('[atelier dev] dev server already running -- skipping start');
  }

  // Re-poll dev server reachability (after a startup, server may need a
  // moment beyond "Ready" log signal before /api/mcp accepts requests).
  let devReady = await checkOurDevServer();
  if (!devReady.ok && devServerStartedHere) {
    // Brief retry loop -- next dev's "Ready" log can lead the actual
    // route-handler readiness by a few hundred ms.
    for (let i = 0; i < 10 && !devReady.ok; i++) {
      await new Promise((r) => setTimeout(r, 500));
      devReady = await checkOurDevServer();
    }
  }

  // Bearer rotation. Re-check post-startup since the .mcp.json existence may
  // have changed (operator may have issued one in the interim).
  report = await runPreflight();
  if (!report.bearer.status.ok && !noBearerRotation) {
    console.log('[atelier dev] bearer needs rotation; running rotate-bearer.ts...');
    const rotated = await rotateBearerIfPossible();
    if (!rotated.ok) {
      console.warn(`[atelier dev] bearer rotation skipped: ${rotated.detail}`);
      console.warn('  manually issue via: SUPABASE_URL=... SUPABASE_ANON_KEY=... \\');
      console.warn('    npx tsx scripts/bootstrap/rotate-bearer.ts \\');
      console.warn('    --email <you> --password <pwd>');
    }
  }

  // Final connection summary.
  printSummary();
  return 0;
}

function reportPasses(report: PreflightReport): boolean {
  return Object.values(report).every((s) => {
    if (typeof s !== 'object' || s === null) return true;
    if ('ok' in s) return s.ok;
    if ('status' in s && typeof s.status === 'object' && s.status !== null && 'ok' in s.status) {
      return s.status.ok;
    }
    return true;
  });
}

interface RotateOutcome {
  ok: boolean;
  detail?: string;
}

async function rotateBearerIfPossible(): Promise<RotateOutcome> {
  // We need SUPABASE_URL + SUPABASE_ANON_KEY + an email/password to rotate.
  // Resolve via supabase status -o env (for SUPABASE_URL + ANON_KEY) and
  // require email/password from a sidecar config (.atelier/dev-credentials.json
  // or env vars) since we can't safely guess them.
  const env = readSupabaseEnv();
  if (!env) return { ok: false, detail: 'could not resolve SUPABASE_URL + SUPABASE_ANON_KEY from supabase status' };

  const creds = readDevCredentials();
  if (!creds) {
    return {
      ok: false,
      detail: 'no dev credentials cached (set ATELIER_DEV_EMAIL + ATELIER_DEV_PASSWORD env vars OR create .atelier/dev-credentials.json {email,password})',
    };
  }

  const result = spawnSync(
    'npx',
    [
      'tsx',
      resolve(REPO_ROOT, 'scripts/bootstrap/rotate-bearer.ts'),
      '--email',
      creds.email,
      '--password',
      creds.password,
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        SUPABASE_URL: env.url,
        SUPABASE_ANON_KEY: env.anonKey,
      },
    },
  );

  if (result.status !== 0) {
    return { ok: false, detail: `rotate-bearer.ts exited ${result.status}` };
  }
  return { ok: true };
}

interface SupabaseEnv {
  url: string;
  anonKey: string;
}

function readSupabaseEnv(): SupabaseEnv | null {
  const out = spawnSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  if (out.status !== 0) return null;
  const parsed: Record<string, string> = {};
  for (const line of out.stdout.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)="(.*)"$/);
    if (m) parsed[m[1]!] = m[2]!;
  }
  if (!parsed.API_URL || !parsed.ANON_KEY) return null;
  return { url: parsed.API_URL, anonKey: parsed.ANON_KEY };
}

interface DevCredentials {
  email: string;
  password: string;
}

function readDevCredentials(): DevCredentials | null {
  const envEmail = process.env['ATELIER_DEV_EMAIL'];
  const envPwd = process.env['ATELIER_DEV_PASSWORD'];
  if (envEmail && envPwd) return { email: envEmail, password: envPwd };

  const credPath = resolve(REPO_ROOT, '.atelier', 'dev-credentials.json');
  if (!existsSync(credPath)) return null;
  try {
    const body = JSON.parse(spawnSyncSafeRead(credPath)) as { email?: string; password?: string };
    if (body.email && body.password) return { email: body.email, password: body.password };
    return null;
  } catch {
    return null;
  }
}

// Tiny helper because spawnSync isn't great for file reads; we want sync read.
function spawnSyncSafeRead(path: string): string {
  // Use node fs sync for the credentials read; deferred imports are fine.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  return fs.readFileSync(path, 'utf8');
}

function printSummary(): void {
  console.log('');
  console.log('=========================================');
  console.log('Atelier substrate ready');
  console.log('=========================================');
  console.log('');
  console.log('Endpoints:');
  console.log('  /api/mcp           http://localhost:3030/api/mcp');
  console.log('  /oauth/api/mcp     http://localhost:3030/oauth/api/mcp');
  console.log('  /atelier (lens UI) http://localhost:3030/atelier');
  console.log('');
  console.log('MCP client config: .mcp.json (Claude Code reads this on cold start)');
  console.log('');
  console.log('IMPORTANT: Claude Code caches the bearer in process state. If you');
  console.log("rotated the bearer above, quit Claude Code completely and start a");
  console.log('fresh session for the new bearer to take effect. /mcp Disable->Enable');
  console.log('and `exit`+relaunch from the same shell are NOT sufficient.');
  console.log('');
  console.log('Stop substrate:');
  console.log('  - dev server: Ctrl-C this process (if foregrounded) or kill the npm pid');
  console.log('  - supabase:   supabase stop');
}
