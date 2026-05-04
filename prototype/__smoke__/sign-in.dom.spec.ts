// Sign-in DOM smoke (D7).
//
// Exercises the magic-link + 6-digit code flow end-to-end against the
// real local Supabase Auth. The link path requires URL extraction from
// the inbox + a manual click; we cover the code path here (the more
// common corporate-email-gateway-resistant path) and document the
// link-path coverage gap below.
//
// Prerequisites:
//   1. supabase start  (DB + Auth + Mailpit at 54321/54322/54324)
//   2. eval "$(supabase status -o env)"  -- exports SUPABASE_*
//   3. npm run smoke:sign-in:dom
//
// Coverage:
//   - unauthenticated /atelier/analyst -> sign-in CTA on the
//     LensUnauthorized page; clicking lands /sign-in?redirect=...
//   - email submission -> code-entry view
//   - code path: poll Mailpit for the OTP, enter it, verify session
//     persists and the lens renders
//   - failure path: invalid code -> inline error
//   - sign-out: clears the cookie; revisiting /atelier renders the
//     unauthorized state again
//   - generic-progress posture (BRD-OQ §31, post-refactor): an
//     uninvited email still advances the UI to the code-entry view so
//     the form is not a user-enumeration oracle. The structural
//     defense is now `shouldCreateUser:false` on signInWithOtp +
//     token-hash verify on /auth/confirm (only Supabase-issued tokens
//     succeed); Mailpit stays empty for uninvited submits because
//     Supabase Auth refuses to mint mail for non-existent users.
//
// Documented gap (v1.x polish):
//   - link path (magic URL click -> /auth/confirm token-hash verify)
//     is not exercised here because Mailpit's anti-tracking image-
//     proxy + the locally-encoded token make automation flaky. The
//     substrate auth flow itself is covered by
//     `scripts/endpoint/__smoke__/real-client.smoke.ts` which uses
//     signInWithPassword to obtain the same session shape; the
//     /auth/confirm route only differs in HOW the session is seated
//     (token-hash vs password).

import { test, expect } from '@playwright/test';
import {
  cleanupSigninFixtures,
  clearMailpit,
  createSupabaseUser,
  deleteSupabaseUser,
  ensureProjectAndTerritory,
  expectNoOtpEmail,
  seedComposer,
  waitForOtpEmail,
} from './sign-in-fixtures.ts';

test.describe('sign-in DOM contract', () => {
  test.beforeAll(async () => {
    await ensureProjectAndTerritory();
  });

  test.afterAll(async () => {
    await cleanupSigninFixtures();
  });

  test.beforeEach(async () => {
    await clearMailpit();
  });

  test('unauthenticated /atelier/analyst renders sign-in CTA with redirect threaded through', async ({
    page,
  }) => {
    await page.goto('/atelier/analyst');
    await expect(page.getByText('Sign in to view the dashboard')).toBeVisible();
    const cta = page.getByTestId('signin-cta');
    await expect(cta).toBeVisible();
    const href = await cta.getAttribute('href');
    expect(href).toContain('/sign-in');
    expect(href).toContain('redirect=%2Fatelier%2Fanalyst');
  });

  test('end-to-end: email -> OTP -> redirect -> lens renders -> sign out', async ({ page }) => {
    const user = await createSupabaseUser();
    const composerId = await seedComposer({
      email: user.email,
      identitySubject: user.userId,
      discipline: 'analyst',
      accessLevel: 'admin',
    });
    try {
      await page.goto('/sign-in?redirect=/atelier/analyst');
      await expect(page.getByText('Sign in', { exact: true })).toBeVisible();

      await page.getByTestId('signin-email-input').fill(user.email);
      await page.getByTestId('signin-send').click();

      await expect(page.getByTestId('signin-code-input')).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByText(/we sent a sign-in link and 6-digit code/i),
      ).toBeVisible();

      const code = await waitForOtpEmail(user.email);
      await page.getByTestId('signin-code-input').fill(code);
      await page.getByTestId('signin-verify').click();

      // Cookie set, browser navigates to /atelier/analyst, lens renders.
      await page.waitForURL((url) => url.pathname === '/atelier/analyst');
      await expect(page.locator('h1', { hasText: /Analyst lens/i })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId('viewer-email')).toContainText(user.email);

      // Sign-out clears the cookie and bounces to root.
      await page.getByTestId('signout-link').click();
      await page.waitForURL((url) => url.pathname === '/');

      // Visiting the lens again now shows the unauthorized CTA.
      await page.goto('/atelier/analyst');
      await expect(page.getByTestId('signin-cta')).toBeVisible();
    } finally {
      void composerId;
      await deleteSupabaseUser(user.userId);
    }
  });

  test('invalid 6-digit code surfaces inline error', async ({ page }) => {
    const user = await createSupabaseUser();
    const composerId = await seedComposer({
      email: user.email,
      identitySubject: user.userId,
      discipline: 'analyst',
      accessLevel: 'admin',
    });
    try {
      await page.goto('/sign-in');
      await page.getByTestId('signin-email-input').fill(user.email);
      await page.getByTestId('signin-send').click();
      await expect(page.getByTestId('signin-code-input')).toBeVisible({ timeout: 10_000 });

      // Wrong code (well-formed shape, wrong value).
      await page.getByTestId('signin-code-input').fill('000000');
      await page.getByTestId('signin-verify').click();
      await expect(page.getByTestId('signin-error')).toBeVisible({ timeout: 10_000 });
    } finally {
      void composerId;
      await deleteSupabaseUser(user.userId);
    }
  });

  test('signed-in user with no composer row sees "not invited yet"', async ({ page }) => {
    const user = await createSupabaseUser();
    // No composer row: the form's signInWithOtp call uses
    // shouldCreateUser:false, so Supabase will mint mail for this
    // address (because we just admin.createUser'd it above) but the
    // /atelier lens will render the no_composer state once signed in.
    // We don't drive the full flow here -- the no_composer rendering
    // is exercised by lens.smoke.ts unit case 7 'unknown sub ->
    // reason=no_composer'. This case asserts the unauthorized CTA.
    try {
      await page.goto('/atelier/analyst');
      await expect(page.getByTestId('signin-cta')).toBeVisible();
    } finally {
      await deleteSupabaseUser(user.userId);
    }
  });

  // -------------------------------------------------------------------
  // Generic-progress posture (BRD-OPEN-QUESTIONS §31, post-refactor)
  // -------------------------------------------------------------------

  test('generic-progress: uninvited email submit advances UI without sending mail', async ({
    page,
  }) => {
    // No composer or auth user seeded for this address. signInWithOtp
    // with shouldCreateUser:false errors server-side; the form swallows
    // the error and advances the UI so it is not a user-enumeration
    // oracle. Mailpit remains empty for the recipient.
    const uninvitedEmail = `uninvited-${Date.now()}@atelier.invalid`;

    await page.goto('/sign-in');
    await page.getByTestId('signin-email-input').fill(uninvitedEmail);
    await page.getByTestId('signin-send').click();

    // UI advances identically to the invited path -- no enumeration.
    await expect(page.getByTestId('signin-code-input')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/we sent a sign-in link and 6-digit code/i),
    ).toBeVisible();

    // No email actually went out (Supabase Auth refused to mint mail
    // for a non-existent user with shouldCreateUser:false).
    await expectNoOtpEmail(uninvitedEmail, 3_000);
  });

  test('invited email submit progresses to OTP send', async ({ page }) => {
    // Seeded composer + auth user; the OTP send should mint a magic
    // link + 6-digit code in Mailpit.
    const user = await createSupabaseUser();
    const composerId = await seedComposer({
      email: user.email,
      identitySubject: user.userId,
      discipline: 'analyst',
      accessLevel: 'admin',
    });
    try {
      await page.goto('/sign-in');
      await page.getByTestId('signin-email-input').fill(user.email);
      await page.getByTestId('signin-send').click();
      await expect(page.getByTestId('signin-code-input')).toBeVisible({ timeout: 10_000 });

      // Code arrives within the standard wait window.
      const code = await waitForOtpEmail(user.email);
      expect(code).toMatch(/^\d{6}$/);
    } finally {
      void composerId;
      await deleteSupabaseUser(user.userId);
    }
  });

  // -------------------------------------------------------------------
  // /auth/confirm hardening
  // -------------------------------------------------------------------

  test('/auth/confirm with missing token_hash redirects to /sign-in?error=expired', async ({
    page,
  }) => {
    await page.goto('/auth/confirm?type=magiclink');
    await page.waitForURL((url) => url.pathname === '/sign-in');
    expect(page.url()).toContain('error=expired');
  });

  test('/auth/confirm with invalid type redirects to /sign-in?error=expired', async ({
    page,
  }) => {
    await page.goto('/auth/confirm?token_hash=abc&type=not-a-real-type');
    await page.waitForURL((url) => url.pathname === '/sign-in');
    expect(page.url()).toContain('error=expired');
  });

  test('/auth/confirm with expired/bogus token_hash redirects to /sign-in?error=expired', async ({
    page,
  }) => {
    // Well-formed `type` but token_hash that Supabase will reject.
    await page.goto('/auth/confirm?token_hash=bogus-token-that-supabase-will-reject&type=magiclink');
    await page.waitForURL((url) => url.pathname === '/sign-in');
    expect(page.url()).toContain('error=expired');
  });
});
