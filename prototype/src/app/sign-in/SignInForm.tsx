'use client';

// Two-state sign-in form: email -> OTP code.
//
// State machine:
//   email-entry  -> [submit email] -> code-entry  (OTP sent)
//   code-entry   -> [submit code]  -> verified    (browser navigates)
//
// Failures land back in the originating state with an inline error.
//
// Per ADR-029 the Supabase browser client is reached only through the
// supabase-browser.ts adapter; this file does not import @supabase/*.
//
// Auth shape (BRD-OPEN-QUESTIONS §31, "Refactor sign-in to token-hash flow
// per rally-hq pattern"). The form calls `signInWithOtp` with
// `shouldCreateUser:false`; Supabase Auth dispatches the email IFF the
// address resolves to an existing auth user (otherwise it returns an error
// without sending mail, closing the OTP-relay surface). The email's
// magic-link URL routes through `/auth/confirm` (token-hash verify, not
// PKCE exchange); the 6-digit code path lands in `verifyOtp({ email, token,
// type: 'email' })` directly. We deliberately advance the UI to the code
// view on every submit (success or error) so the form is not a user-
// enumeration oracle.

import { useState } from 'react';
import * as React from 'react';
import { getSupabaseBrowserClient } from '../../lib/atelier/adapters/supabase-browser.ts';
import styles from './SignInForm.module.css';

type Stage = 'email' | 'code';

const ERROR_MESSAGES: Record<string, string> = {
  expired:
    'That sign-in link expired or was already used. Request a new code below.',
  exchange_failed:
    'The sign-in link could not be exchanged for a session. Request a new code below.',
};

export default function SignInForm({
  redirectTo,
  initialError,
}: {
  redirectTo: string;
  initialError: string | null;
}) {
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? (ERROR_MESSAGES[initialError] ?? null) : null,
  );

  async function onSubmitEmail(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!isPlausibleEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      const callbackUrl = buildCallbackUrl(redirectTo);
      const supabase = getSupabaseBrowserClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: callbackUrl,
          // Defense in depth: structural protection is the token-hash
          // verifier (only Supabase-issued tokens succeed at /auth/confirm),
          // but `shouldCreateUser:false` also prevents Supabase Auth from
          // auto-provisioning an account for an uninvited email. The
          // combination keeps the form from acting as a user-enumeration
          // oracle and from being usable as an open OTP relay.
          shouldCreateUser: false,
        },
      });
      if (otpError) {
        // Don't surface the underlying error -- it would reveal whether the
        // email exists in Supabase Auth's user table. Generic-progress is
        // the right answer; the UI advances regardless.
      }
      setStage('code');
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitCode(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: trimmed,
        type: 'email',
      });
      if (verifyError) {
        setError(verifyError.message);
        return;
      }
      // verifyOtp persists the session via the browser cookie; navigate.
      window.location.assign(redirectTo);
    } finally {
      setBusy(false);
    }
  }

  function onBackToEmail(): void {
    setStage('email');
    setCode('');
    setError(null);
  }

  if (stage === 'code') {
    return (
      <form className={styles.form} onSubmit={onSubmitCode} noValidate>
        <p className={styles.confirmation}>
          If <strong>{email}</strong> is registered, we sent a sign-in
          link and 6-digit code. Click the link OR enter the code below.
        </p>
        <label className={styles.label}>
          <span className={styles.labelText}>6-digit code</span>
          <input
            className={styles.input}
            inputMode="numeric"
            pattern="\d{6}"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-testid="signin-code-input"
            autoFocus
            required
          />
        </label>
        {error && (
          <p className={styles.error} role="alert" data-testid="signin-error">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={onBackToEmail}
            disabled={busy}
            data-testid="signin-back"
          >
            Use a different email
          </button>
          <button
            type="submit"
            className={styles.primary}
            disabled={busy}
            data-testid="signin-verify"
          >
            {busy ? 'Verifying...' : 'Verify code'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className={styles.form} onSubmit={onSubmitEmail} noValidate>
      <label className={styles.label}>
        <span className={styles.labelText}>Email</span>
        <input
          className={styles.input}
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="signin-email-input"
          autoFocus
          required
        />
      </label>
      {error && (
        <p className={styles.error} role="alert" data-testid="signin-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        className={styles.primary}
        disabled={busy}
        data-testid="signin-send"
      >
        {busy ? 'Sending...' : 'Send sign-in link'}
      </button>
    </form>
  );
}

function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function buildCallbackUrl(redirectTo: string): string {
  // The magic-link URL is ultimately controlled by the Supabase Auth email
  // template, which in the rally-hq pattern emits
  // `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink
  // &next=/atelier`. We still pass `emailRedirectTo` so operators who keep
  // `{{ .RedirectTo }}` in their template thread the per-request `next`
  // parameter through; with the brief's literal template `next=/atelier` is
  // hardcoded and this value is unused.
  const origin = window.location.origin;
  const params = new URLSearchParams();
  params.set('next', redirectTo);
  return `${origin}/auth/confirm?${params.toString()}`;
}
