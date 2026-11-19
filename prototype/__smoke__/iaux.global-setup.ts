// Playwright globalSetup for the IA/UX DOM smoke (post canonical-rebuild).
//
// One-time orchestration before the webServer-bound tests run:
//   1. Provision a real Supabase Auth user for the analyst composer.
//   2. Seed iaux fixtures with composers.identity_subject pointing at the
//      Supabase user.id (so the lens RPC's auth.jwt() -> sub -> composer
//      lookup resolves at runtime).
//   3. Drive the actual OTP sign-in flow through a headless browser to
//      obtain the @supabase/ssr cookie envelope, then save Playwright
//      storageState to a temp file.
//   4. Hand off the user.id + storageState path to the test suite via
//      env vars (IAUX_AUTH_USER_ID + IAUX_STORAGE_STATE) so the
//      teardown step can clean the Supabase user.
//
// The token-hash flow is intentionally NOT used here -- Mailpit emits a
// magic-link URL whose token expires fast and is awkward to extract.
// Driving the 6-digit OTP through the production /sign-in form mirrors
// what real users do, and the OTP path is what sign-in.dom.spec.ts
// already validates.

import { chromium, type FullConfig } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { seedIauxFixtures, IAUX_ANALYST_ID } from './iaux-fixtures.ts';
import {
  provisionAuthUser,
  readSupabaseEnvOrDie,
} from './real-auth-helpers.ts';
import { Client } from 'pg';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

interface MailpitSearchResult {
  total: number;
  messages: Array<{ ID: string; To: Array<{ Address: string }>; Subject: string }>;
}

interface MailpitMessage {
  ID: string;
  Text: string;
  HTML: string;
}

async function clearMailpit(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}

async function waitForOtpEmail(toEmail: string, timeoutMs = 15_000): Promise<string> {
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
      const match = `${message.Text}\n${message.HTML}`.match(
        /(?:code|token)\s*(?:is|:)\s*(\d{6})\b/i,
      );
      if (match) return match[1]!;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for OTP email to ${toEmail}`);
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const sb = readSupabaseEnvOrDie();

  // 1. Provision the auth user. Stamp the user.id onto the analyst
  //    composer's identity_subject so PostgREST's auth.jwt() -> sub
  //    -> composer resolution works at request time.
  const authUser = await provisionAuthUser(sb, 'iaux-smoke-analyst');
  await seedIauxFixtures({ analystIdentitySubject: authUser.userId });

  // 2. Drive the sign-in OTP flow against the running webServer to seat
  //    the @supabase/ssr cookie envelope.
  const baseURL = (config.projects[0]?.use?.baseURL ?? 'http://127.0.0.1:3030') as string;

  await clearMailpit();
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  await page.goto('/sign-in?redirect=/atelier/analyst');
  await page.getByTestId('signin-email-input').fill(authUser.email);
  await page.getByTestId('signin-send').click();
  await page.getByTestId('signin-code-input').waitFor({ state: 'visible', timeout: 15_000 });

  const code = await waitForOtpEmail(authUser.email);
  await page.getByTestId('signin-code-input').fill(code);
  await page.getByTestId('signin-verify').click();

  // Wait until the lens redirect lands; this confirms the cookie envelope
  // is in the browser context. Generous timeout: cold-compile of /atelier
  // can take ~5s under Next dev.
  await page.waitForURL((url) => url.pathname === '/atelier/analyst', { timeout: 30_000 });

  // 3. Save the storageState (cookies) for tests to inherit.
  const stateDir = await mkdtemp(join(tmpdir(), 'iaux-auth-'));
  const statePath = join(stateDir, 'storage-state.json');
  await context.storageState({ path: statePath });

  await page.close();
  await context.close();
  await browser.close();

  // 4. Hand off to teardown via process env. teardown deletes the auth
  //    user; the test suite reads IAUX_STORAGE_STATE indirectly via the
  //    storageState `use` config.
  process.env.IAUX_AUTH_USER_ID = authUser.userId;
  process.env.IAUX_STORAGE_STATE = statePath;
  // Pin the analyst composer id for tests that need to query the DB
  // alongside the rendered DOM (e.g. the Refresher freshness test).
  process.env.IAUX_ANALYST_COMPOSER_ID = IAUX_ANALYST_ID;

  // Sanity: the dev server is now warm; the lens has been rendered once
  // for the analyst. Tests can `goto('/atelier/analyst')` directly.
  void DB_URL;
  void Client;
}
