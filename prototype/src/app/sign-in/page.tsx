// /sign-in -- magic-link + 6-digit code sign-in for /atelier (D7).
//
// Two paths from a single email submission per the auth-shape decision:
//   1. Magic link in the email body (clickable URL hits /auth/confirm,
//      which calls auth.verifyOtp({ token_hash, type }) per the rally-hq
//      reference pattern -- BRD-OPEN-QUESTIONS §31)
//   2. 6-digit code in the same email (entered into the second form view)
//
// Both paths use Supabase Auth's email-OTP. The link path is convenient
// when email and browser are on the same device; the code path bypasses
// corporate email-gateway URL pre-fetching (which consumes the link
// before the user clicks) and the mobile-email -> desktop-browser case.
//
// Server component owns the page chrome; the form is a client component
// (the email/code state machine + Supabase calls run in the browser).
//
// Per ADR-029 the form imports the Supabase browser client only via the
// supabase-browser.ts adapter -- never directly from @supabase/*.

import SignInForm from './SignInForm.tsx';
import styles from './SignInForm.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in -- Atelier' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = sanitizeRedirect(params.redirect);
  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.eyebrow}>atelier // sign in</div>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.lede}>
          Enter your email. We will send you a sign-in link AND a 6-digit
          code -- use whichever arrives first.
        </p>
        <SignInForm redirectTo={redirectTo} initialError={params.error ?? null} />
        <footer className={styles.footer}>
          <p>
            Need access? Ask your admin to invite you via{' '}
            <code>atelier invite</code>. Atelier does not auto-create
            accounts; signing in here will only succeed for emails an
            admin has already invited.
          </p>
          <p className={styles.byo}>
            Using a different identity provider? See{' '}
            <code>.atelier/config.yaml: identity.provider</code>{' '}
            (ADR-028).
          </p>
        </footer>
      </div>
    </main>
  );
}

/**
 * Restrict redirects to same-origin paths. Reject absolute URLs, scheme-
 * relative ('//evil.test/path'), and protocol-bearing strings. The form
 * URL-encodes the value before navigation so this is purely shape
 * validation, not URL parsing.
 */
function sanitizeRedirect(raw: string | undefined): string {
  if (!raw) return '/atelier';
  if (!raw.startsWith('/')) return '/atelier';
  if (raw.startsWith('//')) return '/atelier';
  if (/^\/?[a-z][a-z0-9+.-]*:/i.test(raw)) return '/atelier';
  return raw;
}
