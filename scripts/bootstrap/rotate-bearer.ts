// Local-bootstrap helper: rotate the bearer in `.mcp.json` against a fresh
// Supabase Auth signInWithPassword exchange. Closes M7 follow-up F6.4 +
// the M6 bearer-cache durability finding.
//
// What this script does:
//
//   1. Re-signs in to Supabase Auth via password grant (same code path
//      as scripts/bootstrap/issue-bearer.ts) and captures a fresh
//      access_token.
//   2. Updates `.mcp.json` at the repo root in-place: the
//      `mcpServers.atelier.headers.Authorization` field gets the new
//      `Bearer <token>` value. All other config (URL, transport, other
//      servers) is preserved verbatim.
//   3. Prints a load-bearing reminder that Claude Code's MCP HTTP client
//      caches the bearer durably across `/mcp` Disable->Enable AND
//      `exit`+relaunch. The operator MUST quit the Claude Code process
//      and start a fresh one for the new bearer to take effect.
//
// What this script does NOT do (and cannot, without product changes in
// Claude Code itself):
//
//   - Force Claude Code's MCP client to re-read .mcp.json. There is no
//     known IPC, signal, or filesystem-watch mechanism. The cache lives
//     in process memory.
//   - Detect whether Claude Code is currently running. The script just
//     writes the file; the operator must restart manually.
//   - Verify the new bearer works against the substrate from inside
//     Claude Code. The substrate-side rotation correctness is covered by
//     the cc-mcp-client.smoke.ts bearer-rotation probe (this PR adds
//     that probe).
//
// Idempotency: re-running with the same email + password issues a fresh
// bearer (different exp; same identity). The .mcp.json structure is
// preserved across runs; only the Authorization header value changes.
//
// Run:
//
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_ANON_KEY=<anon key from supabase status> \
//   npx tsx scripts/bootstrap/rotate-bearer.ts \
//     --email you@example.com \
//     --password <password from seed-composer.ts step>
//
// Or against cloud Supabase (per docs/user/tutorials/first-deploy.md):
//
//   SUPABASE_URL=https://<project-ref>.supabase.co \
//   SUPABASE_ANON_KEY=<anon key from project settings> \
//   npx tsx scripts/bootstrap/rotate-bearer.ts \
//     --email you@example.com \
//     --password <cloud-seeded password>
//
// Optional flags:
//
//   --mcp-config <path>   Path to .mcp.json. Default: <repo-root>/.mcp.json
//   --server-name <name>  Which mcpServers.* entry to update. Default: atelier
//   --print-only          Print the new bearer to stdout but DO NOT write
//                         the file. For piping into other tools.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient } from '@supabase/supabase-js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

interface Args {
  email: string;
  password: string;
  mcpConfig: string;
  serverName: string;
  printOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = next;
      i += 1;
    }
  }
  const email = out.email;
  const password = out.password;
  if (!email) throw new Error('--email is required');
  if (!password) throw new Error('--password is required');
  return {
    email,
    password,
    mcpConfig: out['mcp-config'] ?? resolve(REPO_ROOT, '.mcp.json'),
    serverName: out['server-name'] ?? 'atelier',
    printOnly: out['print-only'] === 'true',
  };
}

async function issueBearer(email: string, password: string): Promise<{ token: string; expiresIn: number; userId: string }> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl) throw new Error('SUPABASE_URL env var required');
  if (!anonKey) throw new Error('SUPABASE_ANON_KEY env var required');

  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) {
    throw new Error(`signInWithPassword failed: ${result.error?.message ?? 'no session returned'}`);
  }
  return {
    token: result.data.session.access_token,
    expiresIn: result.data.session.expires_in ?? 3600,
    userId: result.data.session.user.id,
  };
}

interface McpConfig {
  mcpServers?: Record<
    string,
    {
      type?: string;
      url?: string;
      headers?: Record<string, string>;
      [key: string]: unknown;
    }
  >;
  [key: string]: unknown;
}

async function readMcpConfig(path: string): Promise<McpConfig> {
  if (!existsSync(path)) {
    return { mcpServers: {} };
  }
  const body = await readFile(path, 'utf8');
  if (body.trim().length === 0) {
    return { mcpServers: {} };
  }
  try {
    return JSON.parse(body) as McpConfig;
  } catch (err) {
    throw new Error(`failed to parse ${path} as JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const issued = await issueBearer(args.email, args.password);

  process.stderr.write(`[rotate-bearer] new access_token issued\n`);
  process.stderr.write(`[rotate-bearer]   user.id    = ${issued.userId}\n`);
  process.stderr.write(`[rotate-bearer]   email      = ${args.email}\n`);
  process.stderr.write(`[rotate-bearer]   expires in = ${issued.expiresIn}s\n`);

  if (args.printOnly) {
    process.stdout.write(issued.token);
    process.stdout.write('\n');
    return;
  }

  const config = await readMcpConfig(args.mcpConfig);
  if (!config.mcpServers) config.mcpServers = {};
  const existing = config.mcpServers[args.serverName] ?? {};
  config.mcpServers[args.serverName] = {
    ...existing,
    type: existing.type ?? 'http',
    url: existing.url ?? 'http://localhost:3030/api/mcp',
    headers: {
      ...(existing.headers ?? {}),
      Authorization: `Bearer ${issued.token}`,
    },
  };

  // Pretty-print with 2-space indent + trailing newline (matches the
  // format already in the repo's .mcp.json).
  await writeFile(args.mcpConfig, JSON.stringify(config, null, 2) + '\n', 'utf8');

  process.stderr.write(`[rotate-bearer] wrote new bearer to ${args.mcpConfig}\n`);
  process.stderr.write(`\n`);
  process.stderr.write(`==============================================================\n`);
  process.stderr.write(`  IMPORTANT: Claude Code's MCP HTTP client caches the bearer\n`);
  process.stderr.write(`  in process memory. Editing .mcp.json does NOT propagate to\n`);
  process.stderr.write(`  a running Claude Code session, even with /mcp Disable->Enable\n`);
  process.stderr.write(`  or 'exit' + relaunch from the same shell.\n`);
  process.stderr.write(`\n`);
  process.stderr.write(`  To use the new bearer:\n`);
  process.stderr.write(`    1. Quit Claude Code completely (close all windows)\n`);
  process.stderr.write(`    2. Start a fresh Claude Code session\n`);
  process.stderr.write(`    3. Run /mcp and confirm 'atelier' shows as connected\n`);
  process.stderr.write(`\n`);
  process.stderr.write(`  Direct curl against the substrate uses the new bearer\n`);
  process.stderr.write(`  immediately (the substrate is stateless on bearer rotation;\n`);
  process.stderr.write(`  the cache is purely client-side).\n`);
  process.stderr.write(`==============================================================\n`);
}

main().catch((err) => {
  console.error('rotate-bearer failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
