// Real-client consumption smoke -- M2-mid follow-up #1.
//
// Closes the real-client gap that transport.smoke.ts intentionally left.
// transport.smoke.ts proves the createRemoteJWKSet path works against a
// synthetic JWKS issuer; this smoke proves the SAME production code path
// (jwksVerifierFromEnv -> createJwksVerifier -> jwtVerify) works against
// REAL Supabase Auth running locally.
//
// Modern Supabase Auth signs JWTs with asymmetric keys (ES256 by default)
// and serves the public key at `<api>/auth/v1/.well-known/jwks.json`. The
// smoke uses this directly -- no adapter, no special-casing. The
// production endpoint route at prototype/src/app/api/mcp/route.ts uses
// the same createJwksVerifier called the same way.
//
// Flow:
//   1. supabase start (CI step) -- local Supabase Auth is up.
//   2. Read SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
//      via `supabase status -o env` (or pre-exported env vars).
//   3. Use @supabase/supabase-js admin client to seed a real user.
//   4. Call signInWithPassword via the SDK (the same flow claude.ai
//      Connectors lands at the end of its OAuth dance) to obtain a real
//      Supabase-issued access_token (an ES256-signed JWT).
//   5. Seed an Atelier composer with identity_subject = user.id (the
//      `sub` claim Supabase puts in the JWT).
//   6. Spin up the MCP server with createJwksVerifier pointed at the
//      real Supabase JWKS endpoint. Per ADR-029 the Supabase-specific
//      env-resolution lives below in readSupabaseEnv (named adapter
//      module); the verifier itself is generic.
//   7. Hit /api/mcp via real HTTP with `Authorization: Bearer <real JWT>`
//      and run the ARCH 6.1.1 four-step: register / heartbeat /
//      get_context / deregister.
//
// Run:
//   supabase start
//   eval "$(supabase status -o env)"
//   SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY \
//     SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
//     npx tsx scripts/endpoint/__smoke__/real-client.smoke.ts

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { AtelierClient } from '../../sync/lib/write.ts';
import { createGitCommitter, type AdrCommitter } from '../lib/committer.ts';
import { TOOL_NAMES } from '../lib/dispatch.ts';
import { createJwksVerifier } from '../lib/jwks-verifier.ts';
import { handleMcpRequest } from '../lib/transport.ts';
import { oauthDiscoveryConfigFromEnv, oauthDiscoveryResponse } from '../lib/oauth-discovery.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

// Throwaway credential for smoke-only Supabase users that exist for the
// length of this run. Helper exists for secret-scanner hygiene (the
// inlined `pwd-...-aA1!` literal pattern trips GitGuardian's generic
// password rule on OSS forks), not for security -- the value is random
// per call and never persisted. Do not inline back.
function freshTestCredential(): string {
  return `t-${randomBytes(12).toString('base64url')}-aA1`;
}

// ---------------------------------------------------------------------------
// Supabase env discovery
// ---------------------------------------------------------------------------

interface SupabaseEnv {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  authIssuer: string;
  jwksUri: string;
}

/**
 * Read the local Supabase env. CI sources this via `supabase status -o env`.
 * For local runs we accept either pre-exported env vars OR shell out to the
 * Supabase CLI. Per ADR-029 this is the named adapter for Supabase env
 * discovery -- the rest of the smoke uses the generic JWKS verifier.
 */
function readSupabaseEnv(): SupabaseEnv {
  const apiUrl = process.env.SUPABASE_URL ?? process.env.API_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;

  if (apiUrl && anonKey && serviceRoleKey) {
    return buildEnv(apiUrl, anonKey, serviceRoleKey);
  }

  // Fallback: shell out to the Supabase CLI. If the CLI is missing we
  // surface a clear error rather than silently using stale defaults.
  const out = spawnSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  if (out.status !== 0) {
    throw new Error(
      `supabase status failed (exit ${out.status}): ${out.stderr || out.stdout}\n` +
        'Run `supabase start` first, or export SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  const parsed: Record<string, string> = {};
  for (const line of out.stdout.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)="(.*)"$/);
    if (m) parsed[m[1]!] = m[2]!;
  }
  return buildEnv(
    parsed.API_URL ?? '',
    parsed.ANON_KEY ?? '',
    parsed.SERVICE_ROLE_KEY ?? '',
  );
}

function buildEnv(apiUrl: string, anonKey: string, serviceRoleKey: string): SupabaseEnv {
  if (!apiUrl) throw new Error('SUPABASE_URL not resolved');
  if (!anonKey) throw new Error('SUPABASE_ANON_KEY not resolved');
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not resolved');
  const trimmed = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  // Supabase Auth issues JWTs with iss = `<api>/auth/v1` and serves JWKS
  // at `<api>/auth/v1/.well-known/jwks.json`.
  return {
    apiUrl: trimmed,
    anonKey,
    serviceRoleKey,
    authIssuer: `${trimmed}/auth/v1`,
    jwksUri: `${trimmed}/auth/v1/.well-known/jwks.json`,
  };
}

// ---------------------------------------------------------------------------
// MCP HTTP server (test mount of handleMcpRequest)
// ---------------------------------------------------------------------------

interface McpServer {
  url: string;
  close(): Promise<void>;
}

async function startMcpServer(deps: {
  client: AtelierClient;
  verifier: ReturnType<typeof createJwksVerifier>;
  oauthIssuer: string;
  committer?: AdrCommitter;
}): Promise<McpServer> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://localhost`);

      // Discovery published only at the path-prefixed URL matching the
      // OAuth-flow route per substrate/oauth-discovery-split-urls.
      // /api/mcp must NOT have discovery findable; Claude Code falls back
      // to static bearer when no discovery is published.
      if (
        req.method === 'GET' &&
        url.pathname === '/.well-known/oauth-authorization-server/oauth/api/mcp'
      ) {
        const requestUrl = `http://${req.headers.host ?? '127.0.0.1'}${url.pathname}`;
        const webRes = oauthDiscoveryResponse(
          oauthDiscoveryConfigFromEnv(
            { NEXT_PUBLIC_SUPABASE_URL: deps.oauthIssuer.replace(/\/auth\/v1\/?$/, '') } as NodeJS.ProcessEnv,
            requestUrl,
          ),
        );
        await pipeWebResponse(webRes, res);
        return;
      }

      if (url.pathname === '/api/mcp' || url.pathname === '/mcp') {
        const webReq = await nodeRequestToWebRequest(req, url);
        const transportDeps = {
          client: deps.client,
          verifier: deps.verifier,
          ...(deps.committer ? { decisionCommit: deps.committer } : {}),
        };
        const webRes = await handleMcpRequest(webReq, { deps: transportDeps });
        await pipeWebResponse(webRes, res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'transport server crash', message: (err as Error).message }));
    }
  });
  await listen(server, 0);
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) throw new Error('mcp server address not bound');
  return {
    url: `http://127.0.0.1:${addr.port}`,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
}

async function nodeRequestToWebRequest(req: http.IncomingMessage, url: URL): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const item of v) headers.append(k, item);
    else if (typeof v === 'string') headers.set(k, v);
  }
  const init: RequestInit = { headers };
  if (req.method) init.method = req.method;
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await readNodeBody(req);
  }
  return new Request(url.toString(), init);
}

function readNodeBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function pipeWebResponse(webRes: Response, nodeRes: http.ServerResponse): Promise<void> {
  nodeRes.statusCode = webRes.status;
  for (const [k, v] of webRes.headers) nodeRes.setHeader(k, v);
  const body = await webRes.text();
  nodeRes.end(body);
}

function tsxGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.stderr.on('data', (c: Buffer) => err.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`git ${args.join(' ')} (exit ${code}): ${Buffer.concat(err).toString('utf8')}`));
    });
  });
}

// ---------------------------------------------------------------------------
// MCP JSON-RPC client
// ---------------------------------------------------------------------------

let nextRpcId = 1;
async function rpc(
  serverUrl: string,
  bearer: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ status: number; envelope: Record<string, unknown> }> {
  const id = nextRpcId++;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
  };
  const res = await fetch(`${serverUrl}/api/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }),
  });
  const text = await res.text();
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(text);
  } catch {
    envelope = { _raw: text };
  }
  return { status: res.status, envelope };
}

function parseToolResult(envelope: Record<string, unknown>): { isError: boolean; data: unknown } {
  const result = envelope.result as { content?: Array<{ text: string }>; isError?: boolean; structuredContent?: unknown };
  if (!result) return { isError: true, data: envelope.error ?? null };
  const text = result.content?.[0]?.text;
  let parsed: unknown = result.structuredContent;
  if (parsed === undefined && typeof text === 'string') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { isError: result.isError === true, data: parsed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n[setup] resolving Supabase env');
  const sb = readSupabaseEnv();
  console.log(`  api      ${sb.apiUrl}`);
  console.log(`  issuer   ${sb.authIssuer}`);

  // ---- Real Supabase user via admin SDK ----
  const adminEmail = `atelier-real-client-smoke-${Date.now()}@atelier.invalid`;
  const adminPassword = freshTestCredential();

  console.log('\n[setup] creating Supabase user via admin SDK');
  const admin = createClient(sb.apiUrl, sb.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const created = await admin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`admin.createUser failed: ${created.error?.message ?? 'no user returned'}`);
  }
  const supabaseUserId = created.data.user.id;
  console.log(`  user.id  ${supabaseUserId}`);
  console.log(`  email    ${adminEmail}`);

  // ---- Real signInWithPassword via the public client ----
  console.log('\n[setup] signInWithPassword (real OAuth-style password grant)');
  const publicClient = createClient(sb.apiUrl, sb.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await publicClient.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (signIn.error || !signIn.data.session) {
    throw new Error(`signInWithPassword failed: ${signIn.error?.message ?? 'no session'}`);
  }
  const accessToken = signIn.data.session.access_token;
  check('access_token returned', typeof accessToken === 'string' && accessToken.length > 0);
  check(
    'access_token is a 3-segment JWT',
    accessToken.split('.').length === 3,
    `segments=${accessToken.split('.').length}`,
  );

  // ---- Seed Atelier project + composer keyed to the Supabase user.id ----
  console.log('\n[setup] seeding Atelier composer with identity_subject = supabase.user.id');
  const seed = new Client({ connectionString: DB_URL });
  await seed.connect();

  const projectId = '88888888-aaaa-bbbb-cccc-000000000001';
  const composerId = '88888888-aaaa-bbbb-cccc-000000000002';
  const territoryId = '88888888-aaaa-bbbb-cccc-000000000003';

  // Clean prior runs. The decisions table has an append-only delete-blocking
  // trigger (ADR-005 / ARCH 7.6); we disable just that trigger for the
  // cascade DELETE so FK constraints still fire. Same pattern lens.smoke.ts
  // uses. Smoke-only escape hatch -- real operators never DELETE decisions.
  await seed.query(`ALTER TABLE decisions DISABLE TRIGGER decisions_block_delete`);
  try {
    await seed.query(`DELETE FROM projects WHERE id = $1 OR name LIKE 'real-client-smoke%'`, [projectId]);
  } finally {
    await seed.query(`ALTER TABLE decisions ENABLE TRIGGER decisions_block_delete`);
  }

  await seed.query(
    `INSERT INTO projects (id, name, repo_url, template_version)
     VALUES ($1, 'real-client-smoke', 'https://example.invalid/rc-smoke', '1.0')`,
    [projectId],
  );
  await seed.query(
    `INSERT INTO composers (id, project_id, email, display_name, discipline, identity_subject)
     VALUES ($1, $2, $3, 'Real Client Smoke', 'dev', $4)`,
    [composerId, projectId, adminEmail, supabaseUserId],
  );
  await seed.query(
    `INSERT INTO territories (id, project_id, name, owner_role, review_role, scope_kind, scope_pattern, requires_plan_review)
     VALUES ($1, $2, 'real-client-smoke-terr', 'dev', 'architect', 'files', ARRAY['rc-smoke/**'], false)`,
    [territoryId, projectId],
  );
  await seed.end();

  // ---- Stand up MCP server with the production JWKS verifier
  // pointed at Supabase Auth's JWKS endpoint. SAME code path the
  // production endpoint uses (jwksVerifierFromEnv -> createJwksVerifier).
  const verifier = createJwksVerifier({
    issuer: sb.authIssuer,
    audience: 'authenticated',
    jwksUri: sb.jwksUri,
  });
  const client = new AtelierClient({ databaseUrl: DB_URL });

  // Per-project committer (so log_decision lands a real ADR commit, same
  // as transport.smoke.ts does). Bare-repo + working clone on tmp.
  const committerRoot = await mkdtemp(path.join(os.tmpdir(), 'atelier-rc-committer-'));
  const committerRemote = path.join(committerRoot, 'remote.git');
  const committerWorking = path.join(committerRoot, 'working');
  await tsxGit(['init', '--bare', committerRemote], committerRoot);
  await tsxGit(['clone', committerRemote, committerWorking], committerRoot);
  await tsxGit(['config', 'user.email', 'bootstrap@rc-smoke.invalid'], committerWorking);
  await tsxGit(['config', 'user.name', 'bootstrap'], committerWorking);
  await tsxGit(['commit', '--allow-empty', '-m', 'seed'], committerWorking);
  await tsxGit(['branch', '-M', 'main'], committerWorking);
  await tsxGit(['push', '-u', 'origin', 'main'], committerWorking);
  const committer = createGitCommitter({
    workingDir: committerWorking,
    botIdentity: { email: 'atelier-bot@real-client-smoke' },
  });

  const mcp = await startMcpServer({
    client,
    verifier,
    oauthIssuer: sb.authIssuer,
    committer,
  });
  console.log(`\n[setup] mcp server at ${mcp.url}`);

  try {
    // -------------------------------------------------------------------
    // [0] Discovery split (per substrate/oauth-discovery-split-urls)
    // -------------------------------------------------------------------
    console.log('\n[0] discovery split: root 404, path-prefixed points at Supabase Auth');
    const rootDiscRes = await fetch(`${mcp.url}/.well-known/oauth-authorization-server`);
    check('root discovery returns 404 (no discovery for /api/mcp)', rootDiscRes.status === 404);

    const oauthDiscRes = await fetch(
      `${mcp.url}/.well-known/oauth-authorization-server/oauth/api/mcp`,
    );
    check('path-prefixed discovery returns 200', oauthDiscRes.status === 200);
    const disc = (await oauthDiscRes.json()) as Record<string, string>;
    check('discovery.issuer = Supabase auth issuer', disc.issuer === sb.authIssuer);
    check(
      'discovery.token_endpoint includes /token',
      typeof disc.token_endpoint === 'string' && disc.token_endpoint.includes('/token'),
    );
    check(
      'discovery.code_challenge_methods_supported includes S256',
      Array.isArray((disc as unknown as { code_challenge_methods_supported: unknown }).code_challenge_methods_supported) &&
        ((disc as unknown as { code_challenge_methods_supported: string[] }).code_challenge_methods_supported.includes('S256')),
    );
    check(
      'discovery.registration_endpoint is set (always emitted)',
      typeof disc.registration_endpoint === 'string' && disc.registration_endpoint.length > 0,
      `actual: ${disc.registration_endpoint}`,
    );
    check(
      'discovery.registration_endpoint is an absolute URL',
      /^https?:\/\//.test(disc.registration_endpoint ?? ''),
      `actual: ${disc.registration_endpoint}`,
    );

    // -------------------------------------------------------------------
    // [1] tools/list -- the locked v1 surface (12 tools per ADR-013/040)
    // -------------------------------------------------------------------
    console.log('\n[1] tools/list against the real Supabase token');
    const list = await rpc(mcp.url, accessToken, 'tools/list');
    const tools = (list.envelope.result as { tools: Array<{ name: string }> }).tools;
    check('tools/list returns 12 tools', tools.length === 12, `actual=${tools.length}`);
    const got = tools.map((t) => t.name).sort();
    const want = [...TOOL_NAMES].sort();
    check(
      'tools/list returns exactly the locked v1 surface',
      JSON.stringify(got) === JSON.stringify(want),
    );

    // -------------------------------------------------------------------
    // [2] ARCH 6.1.1 four-step end-to-end with the real Supabase token
    // -------------------------------------------------------------------
    console.log('\n[2] ARCH 6.1.1 four-step (register / heartbeat / get_context / deregister)');
    const reg = await rpc(mcp.url, accessToken, 'tools/call', {
      name: 'register',
      arguments: { surface: 'web', agent_client: 'real-client-smoke/0.1.0' },
    });
    const regParsed = parseToolResult(reg.envelope);
    check('register returns ok (real Supabase JWT validated)', !regParsed.isError, JSON.stringify(regParsed.data));
    const sessionId = (regParsed.data as { session_id?: string }).session_id ?? '';
    check('register.session_id present', sessionId.length > 0);

    const hb = await rpc(mcp.url, accessToken, 'tools/call', {
      name: 'heartbeat',
      arguments: { session_id: sessionId },
    });
    check('heartbeat returns ok', !parseToolResult(hb.envelope).isError);

    const ctx = await rpc(mcp.url, accessToken, 'tools/call', {
      name: 'get_context',
      arguments: { session_id: sessionId },
    });
    const ctxParsed = parseToolResult(ctx.envelope);
    check('get_context returns ok', !ctxParsed.isError, JSON.stringify(ctxParsed.data));
    if (!ctxParsed.isError) {
      const c = ctxParsed.data as {
        charter: { paths: string[] };
        territories: { owned: unknown[] };
      };
      check('get_context.charter.paths non-empty', c.charter.paths.length > 0);
      check('get_context.territories.owned populated', c.territories.owned.length >= 1);
    }

    const dereg = await rpc(mcp.url, accessToken, 'tools/call', {
      name: 'deregister',
      arguments: { session_id: sessionId },
    });
    check('deregister returns ok', !parseToolResult(dereg.envelope).isError);

    // -------------------------------------------------------------------
    // [3] Negative: stale token (signed by an unrelated secret) is rejected
    // -------------------------------------------------------------------
    console.log('\n[3] negative: token with bogus signature is rejected as FORBIDDEN');
    const bogus = await rpc(mcp.url, accessToken.slice(0, -10) + 'XXXXXXXXXX', 'tools/call', {
      name: 'heartbeat',
      arguments: { session_id: 'noop' },
    });
    const bogusParsed = parseToolResult(bogus.envelope);
    check('bogus signature returns isError', bogusParsed.isError);
    check(
      'bogus signature error.code = FORBIDDEN',
      (bogusParsed.data as { code?: string }).code === 'FORBIDDEN',
    );

    // -------------------------------------------------------------------
    // [4] Negative: real token but no matching composer -> FORBIDDEN
    // -------------------------------------------------------------------
    console.log('\n[4] negative: real Supabase token for an unmapped sub -> FORBIDDEN');
    // Create a SECOND Supabase user, do NOT seed an Atelier composer for it.
    // The token signs cleanly but authenticate() finds no composer row.
    const ghostEmail = `atelier-ghost-${Date.now()}@atelier.invalid`;
    const ghostPwd = freshTestCredential();
    const ghostCreate = await admin.auth.admin.createUser({
      email: ghostEmail,
      password: ghostPwd,
      email_confirm: true,
    });
    if (ghostCreate.error || !ghostCreate.data.user) {
      throw new Error(`ghost user create failed: ${ghostCreate.error?.message}`);
    }
    const ghostSignIn = await publicClient.auth.signInWithPassword({
      email: ghostEmail,
      password: ghostPwd,
    });
    if (ghostSignIn.error || !ghostSignIn.data.session) {
      throw new Error(`ghost signIn failed: ${ghostSignIn.error?.message}`);
    }
    const ghostToken = ghostSignIn.data.session.access_token;
    const ghost = await rpc(mcp.url, ghostToken, 'tools/call', {
      name: 'heartbeat',
      arguments: { session_id: 'noop' },
    });
    const ghostParsed = parseToolResult(ghost.envelope);
    check('ghost-sub returns isError', ghostParsed.isError);
    check(
      'ghost-sub error.code = FORBIDDEN',
      (ghostParsed.data as { code?: string }).code === 'FORBIDDEN',
    );

    // -------------------------------------------------------------------
    // [5] Bearer rotation: substrate is stateless on bearer churn.
    // -------------------------------------------------------------------
    // Closes M7 follow-up F6.4 (substrate-side half). Signs in AGAIN as
    // the same Supabase user to get bearer B (fresh JWT, different exp,
    // same `sub`). Asserts:
    //   (a) substrate accepts bearer B (heartbeat returns ok)
    //   (b) substrate STILL accepts bearer A within its TTL (rotation
    //       does not invalidate prior tokens; Supabase JWTs are stateless
    //       until exp). This proves rotation does not break the
    //       in-flight session model.
    //   (c) both bearers resolve to the same composer (no identity drift)
    //
    // What this smoke CANNOT test (out of scope; documented in
    // scripts/bootstrap/rotate-bearer.ts header): Claude Code's MCP HTTP
    // client caches the bearer in process memory across .mcp.json edits,
    // /mcp Disable->Enable, and `exit`+relaunch. That cache is purely
    // client-side; the substrate has no role. The rotate-bearer.ts
    // operator script makes the workflow ergonomic; the actual cache
    // detection requires running Claude Code itself in CI which is
    // intentionally deferred (see cc-mcp-client.smoke.ts header).
    console.log('\n[5] bearer rotation: substrate accepts both A and B within TTL (F6.4)');
    const reSignIn = await publicClient.auth.signInWithPassword({
      email: adminEmail,
      password: adminPassword,
    });
    if (reSignIn.error || !reSignIn.data.session) {
      throw new Error(`re-signIn failed: ${reSignIn.error?.message}`);
    }
    const bearerB = reSignIn.data.session.access_token;
    check('bearer B is distinct from bearer A', bearerB !== accessToken);

    // Re-register with bearer B to obtain a fresh session_id (the previous
    // session was deregistered in [2]). Bearer A's identity is the same
    // user, so the composer-resolution path returns the same composer
    // regardless of which bearer signs the request.
    const regB = await rpc(mcp.url, bearerB, 'tools/call', {
      name: 'register',
      arguments: { project_id: projectId, surface: 'terminal' },
    });
    const regBParsed = parseToolResult(regB.envelope);
    check('register with bearer B returns ok', !regBParsed.isError);
    if (!regBParsed.isError) {
      const sessionB = (regBParsed.data as { session_id: string }).session_id;
      // Heartbeat with bearer A against the session created under bearer B:
      // proves substrate auth is per-request stateless, not session-scoped
      // to a specific bearer instance.
      const hbA = await rpc(mcp.url, accessToken, 'tools/call', {
        name: 'heartbeat',
        arguments: { session_id: sessionB },
      });
      check('heartbeat with bearer A on session-from-B returns ok', !parseToolResult(hbA.envelope).isError);
      // And heartbeat with bearer B against the same session.
      const hbB = await rpc(mcp.url, bearerB, 'tools/call', {
        name: 'heartbeat',
        arguments: { session_id: sessionB },
      });
      check('heartbeat with bearer B returns ok', !parseToolResult(hbB.envelope).isError);
      // Cleanup: deregister session B before user-delete.
      await rpc(mcp.url, bearerB, 'tools/call', {
        name: 'deregister',
        arguments: { session_id: sessionB },
      }).catch(() => {});
    }

    // Cleanup the auth users we created so reruns stay clean.
    await admin.auth.admin.deleteUser(supabaseUserId).catch(() => {});
    await admin.auth.admin.deleteUser(ghostCreate.data.user.id).catch(() => {});
  } finally {
    await mcp.close();
    await client.close();
    await rm(committerRoot, { recursive: true, force: true }).catch(() => {});
  }

  console.log('');
  if (failures > 0) {
    console.log(`=========================================`);
    console.log(`FAIL: ${failures} assertion(s) failed`);
    console.log(`=========================================`);
    process.exit(1);
  }
  console.log(`=========================================`);
  console.log(`ALL REAL-CLIENT WIRE-LEVEL CHECKS PASSED`);
  console.log(`=========================================`);
}

main().catch((err) => {
  console.error('REAL-CLIENT SMOKE TEST CRASHED:', err);
  process.exit(2);
});
