// Fixtures for the sign-in DOM smoke (D7).
//
// Each test creates throwaway Supabase Auth users via the admin SDK
// (mirroring scripts/endpoint/__smoke__/real-client.smoke.ts) and
// optionally seeds a matching Atelier composer row keyed on the
// Supabase user.id. Cleanup deletes both.
//
// Mailpit lives at http://127.0.0.1:54324 and intercepts every email
// the local Supabase Auth would have sent. Helpers here:
//   - clearMailpit: wipe inbox between tests so OTP lookups are unambiguous
//   - waitForOtpEmail: poll Mailpit until an email to <to> arrives,
//     return the 6-digit code parsed from the body.

import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.API_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? '';

export const SIGNIN_PROJECT_ID = 'aaaaaaaa-1111-1111-1111-111111111111';
export const SIGNIN_TERRITORY_ID = 'aaaaaaaa-3333-3333-3333-aaaaaaaaaaaa';

const MAILPIT_URL = 'http://127.0.0.1:54324';

let cachedAdmin: SupabaseClient | null = null;

function getAdmin(): SupabaseClient {
  if (!SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY must be set to provision Supabase Auth users for the sign-in smoke. ' +
        'Run: eval "$(supabase status -o env)" before invoking the smoke.',
    );
  }
  if (!cachedAdmin) {
    cachedAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedAdmin;
}

export interface CreatedUser {
  email: string;
  password: string;
  userId: string;
}

export async function createSupabaseUser(): Promise<CreatedUser> {
  const admin = getAdmin();
  const email = `signin-smoke-${Date.now()}-${randomBytes(4).toString('hex')}@atelier.invalid`;
  // Required by createUser, even though OTP flow does not use it.
  const password = `t-${randomBytes(12).toString('base64url')}-aA1`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`admin.createUser failed: ${created.error?.message ?? 'no user'}`);
  }
  return { email, password, userId: created.data.user.id };
}

export async function deleteSupabaseUser(userId: string): Promise<void> {
  await getAdmin().auth.admin.deleteUser(userId).catch(() => {});
}

async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function ensureProjectAndTerritory(): Promise<void> {
  await withDb(async (client) => {
    await cleanupProject(client);
    await client.query(
      `INSERT INTO projects (id, name, repo_url, template_version)
       VALUES ($1, 'signin-smoke', 'https://example.invalid/signin', '1.0')`,
      [SIGNIN_PROJECT_ID],
    );
    await client.query(
      `INSERT INTO territories (id, project_id, name, owner_role, review_role, scope_kind, scope_pattern, requires_plan_review)
       VALUES ($1, $2, 'signin-territory', 'dev', 'architect', 'files', ARRAY['signin-smoke/**'], false)`,
      [SIGNIN_TERRITORY_ID, SIGNIN_PROJECT_ID],
    );
  });
}

export async function seedComposer(opts: {
  email: string;
  identitySubject: string;
  discipline?: 'analyst' | 'dev' | 'pm' | 'designer' | 'architect';
  accessLevel?: 'member' | 'admin' | 'stakeholder';
}): Promise<string> {
  const id = `aaaaaaaa-2222-2222-2222-${randomBytes(6).toString('hex')}`;
  await withDb(async (client) => {
    await client.query(
      `INSERT INTO composers (id, project_id, email, display_name, discipline, access_level, identity_subject)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        SIGNIN_PROJECT_ID,
        opts.email,
        opts.email.split('@')[0] ?? 'signin-smoke',
        opts.discipline ?? 'analyst',
        opts.accessLevel ?? 'admin',
        opts.identitySubject,
      ],
    );
  });
  return id;
}

export async function cleanupSigninFixtures(): Promise<void> {
  await withDb(cleanupProject);
}

async function cleanupProject(client: Client): Promise<void> {
  await client.query(`ALTER TABLE decisions DISABLE TRIGGER decisions_block_delete`);
  try {
    await client.query(`DELETE FROM projects WHERE id = $1 OR name = 'signin-smoke'`, [
      SIGNIN_PROJECT_ID,
    ]);
  } finally {
    await client.query(`ALTER TABLE decisions ENABLE TRIGGER decisions_block_delete`);
  }
}

// ---------------------------------------------------------------------------
// Mailpit helpers
// ---------------------------------------------------------------------------

interface MailpitSearchHit {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
  Created: string;
}

interface MailpitSearchResult {
  total: number;
  messages: MailpitSearchHit[];
}

interface MailpitMessage {
  ID: string;
  Text: string;
  HTML: string;
}

export async function clearMailpit(): Promise<void> {
  // DELETE /api/v1/messages clears the entire inbox. Tests start clean
  // so the next OTP lookup is unambiguous.
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}

export async function waitForOtpEmail(toEmail: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = (await (
      await fetch(
        `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${toEmail}`)}&limit=1`,
      )
    ).json()) as MailpitSearchResult;
    const hit = search.messages?.[0];
    if (hit) {
      const message = (await (
        await fetch(`${MAILPIT_URL}/api/v1/message/${hit.ID}`)
      ).json()) as MailpitMessage;
      const code = extractOtpCode(`${message.Text}\n${message.HTML}`);
      if (code) return code;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for OTP email to ${toEmail}`);
}

function extractOtpCode(body: string): string | null {
  // Supabase's default magic-link template surfaces the 6-digit code via
  // a "code: NNNNNN" / "code is NNNNNN" / "Token: NNNNNN" line. Anchor
  // the regex to that prefix; the alternative (find any standalone
  // 6-digit run) false-matches accidental 6-digit substrings inside
  // the PKCE token URL parameter (token=pkce_<hex>... carries
  // arbitrary digit runs).
  const match = body.match(/(?:code|token)\s*(?:is|:)\s*(\d{6})\b/i);
  return match ? match[1]! : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
