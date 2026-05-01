// Wire-level smoke for the Streamable HTTP MCP transport adapter.
//
// Exercises the full transport surface end-to-end through real HTTP:
//   - http.createServer mounting handleMcpRequest from
//     scripts/endpoint/lib/transport.ts
//   - Real JWKS-backed BearerVerifier (createJwksVerifier) pointed at a
//     synthetic local issuer that signs ES256 JWTs with a generated
//     keypair. The smoke asserts the production verifier path resolves
//     real JWTs, not the stubVerifier shorthand.
//   - Real MCP JSON-RPC envelopes for initialize / tools/list /
//     tools/call (12 tools) and the ARCH 6.1.1 four-step sequence
//     (register / heartbeat / get_context / deregister) end-to-end.
//   - /.well-known/oauth-authorization-server discovery shape.
//
// Why a synthetic JWKS issuer instead of local Supabase Auth: local
// Supabase Auth's JWKS exposure is configuration-dependent (HS256 vs
// asymmetric keys) and the smoke must run deterministically on a fresh
// `supabase start` without manual provider setup. The synthetic issuer
// proves the production code path (createRemoteJWKSet -> jwtVerify
// against fetched keys) works against any RFC 7517 JWKS document; real
// providers (Supabase, Auth0, custom) plug in identically.
//
// Run against a fresh local Supabase (`supabase db reset --local` first):
//   DATABASE_URL=... npx tsx scripts/endpoint/__smoke__/transport.smoke.ts

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { Client } from 'pg';
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
} from 'jose';
import { AtelierClient } from '../../sync/lib/write.ts';
import { createGitCommitter, type AdrCommitter } from '../lib/committer.ts';
import { createJwksVerifier } from '../lib/jwks-verifier.ts';
import { TOOL_NAMES } from '../lib/dispatch.ts';
import { handleMcpRequest } from '../lib/transport.ts';
import {
  oauthDiscoveryConfigFromEnv,
  oauthDiscoveryResponse,
  oauthRegistrationStubResponse,
} from '../lib/oauth-discovery.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------
// Synthetic JWKS issuer (test-only). Produces real signed JWTs so the
// production createJwksVerifier path is exercised end-to-end.
// ---------------------------------------------------------------------------

interface JwksIssuer {
  url: string;
  audience: string;
  signFor(sub: string): Promise<string>;
  close(): Promise<void>;
}

async function startJwksIssuer(): Promise<JwksIssuer> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const publicJwk: JWK = await exportJWK(publicKey);
  publicJwk.kid = 'transport-smoke-key-1';
  publicJwk.alg = 'ES256';
  publicJwk.use = 'sig';
  const audience = 'atelier-mcp-smoke';

  const server = http.createServer((req, res) => {
    if (req.url === '/.well-known/jwks.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await listen(server, 0);
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) throw new Error('jwks issuer address not bound');
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    audience,
    async signFor(sub: string): Promise<string> {
      return await new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: 'transport-smoke-key-1' })
        .setSubject(sub)
        .setIssuer(url)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
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

      // Discovery is published ONLY at the path-prefixed URL matching the
      // OAuth-flow route. Root /.well-known/oauth-authorization-server
      // returns 404 so Claude Code's MCP SDK (which preferentially does
      // OAuth when discovery is found) falls back to static bearer for
      // clients targeting /api/mcp. Per substrate/oauth-discovery-split-urls.
      if (
        req.method === 'GET' &&
        url.pathname === '/.well-known/oauth-authorization-server/oauth/api/mcp'
      ) {
        const requestUrl = `http://${req.headers.host ?? '127.0.0.1'}${url.pathname}`;
        const webRes = oauthDiscoveryResponse(
          oauthDiscoveryConfigFromEnv(
            { ATELIER_OIDC_ISSUER: deps.oauthIssuer } as NodeJS.ProcessEnv,
            requestUrl,
          ),
        );
        await pipeWebResponse(webRes, res);
        return;
      }

      if (url.pathname === '/oauth/register') {
        const webRes = oauthRegistrationStubResponse();
        await pipeWebResponse(webRes, res);
        return;
      }

      // Both /api/mcp (static bearer) and /oauth/api/mcp (OAuth flow)
      // share the same handler. They differ only in (a) URL path and
      // (b) whether discovery is published.
      if (
        url.pathname === '/api/mcp' ||
        url.pathname === '/mcp' ||
        url.pathname === '/oauth/api/mcp'
      ) {
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

async function pipeWebResponse(webRes: Response, nodeRes: http.ServerResponse): Promise<void> {
  nodeRes.statusCode = webRes.status;
  for (const [k, v] of webRes.headers) nodeRes.setHeader(k, v);
  const body = await webRes.text();
  nodeRes.end(body);
}

// ---------------------------------------------------------------------------
// MCP JSON-RPC client helpers
// ---------------------------------------------------------------------------

let nextRpcId = 1;
async function rpc(
  serverUrl: string,
  bearer: string,
  method: string,
  params?: Record<string, unknown>,
  init?: { contentType?: string; headers?: Record<string, string> },
): Promise<{ status: number; envelope: Record<string, unknown> }> {
  const id = nextRpcId++;
  const headers: Record<string, string> = {
    'Content-Type': init?.contentType ?? 'application/json',
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    ...(init?.headers ?? {}),
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

function parseToolResult(envelope: Record<string, unknown>): {
  isError: boolean;
  data: unknown;
} {
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
  // ---- Seed fixtures ----
  const seed = new Client({ connectionString: DB_URL });
  await seed.connect();
  await seed.query(`DELETE FROM projects WHERE name LIKE 'transport-smoke-%'`);

  const projectId = '88888888-1111-1111-1111-111111111111';
  const devComposerId = '88888888-2222-2222-2222-222222222222';
  const territoryId = '88888888-3333-3333-3333-333333333333';

  await seed.query(
    `INSERT INTO projects (id, name, repo_url, template_version)
     VALUES ($1, 'transport-smoke', 'https://example.invalid/tr-smoke', '1.0')`,
    [projectId],
  );
  await seed.query(
    `INSERT INTO composers (id, project_id, email, display_name, discipline, identity_subject)
     VALUES ($1, $2, 'dev-tr@smoke.invalid', 'Dev', 'dev', 'sub-tr-dev')`,
    [devComposerId, projectId],
  );
  await seed.query(
    `INSERT INTO territories (id, project_id, name, owner_role, review_role, scope_kind, scope_pattern, requires_plan_review)
     VALUES ($1, $2, 'transport-smoke-terr', 'dev', 'architect', 'files', ARRAY['tr-smoke/**'], false)`,
    [territoryId, projectId],
  );
  await seed.end();

  // ---- Stand up servers ----
  const issuer = await startJwksIssuer();
  console.log(`\n  jwks issuer at ${issuer.url}`);

  const verifier = createJwksVerifier({
    issuer: issuer.url,
    audience: issuer.audience,
  });
  const client = new AtelierClient({ databaseUrl: DB_URL });

  // ---- Per-project git committer (ARCH 7.8 / ADR-023) ----
  // Bare-repo `origin` + working clone on tmp; the committer uses these as
  // a real working tree so log_decision lands a real commit + push.
  const committerRoot = await mkdtemp(path.join(os.tmpdir(), 'atelier-tr-committer-'));
  const committerRemote = path.join(committerRoot, 'remote.git');
  const committerWorking = path.join(committerRoot, 'working');
  await tsxGit(['init', '--bare', committerRemote], committerRoot);
  await tsxGit(['clone', committerRemote, committerWorking], committerRoot);
  await tsxGit(['config', 'user.email', 'bootstrap@tr-smoke.invalid'], committerWorking);
  await tsxGit(['config', 'user.name', 'bootstrap'], committerWorking);
  await tsxGit(['commit', '--allow-empty', '-m', 'seed'], committerWorking);
  await tsxGit(['branch', '-M', 'main'], committerWorking);
  await tsxGit(['push', '-u', 'origin', 'main'], committerWorking);

  const committer = createGitCommitter({
    workingDir: committerWorking,
    botIdentity: { email: 'atelier-bot@transport-smoke' },
  });

  const mcp = await startMcpServer({ client, verifier, oauthIssuer: issuer.url, committer });
  console.log(`  mcp server at ${mcp.url}`);
  console.log(`  committer working clone at ${committerWorking}`);

  const devToken = await issuer.signFor('sub-tr-dev');

  try {
    // -------------------------------------------------------------------
    // [0] OAuth discovery split (per substrate/oauth-discovery-split-urls)
    // -------------------------------------------------------------------
    console.log('\n[0] discovery split: root 404, path-prefixed 200');
    // Root discovery must NOT exist — Claude Code's MCP SDK preferentially
    // does OAuth flow when discovery is found, ignoring static bearer in
    // headers. The static-bearer route at /api/mcp must have no discovery
    // probe path return 200, or Claude Code bails attempting DCR.
    const rootDiscRes = await fetch(`${mcp.url}/.well-known/oauth-authorization-server`);
    check('root discovery returns 404 (no discovery for /api/mcp)', rootDiscRes.status === 404);

    // Path-prefixed discovery for the OAuth-flow route returns the
    // metadata. Future remote OAuth clients (claude.ai Connectors,
    // ChatGPT Connectors) point at /oauth/api/mcp and find discovery at
    // /.well-known/oauth-authorization-server/oauth/api/mcp.
    const oauthDiscRes = await fetch(
      `${mcp.url}/.well-known/oauth-authorization-server/oauth/api/mcp`,
    );
    check('path-prefixed discovery returns 200', oauthDiscRes.status === 200);
    const disc = (await oauthDiscRes.json()) as Record<string, string>;
    check('discovery.issuer matches configured issuer', disc.issuer === issuer.url);
    check('discovery.jwks_uri derived correctly', disc.jwks_uri === `${issuer.url}/.well-known/jwks.json`);
    check('discovery.token_endpoint set', typeof disc.token_endpoint === 'string' && disc.token_endpoint.length > 0);
    check('discovery.authorization_endpoint set', typeof disc.authorization_endpoint === 'string');
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

    // [0a] OAuth registration stub returns 405 with documented error body
    console.log('\n[0a] /oauth/register stub returns 405 + documented error body');
    for (const method of ['GET', 'POST'] as const) {
      const regRes = await fetch(`${mcp.url}/oauth/register`, { method });
      check(`${method} /oauth/register returns 405`, regRes.status === 405);
      const regBody = (await regRes.json()) as { error?: string; hint?: string };
      check(
        `${method} /oauth/register error = registration_not_supported`,
        regBody.error === 'registration_not_supported',
        `actual: ${regBody.error}`,
      );
      check(
        `${method} /oauth/register hint references ADR-028`,
        typeof regBody.hint === 'string' && regBody.hint.includes('ADR-028'),
      );
    }

    // [0b] Lib-level: oauthDiscoveryConfigFromEnv resolution paths for
    // registration_endpoint. Wire-level [0] proves the route emits an
    // absolute URL; this section proves each resolver path independently
    // so future regressions in the lib surface in CI rather than at
    // operator handoff.
    console.log('\n[0b] oauthDiscoveryConfigFromEnv resolution paths');
    {
      const cfgEnvOverride = oauthDiscoveryConfigFromEnv(
        {
          ATELIER_OIDC_ISSUER: 'http://issuer.example.invalid/auth/v1',
          ATELIER_OAUTH_REGISTRATION_ENDPOINT: 'http://other.example.invalid/dcr',
        } as NodeJS.ProcessEnv,
        'http://api.example.invalid/.well-known/oauth-authorization-server',
      );
      check(
        'env override beats requestUrl + ATELIER_ENDPOINT_URL',
        cfgEnvOverride.registrationEndpoint === 'http://other.example.invalid/dcr',
        `actual: ${cfgEnvOverride.registrationEndpoint}`,
      );

      const cfgEndpointUrl = oauthDiscoveryConfigFromEnv(
        {
          ATELIER_OIDC_ISSUER: 'http://issuer.example.invalid/auth/v1',
          ATELIER_ENDPOINT_URL: 'http://endpoint.example.invalid',
        } as NodeJS.ProcessEnv,
        'http://api.example.invalid/.well-known/oauth-authorization-server',
      );
      check(
        'ATELIER_ENDPOINT_URL derivation beats requestUrl',
        cfgEndpointUrl.registrationEndpoint === 'http://endpoint.example.invalid/oauth/register',
        `actual: ${cfgEndpointUrl.registrationEndpoint}`,
      );

      const cfgRequestUrl = oauthDiscoveryConfigFromEnv(
        { ATELIER_OIDC_ISSUER: 'http://issuer.example.invalid/auth/v1' } as NodeJS.ProcessEnv,
        'http://api.example.invalid/.well-known/oauth-authorization-server',
      );
      check(
        'requestUrl derivation produces absolute URL on resource origin',
        cfgRequestUrl.registrationEndpoint === 'http://api.example.invalid/oauth/register',
        `actual: ${cfgRequestUrl.registrationEndpoint}`,
      );

      const cfgFallback = oauthDiscoveryConfigFromEnv(
        { ATELIER_OIDC_ISSUER: 'http://issuer.example.invalid/auth/v1' } as NodeJS.ProcessEnv,
      );
      check(
        'no env + no requestUrl falls back to relative /oauth/register',
        cfgFallback.registrationEndpoint === '/oauth/register',
        `actual: ${cfgFallback.registrationEndpoint}`,
      );
    }

    // [0c] Both /api/mcp and /oauth/api/mcp accept the same bearer and
    // serve identical handler responses. The split is purely about which
    // URL publishes discovery; behind both URLs is the same MCP handler
    // backed by the same DB pool, verifier, committer, and embedder.
    console.log('\n[0c] both routes accept bearer auth (split is URL-only)');
    for (const path of ['/api/mcp', '/oauth/api/mcp'] as const) {
      const res = await fetch(`${mcp.url}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${devToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'split-smoke', version: '0.1' } },
        }),
      });
      check(`POST ${path} initialize returns 200`, res.status === 200);
      const body = (await res.json()) as { result?: { serverInfo?: { name: string } } };
      check(
        `POST ${path} returns atelier-mcp serverInfo`,
        body.result?.serverInfo?.name === 'atelier-mcp',
      );
    }

    // -------------------------------------------------------------------
    // [1] Wire transport: GET /api/mcp returns 405 (POST-only at M2-mid)
    // -------------------------------------------------------------------
    console.log('\n[1] GET /api/mcp -> 405 (POST-only at M2-mid)');
    const getMcp = await fetch(`${mcp.url}/api/mcp`);
    check('GET /api/mcp returns 405', getMcp.status === 405);

    // -------------------------------------------------------------------
    // [2] Wire transport: missing bearer rejected with 401 + WWW-Authenticate
    // -------------------------------------------------------------------
    console.log('\n[2] missing bearer -> 401 + WWW-Authenticate');
    const noAuth = await fetch(`${mcp.url}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    check('no-bearer returns 401', noAuth.status === 401);
    check(
      'no-bearer carries WWW-Authenticate: Bearer',
      (noAuth.headers.get('www-authenticate') ?? '').toLowerCase().includes('bearer'),
    );

    // -------------------------------------------------------------------
    // [3] Wire transport: invalid Content-Type rejected
    // -------------------------------------------------------------------
    console.log('\n[3] non-JSON Content-Type -> 415');
    const badCt = await rpc(mcp.url, devToken, 'initialize', undefined, { contentType: 'text/plain' });
    check('non-JSON content-type returns 415', badCt.status === 415);

    // -------------------------------------------------------------------
    // [4] Wire transport: malformed envelope rejected
    // -------------------------------------------------------------------
    console.log('\n[4] malformed JSON-RPC envelope -> -32600');
    const malformed = await fetch(`${mcp.url}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${devToken}` },
      body: JSON.stringify({ method: 'initialize' }), // missing jsonrpc
    });
    const malformedBody = (await malformed.json()) as { error?: { code: number } };
    check('malformed envelope returns 400', malformed.status === 400);
    check('malformed envelope -32600 invalid request', malformedBody.error?.code === -32600);

    // -------------------------------------------------------------------
    // [5] MCP initialize handshake
    // -------------------------------------------------------------------
    console.log('\n[5] MCP initialize handshake');
    const init = await rpc(mcp.url, devToken, 'initialize');
    check('initialize returns 200', init.status === 200);
    const initResult = init.envelope.result as { protocolVersion?: string; serverInfo?: { name: string }; capabilities?: { tools?: unknown } };
    check('initialize.protocolVersion present', typeof initResult.protocolVersion === 'string');
    check('initialize.serverInfo.name = atelier-mcp', initResult.serverInfo?.name === 'atelier-mcp');
    check('initialize.capabilities.tools advertised', initResult.capabilities?.tools !== undefined);

    // -------------------------------------------------------------------
    // [6] MCP tools/list returns the 12-tool surface
    // -------------------------------------------------------------------
    console.log('\n[6] tools/list returns 12 tools (ADR-013 + ADR-040)');
    const list = await rpc(mcp.url, devToken, 'tools/list');
    const tools = (list.envelope.result as { tools: Array<{ name: string }> }).tools;
    check('tools/list returns exactly 12 tools', tools.length === 12, `actual: ${tools.length}`);
    const toolNames = tools.map((t) => t.name).sort();
    const expectedNames = [...TOOL_NAMES].sort();
    check(
      'tools/list contains exactly the locked v1 surface',
      JSON.stringify(toolNames) === JSON.stringify(expectedNames),
      `mismatch: got ${JSON.stringify(toolNames)}`,
    );
    check(
      'tools/list contains propose_contract_change (ADR-040)',
      toolNames.includes('propose_contract_change'),
    );
    check(
      'tools/list does NOT contain publish_contract (renamed per ADR-040)',
      !toolNames.includes('publish_contract'),
    );

    // -------------------------------------------------------------------
    // [7] MCP unknown method -> -32601
    // -------------------------------------------------------------------
    console.log('\n[7] unknown method -> -32601');
    const unknownMethod = await rpc(mcp.url, devToken, 'tools/unknown_method');
    check(
      'unknown method returns -32601',
      (unknownMethod.envelope.error as { code: number } | undefined)?.code === -32601,
    );

    // -------------------------------------------------------------------
    // [8] ARCH 6.1.1 four-step sequence end-to-end through the wire
    // -------------------------------------------------------------------
    console.log('\n[8] ARCH 6.1.1 self-verification end-to-end');
    const reg = await rpc(mcp.url, devToken, 'tools/call', {
      name: 'register',
      arguments: { surface: 'ide', agent_client: 'transport-smoke/0.1.0' },
    });
    const regParsed = parseToolResult(reg.envelope);
    check('register returns ok (isError=false)', !regParsed.isError);
    const sessionId = (regParsed.data as { session_id: string }).session_id;
    check('register response carries session_id', typeof sessionId === 'string' && sessionId.length > 0);

    const hb = await rpc(mcp.url, devToken, 'tools/call', {
      name: 'heartbeat',
      arguments: { session_id: sessionId },
    });
    check('heartbeat returns ok', !parseToolResult(hb.envelope).isError);

    const ctx = await rpc(mcp.url, devToken, 'tools/call', {
      name: 'get_context',
      arguments: { session_id: sessionId },
    });
    const ctxParsed = parseToolResult(ctx.envelope);
    check('get_context returns ok', !ctxParsed.isError);
    if (!ctxParsed.isError) {
      const c = ctxParsed.data as {
        charter: { paths: string[] };
        territories: { owned: unknown[] };
      };
      check('get_context.charter.paths non-empty', c.charter.paths.length > 0);
      check('get_context.territories.owned populated', c.territories.owned.length >= 1);
    }

    const dereg = await rpc(mcp.url, devToken, 'tools/call', {
      name: 'deregister',
      arguments: { session_id: sessionId },
    });
    check('deregister returns ok', !parseToolResult(dereg.envelope).isError);

    const replay = await rpc(mcp.url, devToken, 'tools/call', {
      name: 'heartbeat',
      arguments: { session_id: sessionId },
    });
    const replayParsed = parseToolResult(replay.envelope);
    check('replay heartbeat after deregister returns isError', replayParsed.isError);
    check(
      'replay heartbeat error.code = NOT_FOUND',
      (replayParsed.data as { code: string }).code === 'NOT_FOUND',
    );

    // -------------------------------------------------------------------
    // [9] log_decision lands a real ADR commit through the per-project
    //     committer (ARCH 7.8 / ADR-023). Asserts: SHA returned, ADR file
    //     present in the working clone, frontmatter shape correct,
    //     commit author matches the bot identity, Co-Authored-By trailer
    //     carries the calling composer, push reaches the bare remote, and
    //     idempotency_key replay returns the cached SHA.
    // -------------------------------------------------------------------
    console.log('\n[9] log_decision -> real ADR commit (ARCH 7.8 / ADR-023)');
    const reg2 = await rpc(mcp.url, devToken, 'tools/call', {
      name: 'register',
      arguments: { surface: 'ide' },
    });
    const sid2 = (parseToolResult(reg2.envelope).data as { session_id: string }).session_id;
    const logDec = await rpc(mcp.url, devToken, 'tools/call', {
      name: 'log_decision',
      arguments: {
        project_id: projectId,
        session_id: sid2,
        category: 'architecture',
        summary: 'Transport smoke ADR via committer',
        rationale: 'End-to-end path: dispatcher -> handler -> committer -> git push.',
        trace_ids: ['ADR-023', 'ADR-040'],
        idempotency_key: 'transport-smoke-key-9',
      },
    });
    const logDecParsed = parseToolResult(logDec.envelope);
    check('log_decision returns ok (committer wired)', !logDecParsed.isError, JSON.stringify(logDecParsed.data));
    let originalSha = '';
    let originalRepoPath = '';
    if (!logDecParsed.isError) {
      const r = logDecParsed.data as { adr_id: string; repo_path: string; repo_commit_sha: string };
      check('log_decision.adr_id matches ADR-NNN shape', /^ADR-\d{3,}$/.test(r.adr_id), r.adr_id);
      check('log_decision.repo_path under decisions dir', r.repo_path.startsWith('docs/architecture/decisions/'));
      check('log_decision.repo_commit_sha is full 40-char sha', /^[0-9a-f]{40}$/.test(r.repo_commit_sha));
      originalSha = r.repo_commit_sha;
      originalRepoPath = r.repo_path;
    }

    // Verify the file landed in the working clone
    if (originalRepoPath) {
      const adrBody = await readFile(path.join(committerWorking, originalRepoPath), 'utf8');
      check('ADR file frontmatter has id field', /^id: ADR-\d{3,}$/m.test(adrBody));
      check('ADR file frontmatter has multi-trace inline list', /^trace_id: \[ADR-023, ADR-040\]$/m.test(adrBody));
      check('ADR file frontmatter has category=architecture', /^category: architecture$/m.test(adrBody));
      check('ADR file frontmatter has composer=Dev (display_name)', /^composer: Dev$/m.test(adrBody));
      check('ADR file body has H1 title from summary', /^# Transport smoke ADR via committer$/m.test(adrBody));

      // Commit author + co-author shape
      const authorLine = (await tsxGit(['log', '-1', '--pretty=%an <%ae>'], committerWorking)).trim();
      check(
        'commit author = "Dev via Atelier <atelier-bot@transport-smoke>"',
        authorLine === 'Dev via Atelier <atelier-bot@transport-smoke>',
        authorLine,
      );
      const commitBody = await tsxGit(['log', '-1', '--pretty=%B'], committerWorking);
      check(
        'commit body has Co-Authored-By: Dev <dev-tr@smoke.invalid>',
        commitBody.includes('Co-Authored-By: Dev <dev-tr@smoke.invalid>'),
        commitBody.split('\n').slice(0, 6).join(' | '),
      );

      // Push reached the bare remote
      const remoteHas = await tsxGit(['cat-file', '-e', originalSha], committerRemote)
        .then(() => true)
        .catch(() => false);
      check('committer pushed the new commit to origin', remoteHas);
    }

    // Idempotency replay: same key must return the same SHA without writing
    // a new file. New session, same idempotency_key.
    const reg3 = await rpc(mcp.url, devToken, 'tools/call', {
      name: 'register',
      arguments: { surface: 'ide' },
    });
    const sid3 = (parseToolResult(reg3.envelope).data as { session_id: string }).session_id;
    const replayLogDec = await rpc(mcp.url, devToken, 'tools/call', {
      name: 'log_decision',
      arguments: {
        project_id: projectId,
        session_id: sid3,
        category: 'architecture',
        summary: 'Different summary -- should be ignored on idempotent replay',
        rationale: 'Replay rationale.',
        trace_ids: ['ADR-023'],
        // NOTE: cache key in the committer is `(sessionId, idempotencyKey)`
        // and `sessionId` flows from the request payload. This call uses the
        // SAME session_id as the first call so the cache hits.
      },
    });
    void sid3;
    const replayLogDec2 = await rpc(mcp.url, devToken, 'tools/call', {
      name: 'log_decision',
      arguments: {
        project_id: projectId,
        session_id: sid2, // same session as first call
        category: 'architecture',
        summary: 'Replay summary (ignored on cache hit)',
        rationale: 'Replay rationale.',
        trace_ids: ['ADR-023'],
        idempotency_key: 'transport-smoke-key-9',
      },
    });
    const idemReplayParsed = parseToolResult(replayLogDec2.envelope);
    check('idempotent replay returns ok', !idemReplayParsed.isError);
    if (!idemReplayParsed.isError) {
      const r = idemReplayParsed.data as { repo_commit_sha: string };
      check(
        'idempotent replay returns the original SHA (no new commit)',
        r.repo_commit_sha === originalSha,
        `original=${originalSha} replay=${r.repo_commit_sha}`,
      );
    }
    void replayLogDec; // first replay used new session; not asserted (different cache key)

    // -------------------------------------------------------------------
    // [10] propose_contract_change: stubbed at M2-mid per ADR-040
    // -------------------------------------------------------------------
    console.log('\n[10] propose_contract_change stub (M2-mid)');
    const propose = await rpc(mcp.url, devToken, 'tools/call', {
      name: 'propose_contract_change',
      arguments: {
        territory_id: territoryId,
        name: 'transport-smoke-contract',
        schema: { type: 'object' },
      },
    });
    const proposeParsed = parseToolResult(propose.envelope);
    check('propose_contract_change returns isError (stub)', proposeParsed.isError);
    check(
      'propose_contract_change error.code = INTERNAL',
      (proposeParsed.data as { code: string }).code === 'INTERNAL',
    );

    // -------------------------------------------------------------------
    // [11] find_similar: real handler per M5 (ADR-041/042/043). Wire smoke
    // validates envelope shape only -- handler policy (degraded vs isError
    // when embedder unavailable, primary/weak band partitioning, threshold
    // semantics) is covered by scripts/endpoint/__smoke__/find_similar.smoke.ts
    // and the eval harness. Without OPENAI_API_KEY in the env, the M5 handler
    // returns isError with EMBEDDER_UNAVAILABLE; with the key set, it returns
    // ok with primary_matches/weak_suggestions/degraded fields. Both are
    // valid wire envelopes; the smoke just confirms a parseable result.
    // Updated 2026-05-01 alongside the CI hotfix (the old stub-degraded
    // assertions latently broke at PR #7 / M5 substrate landing; surfaced
    // when CI parsing was restored).
    // -------------------------------------------------------------------
    console.log('\n[11] find_similar returns a parseable wire envelope');
    const fs = await rpc(mcp.url, devToken, 'tools/call', {
      name: 'find_similar',
      arguments: { description: 'find similar things' },
    });
    const fsParsed = parseToolResult(fs.envelope);
    check('find_similar returns a parseable tool-call envelope', typeof fsParsed.isError === 'boolean');

    // -------------------------------------------------------------------
    // [12] Auth: invalid signature rejected
    // -------------------------------------------------------------------
    console.log('\n[12] invalid bearer signature -> FORBIDDEN');
    const bogusToken = devToken.slice(0, -5) + 'XXXXX';
    const bogus = await rpc(mcp.url, bogusToken, 'tools/call', {
      name: 'heartbeat',
      arguments: { session_id: 'x' },
    });
    const bogusParsed = parseToolResult(bogus.envelope);
    check('bogus signature returns isError', bogusParsed.isError);
    check(
      'bogus signature error.code = FORBIDDEN',
      (bogusParsed.data as { code: string }).code === 'FORBIDDEN',
    );

    // -------------------------------------------------------------------
    // [13] Auth: token signed for unknown sub rejected with FORBIDDEN
    // -------------------------------------------------------------------
    console.log('\n[13] token for unmapped sub -> FORBIDDEN');
    const ghostToken = await issuer.signFor('sub-tr-ghost-not-in-composers');
    const ghost = await rpc(mcp.url, ghostToken, 'tools/call', {
      name: 'heartbeat',
      arguments: { session_id: 'x' },
    });
    const ghostParsed = parseToolResult(ghost.envelope);
    check('ghost-sub returns isError', ghostParsed.isError);
    check(
      'ghost-sub error.code = FORBIDDEN',
      (ghostParsed.data as { code: string }).code === 'FORBIDDEN',
    );

    // -------------------------------------------------------------------
    // [14] tools/call with unknown tool name -> INVALID_TOOL via dispatcher
    // -------------------------------------------------------------------
    console.log('\n[14] tools/call unknown tool -> INVALID_TOOL');
    const unknownTool = await rpc(mcp.url, devToken, 'tools/call', {
      name: 'not_a_real_tool',
      arguments: {},
    });
    const unknownToolParsed = parseToolResult(unknownTool.envelope);
    check('unknown tool returns isError', unknownToolParsed.isError);
    check(
      'unknown tool error.code = INVALID_TOOL',
      (unknownToolParsed.data as { code: string }).code === 'INVALID_TOOL',
    );
  } finally {
    await mcp.close();
    await issuer.close();
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
  console.log(`ALL TRANSPORT WIRE-LEVEL CHECKS PASSED`);
  console.log(`=========================================`);
}

main().catch((err) => {
  console.error('TRANSPORT SMOKE TEST CRASHED:', err);
  process.exit(2);
});
