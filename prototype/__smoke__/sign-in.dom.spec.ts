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
//   3. npm run smoke:signin:dom
//
// Coverage:
//   - unauthenticated /atelier/analyst -> sign-in CTA on the
//     LensUnauthorized page; clicking lands /sign-in?redirect=...
//   - email submission -> code-entry view
//   - code path: poll Mailpit for the OTP, enter it, verify session
//     persists and the lens renders
//   - failure path: invalid code -> inline error
//   - missing-composer path: real Supabase user with no Atelier
//     composer mapping -> "Your account is not invited yet"
//   - sign-out: clears the cookie; revisiting /atelier renders the
//     unauthorized state again
//
// Documented gap (v1.x polish):
//   - link path (magic URL click -> /sign-in/callback PKCE exchange)
//     is not exercised here. The PKCE verifier is in the BROWSER's
//     localStorage from the signInWithOtp call; a Playwright test
//     can navigate the page to the magic-link URL but that resets
//     localStorage, so the verifier mismatches. Properly covering
//     this requires a same-page click on the link; Mailpit's
//     anti-tracking image-proxy + Supabase's signed redirect URL
//     make that flaky. The substrate flow itself is covered by
//     `scripts/endpoint/__smoke__/real-client.smoke.ts` which uses
//     signInWithPassword to obtain the same token shape; the
//     PKCE-exchange path here only differs in HOW the token is
//     obtained.

import { test, expect } from '@playwright/test';
import {
  cleanupSigninFixtures,
  clearMailpit,
  createSupabaseUser,
  deleteSupabaseUser,
  ensureProjectAndTerritory,
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
      await expect(page.getByText(`We sent a sign-in link and 6-digit code to`)).toBeVisible();

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
      await deleteSupabaseUser(user.userId);
    }
  });

  test('signed-in user with no composer row sees "not invited yet"', async ({ page }) => {
    const user = await createSupabaseUser();
    // Deliberately do NOT seed a composer; the OTP succeeds, the cookie
    // is set, the lens read trips authenticate() -> FORBIDDEN with
    // "no active composer" -> reason='no_composer'.
    try {
      await page.goto('/sign-in?redirect=/atelier/analyst');
      await page.getByTestId('signin-email-input').fill(user.email);
      await page.getByTestId('signin-send').click();
      await expect(page.getByTestId('signin-code-input')).toBeVisible({ timeout: 10_000 });

      const code = await waitForOtpEmail(user.email);
      await page.getByTestId('signin-code-input').fill(code);
      await page.getByTestId('signin-verify').click();

      await page.waitForURL((url) => url.pathname === '/atelier/analyst');
      await expect(page.getByText('Your account is not invited yet')).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(/atelier invite/)).toBeVisible();
    } finally {
      await deleteSupabaseUser(user.userId);
    }
  });
});
