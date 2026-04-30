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

import * as http from 'node:http';
import { Client } from 'pg';
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
} from 'jose';
import { AtelierClient } from '../../sync/lib/write.ts';
import { createJwksVerifier } from '../lib/jwks-verifier.ts';
import { TOOL_NAMES } from '../lib/dispatch.ts';
import { handleMcpRequest } from '../lib/transport.ts';
import { oauthDiscoveryResponse } from '../lib/oauth-discovery.ts';

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
}): Promise<McpServer> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://localhost`);

      if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
        const webRes = oauthDiscoveryResponse({ issuer: deps.oauthIssuer });
        await pipeWebResponse(webRes, res);
        return;
      }

      if (url.pathname === '/api/mcp' || url.pathname === '/mcp') {
        const webReq = await nodeRequestToWebRequest(req, url);
        const webRes = await handleMcpRequest(webReq, { deps });
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
  const mcp = await startMcpServer({ client, verifier, oauthIssuer: issuer.url });
  console.log(`  mcp server at ${mcp.url}`);

  const devToken = await issuer.signFor('sub-tr-dev');

  try {
    // -------------------------------------------------------------------
    // [0] OAuth discovery (RFC 8414)
    // -------------------------------------------------------------------
    console.log('\n[0] /.well-known/oauth-authorization-server');
    const discRes = await fetch(`${mcp.url}/.well-known/oauth-authorization-server`);
    check('discovery returns 200', discRes.status === 200);
    const disc = (await discRes.json()) as Record<string, string>;
    check('discovery.issuer matches configured issuer', disc.issuer === issuer.url);
    check('discovery.jwks_uri derived correctly', disc.jwks_uri === `${issuer.url}/.well-known/jwks.json`);
    check('discovery.token_endpoint set', typeof disc.token_endpoint === 'string' && disc.token_endpoint.length > 0);
    check('discovery.authorization_endpoint set', typeof disc.authorization_endpoint === 'string');
    check(
      'discovery.code_challenge_methods_supported includes S256',
      Array.isArray((disc as unknown as { code_challenge_methods_supported: unknown }).code_challenge_methods_supported) &&
        ((disc as unknown as { code_challenge_methods_supported: string[] }).code_challenge_methods_supported.includes('S256')),
    );

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
    // [9] log_decision returns INTERNAL when decisionCommit not configured
    //     (per SESSION.md M2-mid scope: per-project committer lands later)
    // -------------------------------------------------------------------
    console.log('\n[9] log_decision INTERNAL stub (per-project committer pending)');
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
        summary: 'test decision',
        rationale: 'should fail with INTERNAL because committer not configured',
        trace_ids: ['ADR-040'],
      },
    });
    const logDecParsed = parseToolResult(logDec.envelope);
    check('log_decision returns isError', logDecParsed.isError);
    check(
      'log_decision error.code = INTERNAL (committer pending)',
      (logDecParsed.data as { code: string }).code === 'INTERNAL',
    );
    check(
      'log_decision error.message names decisionCommit',
      (logDecParsed.data as { message: string }).message.includes('decisionCommit'),
    );

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
    // [11] find_similar: stubbed at M2 entry per BUILD-SEQUENCE; degraded=true
    // -------------------------------------------------------------------
    console.log('\n[11] find_similar degraded=true (gates on D24/M5)');
    const fs = await rpc(mcp.url, devToken, 'tools/call', {
      name: 'find_similar',
      arguments: { description: 'find similar things' },
    });
    const fsParsed = parseToolResult(fs.envelope);
    check('find_similar returns ok (not isError; just degraded)', !fsParsed.isError);
    check(
      'find_similar.degraded = true',
      (fsParsed.data as { degraded: boolean }).degraded === true,
    );

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
