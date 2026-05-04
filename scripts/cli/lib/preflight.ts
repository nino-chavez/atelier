// Pre-flight checks shared by `atelier dev` (and reusable by future commands
// that depend on the local substrate's health). Mirrors the Step 0 checks in
// `docs/user/tutorials/local-bootstrap.md` — when atelier dev wraps these,
// the runbook's Step 0 condenses to "run atelier dev."

import { spawn, spawnSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { Buffer } from 'node:buffer';
import { createConnection } from 'node:net';
import { probeEndpoint as libProbe } from '../../lib/probe.ts';

export interface PreflightStatus {
  ok: boolean;
  detail?: string;
}

export interface PreflightReport {
  docker: PreflightStatus;
  supabaseCli: PreflightStatus;
  supabaseRunning: PreflightStatus;
  port3030: PreflightStatus;
  bearer: { status: PreflightStatus; remainingSeconds: number | null };
  devServer: PreflightStatus;
  envFile: PreflightStatus;
}

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

export function checkDocker(): PreflightStatus {
  const out = spawnSync('docker', ['info'], { stdio: 'ignore' });
  return out.status === 0
    ? { ok: true }
    : { ok: false, detail: 'docker daemon not reachable; start Docker Desktop or compatible runtime' };
}

export function checkSupabaseCli(): PreflightStatus {
  const out = spawnSync('supabase', ['--version'], { encoding: 'utf8' });
  if (out.status !== 0) {
    return { ok: false, detail: 'supabase CLI not found; install via `npm install -g supabase`' };
  }
  return { ok: true, detail: out.stdout.trim() };
}

export function checkSupabaseRunning(): PreflightStatus {
  // `supabase status` exits 0 when services are up. Stopped services in a
  // partial state still show informational output; rely on overall status.
  const out = spawnSync('supabase', ['status'], { encoding: 'utf8' });
  if (out.status !== 0) {
    return { ok: false, detail: 'supabase not running; will be started by atelier dev' };
  }
  // If "Stopped services" appears in the output but the core services are up,
  // we still treat it as healthy for our needs (auth + db are the load-bearing
  // pieces).
  return { ok: true };
}

export function checkPort3030(): Promise<PreflightStatus> {
  return new Promise((resolveStatus) => {
    const sock = createConnection({ port: 3030, host: '127.0.0.1', timeout: 500 });
    sock.on('connect', () => {
      sock.destroy();
      // Something is bound to :3030. Could be us (existing dev server) or another process.
      // Distinguish by hitting /api/mcp; if it's our endpoint we'll see a 405.
      checkOurDevServer().then(resolveStatus).catch(() =>
        resolveStatus({ ok: false, detail: 'port 3030 is bound by a process; cannot determine if it is the Atelier dev server' }),
      );
    });
    sock.on('error', () => {
      sock.destroy();
      resolveStatus({ ok: true, detail: 'port 3030 free' });
    });
    sock.on('timeout', () => {
      sock.destroy();
      resolveStatus({ ok: true, detail: 'port 3030 free (timeout, treated as free)' });
    });
  });
}

export async function checkOurDevServer(): Promise<PreflightStatus> {
  // Atelier MCP endpoint returns 401/405/200-4xx depending on bearer + verb.
  // Any reachable status in 2xx-5xx counts as "our server is up." Pure
  // transport errors fall through to the probe lib's defaults.
  const r = await libProbe({
    port: 3030,
    timeoutMs: 1500,
    classify: (status) => {
      if (status >= 200 && status < 600) {
        return { ok: true, detail: `dev server reachable (HTTP ${status})`, statusCode: status };
      }
      return {
        ok: false,
        detail: `port 3030 responded with unexpected status ${status}`,
        statusCode: status,
      };
    },
  });
  // Map the lib's transport-error wording to the preflight-specific phrasing
  // adopters expect from earlier versions of `atelier dev` output.
  if (!r.ok && r.statusCode === undefined) {
    if (r.detail.startsWith('timeout')) {
      return { ok: false, detail: 'port 3030 timed out on /api/mcp probe' };
    }
    return { ok: false, detail: 'port 3030 not reachable on /api/mcp; need to start dev server' };
  }
  return r.ok ? { ok: true, detail: r.detail } : { ok: false, detail: r.detail };
}

export interface BearerStatus {
  status: PreflightStatus;
  remainingSeconds: number | null;
}

export async function checkBearer(): Promise<BearerStatus> {
  const mcpPath = resolve(REPO_ROOT, '.mcp.json');
  try {
    await access(mcpPath, fsConstants.R_OK);
  } catch {
    return {
      status: { ok: false, detail: '.mcp.json not present; will be created by atelier dev' },
      remainingSeconds: null,
    };
  }
  const body = await readFile(mcpPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return {
      status: { ok: false, detail: `.mcp.json is malformed JSON: ${err instanceof Error ? err.message : String(err)}` },
      remainingSeconds: null,
    };
  }
  const mcpServers = (parsed as { mcpServers?: Record<string, unknown> }).mcpServers ?? {};
  const atelierEntry = mcpServers['atelier'] as { headers?: Record<string, string> } | undefined;
  const auth = atelierEntry?.headers?.['Authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return {
      status: { ok: false, detail: '.mcp.json has no Authorization header for atelier' },
      remainingSeconds: null,
    };
  }
  const token = auth.slice('Bearer '.length);
  const parts = token.split('.');
  if (parts.length !== 3) {
    return {
      status: { ok: false, detail: 'bearer is not a 3-segment JWT' },
      remainingSeconds: null,
    };
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as { exp?: number };
    if (typeof payload.exp !== 'number') {
      return {
        status: { ok: false, detail: "bearer payload has no exp claim" },
        remainingSeconds: null,
      };
    }
    const remaining = payload.exp - Math.floor(Date.now() / 1000);
    if (remaining <= 0) {
      return {
        status: { ok: false, detail: `bearer expired ${-remaining}s ago` },
        remainingSeconds: remaining,
      };
    }
    if (remaining < 300) {
      // Less than 5 minutes left -- treat as needing rotation.
      return {
        status: { ok: false, detail: `bearer expires in ${remaining}s (under 5 minutes; rotate)` },
        remainingSeconds: remaining,
      };
    }
    return {
      status: { ok: true, detail: `bearer valid for ${Math.floor(remaining / 60)}m` },
      remainingSeconds: remaining,
    };
  } catch (err) {
    return {
      status: { ok: false, detail: `bearer payload decode failed: ${err instanceof Error ? err.message : String(err)}` },
      remainingSeconds: null,
    };
  }
}

export async function checkEnvFile(): Promise<PreflightStatus> {
  const envPath = resolve(REPO_ROOT, 'prototype', '.env.local');
  try {
    await access(envPath, fsConstants.R_OK);
  } catch {
    return {
      ok: false,
      detail: 'prototype/.env.local missing; copy from prototype/.env.example and fill in OPENAI_API_KEY',
    };
  }
  const body = await readFile(envPath, 'utf8');
  const requiredKeys = [
    'POSTGRES_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'OPENAI_API_KEY',
  ];
  const missing = requiredKeys.filter((k) => !new RegExp(`^${k}=.+`, 'm').test(body));
  if (missing.length > 0) {
    return {
      ok: false,
      detail: `prototype/.env.local missing keys: ${missing.join(', ')}`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export async function runPreflight(): Promise<PreflightReport> {
  const [port3030, devServer, bearer, envFile] = await Promise.all([
    checkPort3030(),
    checkOurDevServer(),
    checkBearer(),
    checkEnvFile(),
  ]);
  return {
    docker: checkDocker(),
    supabaseCli: checkSupabaseCli(),
    supabaseRunning: checkSupabaseRunning(),
    port3030,
    bearer: bearer,
    devServer,
    envFile,
  };
}

export function formatReport(report: PreflightReport): string {
  const lines: string[] = [];
  const fmt = (label: string, s: PreflightStatus): string => {
    const icon = s.ok ? '[OK]  ' : '[!!]  ';
    return `  ${icon}${label.padEnd(20)} ${s.detail ?? ''}`;
  };
  lines.push('Pre-flight:');
  lines.push(fmt('docker', report.docker));
  lines.push(fmt('supabase CLI', report.supabaseCli));
  lines.push(fmt('supabase running', report.supabaseRunning));
  lines.push(fmt('port :3030', report.port3030));
  lines.push(fmt('dev server', report.devServer));
  lines.push(fmt('bearer', report.bearer.status));
  lines.push(fmt('env file', report.envFile));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Async helpers used by atelier dev for orchestration (start things)
// ---------------------------------------------------------------------------

export function startSupabase(): Promise<void> {
  return new Promise((resolveStart, rejectStart) => {
    console.log('[atelier dev] starting supabase...');
    const proc = spawn('supabase', ['start'], { stdio: 'inherit', cwd: REPO_ROOT });
    proc.on('exit', (code) => {
      if (code === 0) resolveStart();
      else rejectStart(new Error(`supabase start exited ${code}`));
    });
    proc.on('error', rejectStart);
  });
}

export function startDevServer(): { proc: ReturnType<typeof spawn>; ready: Promise<void> } {
  console.log('[atelier dev] starting prototype dev server (next dev -p 3030)...');
  const proc = spawn('npm', ['run', 'dev'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: resolve(REPO_ROOT, 'prototype'),
  });
  let stdout = '';
  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    // Surface lines so operators can see startup progress.
    process.stdout.write(text);
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk);
  });
  const ready = new Promise<void>((readyResolve, readyReject) => {
    let timer: NodeJS.Timeout | null = null;
    const onData = (chunk: Buffer) => {
      stdout += chunk.toString();
      if (/Ready in \d+ms|✓ Ready in/i.test(stdout) || /Local:\s+http:\/\/localhost:3030/i.test(stdout)) {
        if (timer) clearTimeout(timer);
        proc.stdout?.off('data', onData);
        readyResolve();
      }
    };
    proc.stdout?.on('data', onData);
    timer = setTimeout(() => {
      proc.stdout?.off('data', onData);
      readyReject(new Error('dev server did not signal ready within 60 seconds'));
    }, 60000);
    proc.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      readyReject(new Error(`dev server exited ${code} before ready`));
    });
  });
  return { proc, ready };
}
