// Real Claude Code MCP-client probe-shape smoke (M6 / promoted from M7).
//
// Catches the smoke-vs-real-client divergence class that bit M5/M6 six
// times (PRs #9, #11, #13, #14, the trim() commit, and PR #16). Every
// previous smoke mounted its own http.createServer or used the
// dispatcher in-process; none modeled the actual probe sequence Claude
// Code's MCP HTTP client does against a Next.js-routed server.
//
// What this smoke does:
//   1. Spawns `next dev` in the prototype directory as a child process
//      on a random port. Sets the env vars the route handlers need
//      (DATASTORE_URL, OIDC_ISSUER, JWT_AUDIENCE) so the substrate is
//      functional but does NOT issue a bearer or call /api/mcp -- the
//      auth + dispatcher paths are covered by transport.smoke.ts and
//      real-client.smoke.ts.
//   2. Curls every probe path Claude Code's MCP SDK is empirically
//      known to hit (from dev server logs captured during M6 entry).
//   3. Asserts each response is the EXACT shape Claude Code's SDK
//      requires:
//      - JSON-parseable bodies on every 404 (PR #16's lesson)
//      - registration_endpoint present + absolute URL on the OAuth-flow
//        discovery URL (PR #11 + PR #13's lessons)
//      - root /.well-known/oauth-authorization-server returns 404 (PR
//        #14's URL split lesson; static-bearer URL must NOT have
//        discovery findable)
//      - Path-prefixed discovery returns 200 + valid metadata
//      - Issuer URLs have no trailing whitespace (the trim() lesson)
//   4. Tears down the dev server.
//
// What this smoke does NOT do (deferred):
//   - Use @modelcontextprotocol/sdk's actual client. The probe shape
//     IS what the SDK does (verified empirically); using the SDK
//     directly would catch behavioral changes in the SDK itself. v1.x
//     hardening if the SDK churns.
//   - Drive the JSON-RPC initialize -> tools/list -> tools/call
//     sequence. transport.smoke.ts + real-client.smoke.ts cover that
//     path; this smoke focuses on the discovery shape regressions.
//   - Catch the bearer-cache durability finding (memory feedback). The
//     substrate has no role in that; it's a CC-process-state issue.
//
// Run locally (after `supabase start` + `cd prototype && npm install`):
//   DATABASE_URL=... npx tsx scripts/endpoint/__smoke__/cc-mcp-client.smoke.ts

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const PROTOTYPE_DIR = join(REPO_ROOT, 'prototype');

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------
// Dev server lifecycle
// ---------------------------------------------------------------------------

interface DevServer {
  port: number;
  baseUrl: string;
  proc: ChildProcess;
}

function pickPort(): number {
  // 4040..4999 to avoid the canonical 3030 + Next.js's 3000 fallback.
  return 4040 + Math.floor(Math.random() * 960);
}

async function startDevServer(port: number): Promise<DevServer> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const proc = spawn('npx', ['next', 'dev', '-p', String(port)], {
    cwd: PROTOTYPE_DIR,
    env: {
      ...process.env,
      // Required by the route handlers; CI has these already exported
      // via `supabase status -o env`. Local runs may need supabase up.
      ATELIER_DATASTORE_URL:
        process.env.ATELIER_DATASTORE_URL ??
        process.env.DATABASE_URL ??
        'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      ATELIER_OIDC_ISSUER:
        process.env.ATELIER_OIDC_ISSUER ?? 'http://127.0.0.1:54321/auth/v1',
      ATELIER_JWT_AUDIENCE: process.env.ATELIER_JWT_AUDIENCE ?? 'authenticated',
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Drain stdout/stderr so the child doesn't backpressure-stall. Capture
  // on-error log for debugging when the smoke fails.
  const logs: string[] = [];
  proc.stdout?.on('data', (chunk: Buffer) => {
    logs.push(chunk.toString());
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    logs.push(chunk.toString());
  });
  proc.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[cc-mcp-client.smoke] next dev exited prematurely with code ${code}`);
      console.error(logs.join(''));
    }
  });

  // 180s budget: PR #58 grew the prototype's compile surface enough that the
  // first-request `next dev` compile on Ubuntu CI runners exceeded the prior
  // 60s budget, causing this smoke to hang on every push to main (PR #58, F1
  // merge, F2 merge -- 3 confirmed). Local Mac runs finish well under 60s.
  // If waitForReady fails we MUST kill the spawned dev server: throwing here
  // before returning means no caller has the proc reference, and Node won't
  // exit while the orphan child runs -- the step appears to hang forever
  // instead of failing fast at the timeout.
  try {
    await waitForReady(`${baseUrl}/api/mcp`, 180_000);
  } catch (err) {
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill('SIGKILL');
    }, 5_000);
    throw err;
  }
  return { port, baseUrl, proc };
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(2_000),
      });
      // 405 is the GET-on-POST-only response when the route is up;
      // 401 indicates auth check fired (also up). Anything else means
      // the route isn't yet routed.
      if (res.status === 405 || res.status === 401) return;
    } catch {
      // ECONNREFUSED while server still booting; retry.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function stopDevServer(server: DevServer): Promise<void> {
  if (server.proc.exitCode !== null) return;
  return new Promise((resolve) => {
    server.proc.once('exit', () => resolve());
    server.proc.kill('SIGTERM');
    // Hard-kill after 5s if SIGTERM doesn't take.
    setTimeout(() => {
      if (server.proc.exitCode === null) server.proc.kill('SIGKILL');
    }, 5_000);
  });
}

// ---------------------------------------------------------------------------
// Probe helpers
// ---------------------------------------------------------------------------

interface ProbeResult {
  status: number;
  contentType: string | null;
  body: string;
  json: unknown | null;
  isHtml: boolean;
}

async function probe(url: string): Promise<ProbeResult> {
  const res = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(5_000),
  });
  const contentType = res.headers.get('content-type');
  const body = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    // Not JSON; leave null.
  }
  const isHtml =
    body.trimStart().startsWith('<!DOCTYPE') ||
    body.trimStart().startsWith('<html');
  return { status: res.status, contentType, body, json, isHtml };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const port = pickPort();
  console.log(`\n  Spawning next dev on port ${port} (cwd=${PROTOTYPE_DIR})...`);
  const server = await startDevServer(port);
  console.log(`  Dev server ready at ${server.baseUrl}\n`);

  try {
    // -------------------------------------------------------------------
    // [1] Static-bearer URL (/api/mcp) discovery probes — all should
    //     return JSON 404 (NOT HTML 404). PR #16's lesson.
    // -------------------------------------------------------------------
    console.log('[1] /api/mcp side: discovery probes return JSON 404 (PR #16)');
    const staticBearerProbes = [
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/api/mcp',
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/mcp',
      '/.well-known/openid-configuration',
      '/.well-known/openid-configuration/api/mcp',
    ];
    for (const path of staticBearerProbes) {
      const r = await probe(`${server.baseUrl}${path}`);
      check(`${path} returns 404`, r.status === 404, `actual: ${r.status}`);
      check(
        `${path} body is NOT HTML (PR #16)`,
        !r.isHtml,
        r.isHtml ? 'body started with <!DOCTYPE or <html' : '',
      );
      check(
        `${path} body is JSON-parseable`,
        r.json !== null,
        r.json === null ? 'JSON.parse failed' : '',
      );
    }

    // -------------------------------------------------------------------
    // [2] OAuth-flow URL (/oauth/api/mcp) discovery returns 200 with
    //     valid OAuth metadata. PR #14's URL split + PR #11/#13/trim()
    //     lessons.
    // -------------------------------------------------------------------
    console.log('\n[2] /oauth/api/mcp side: discovery returns 200 + valid metadata');
    const discRes = await probe(
      `${server.baseUrl}/.well-known/oauth-authorization-server/oauth/api/mcp`,
    );
    check('path-prefixed discovery returns 200', discRes.status === 200, `actual: ${discRes.status}`);
    check('discovery body is JSON', discRes.json !== null);
    if (discRes.json !== null) {
      const d = discRes.json as Record<string, unknown>;
      check('discovery.issuer present', typeof d.issuer === 'string');
      check(
        'discovery.issuer has no trailing whitespace (trim fix)',
        typeof d.issuer === 'string' && d.issuer === (d.issuer as string).trim(),
        typeof d.issuer === 'string' ? `actual: '${(d.issuer as string).slice(-3)}' (last 3 chars)` : '',
      );
      check('discovery.authorization_endpoint present', typeof d.authorization_endpoint === 'string');
      check('discovery.token_endpoint present', typeof d.token_endpoint === 'string');
      check('discovery.jwks_uri present', typeof d.jwks_uri === 'string');
      check(
        'discovery.registration_endpoint present (PR #11)',
        typeof d.registration_endpoint === 'string' && (d.registration_endpoint as string).length > 0,
      );
      check(
        'discovery.registration_endpoint is absolute URL (PR #13)',
        typeof d.registration_endpoint === 'string' &&
          /^https?:\/\//.test(d.registration_endpoint as string),
        typeof d.registration_endpoint === 'string' ? `actual: ${d.registration_endpoint}` : '',
      );
      // Verify all derived URLs in the metadata don't have stray whitespace
      // (trim fix downstream of the env-var-newline issue).
      for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
        const v = d[field];
        if (typeof v === 'string') {
          check(
            `discovery.${field} has no trailing/internal whitespace`,
            v === v.trim() && !v.includes('\n') && !v.includes('\r'),
            `actual: ...${v.slice(-12)}`,
          );
        }
      }
    }

    // -------------------------------------------------------------------
    // [3] /oauth/register stub returns 405 with JSON body (PR #11 +
    //     ADR-028). The 405 + documented hint tells DCR clients to
    //     use static bearer auth instead.
    // -------------------------------------------------------------------
    console.log('\n[3] /oauth/register stub: 405 + JSON body referencing ADR-028');
    for (const method of ['GET', 'POST'] as const) {
      const res = await fetch(`${server.baseUrl}/oauth/register`, { method });
      const body = await res.text();
      let json: unknown = null;
      try { json = JSON.parse(body); } catch { /* */ }
      check(`${method} /oauth/register returns 405`, res.status === 405);
      check(`${method} /oauth/register body is JSON`, json !== null);
      if (json !== null) {
        const j = json as { error?: string; hint?: string };
        check(
          `${method} /oauth/register error = registration_not_supported`,
          j.error === 'registration_not_supported',
        );
        check(
          `${method} /oauth/register hint references ADR-028`,
          typeof j.hint === 'string' && j.hint.includes('ADR-028'),
        );
      }
    }

    // -------------------------------------------------------------------
    // [4] MCP route surface: GET returns 405 with JSON-RPC error
    //     (POST-only at M2-mid).
    // -------------------------------------------------------------------
    console.log('\n[4] MCP routes: GET returns 405 with JSON-RPC error envelope');
    for (const path of ['/api/mcp', '/oauth/api/mcp'] as const) {
      const res = await fetch(`${server.baseUrl}${path}`, { method: 'GET' });
      const body = await res.text();
      let json: unknown = null;
      try { json = JSON.parse(body); } catch { /* */ }
      check(`GET ${path} returns 405`, res.status === 405);
      check(`GET ${path} body is JSON`, json !== null);
      if (json !== null) {
        const j = json as { jsonrpc?: string; error?: { code?: number } };
        check(`GET ${path} body is JSON-RPC envelope`, j.jsonrpc === '2.0');
        check(`GET ${path} carries -32601 method-not-found`, j.error?.code === -32601);
      }
    }

    // -------------------------------------------------------------------
    // [5] POST /api/mcp without bearer: returns 401 + WWW-Authenticate
    //     header per ARCH 7.9.
    // -------------------------------------------------------------------
    console.log('\n[5] POST /api/mcp no bearer: 401 + WWW-Authenticate');
    const noAuthRes = await fetch(`${server.baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    check('no-bearer returns 401', noAuthRes.status === 401);
    check(
      'no-bearer carries WWW-Authenticate: Bearer',
      (noAuthRes.headers.get('www-authenticate') ?? '').toLowerCase().includes('bearer'),
    );
  } finally {
    console.log('\n  Stopping dev server...');
    await stopDevServer(server);
    console.log('  Dev server stopped.');
  }

  console.log('');
  if (failures > 0) {
    console.log('=========================================');
    console.log(`FAIL: ${failures} assertion(s) failed`);
    console.log('=========================================');
    process.exit(1);
  }
  console.log('=========================================');
  console.log('ALL CC-MCP-CLIENT PROBE-SHAPE CHECKS PASSED');
  console.log('=========================================');
}

main().catch((err) => {
  console.error('CC-MCP-CLIENT SMOKE CRASHED:', err);
  process.exit(2);
});
