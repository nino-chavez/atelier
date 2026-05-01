// Local-bootstrap helper: sign in to local Supabase Auth via password grant
// and print the resulting access_token (a real ES256-signed JWT).
//
// Per docs/user/tutorials/local-bootstrap.md step 4. The token is the same
// shape any MCP client (Claude Code, Cursor, claude.ai Connectors) uses
// after completing OAuth -- the password grant is the local-bootstrap
// shortcut around the OAuth dance.
//
// Run:
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_ANON_KEY=<anon key> \
//   npx tsx scripts/bootstrap/issue-bearer.ts \
//     --email you@example.com \
//     --password <password from seed step>
//
// Default lifetime: 1 hour for the access_token (Supabase Auth default).
// See docs/user/guides/rotate-secrets.md for the rotation flow.

import { createClient } from '@supabase/supabase-js';

interface Args {
  email: string;
  password: string;
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
  return { email, password };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl) throw new Error('SUPABASE_URL env var required');
  if (!anonKey) throw new Error('SUPABASE_ANON_KEY env var required');

  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await client.auth.signInWithPassword({
    email: args.email,
    password: args.password,
  });
  if (result.error || !result.data.session) {
    throw new Error(`signInWithPassword failed: ${result.error?.message ?? 'no session returned'}`);
  }
  const session = result.data.session;
  // The access_token is the bearer; print it on stdout so callers can
  // capture via $(...). Everything else goes to stderr.
  process.stderr.write(`[bearer] access_token expires in ${session.expires_in ?? 'unknown'}s\n`);
  process.stderr.write(`[bearer] user.id = ${session.user.id}\n`);
  process.stderr.write(`[bearer] email   = ${session.user.email}\n`);
  process.stdout.write(session.access_token);
  process.stdout.write('\n');
}

main().catch((err) => {
  console.error('BEARER ISSUE FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
