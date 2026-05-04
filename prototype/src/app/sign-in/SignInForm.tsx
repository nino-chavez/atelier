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
// Per BRD-OPEN-QUESTIONS section 31 (X1 close-out / C1 OTP relay) the
// email submit path POSTs to /sign-in/check FIRST. The check route
// returns 200 if an Atelier composer with that email exists and 404
// otherwise; both responses progress the UI to the same code-entry
// view with the same generic confirmation, so the form is not a
// user-enumeration oracle. Only on a 200 do we actually call
// signInWithOtp -- the 404 path silently drops the request, which is
// the expected closed posture against an open-OTP-relay attacker.

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
      // Server-side enumeration gate (C1, BRD §31). Only 200 unlocks
      // the OTP send; on 404 (or any non-200) we still progress to
      // code-entry so the UI is identical for invited and uninvited
      // emails. Rate-limit responses (429) bubble up as a generic
      // error instead of revealing the limiter exists.
      let allowSend = false;
      try {
        const checkResponse = await fetch('/sign-in/check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (checkResponse.status === 200) {
          allowSend = true;
        } else if (checkResponse.status === 429) {
          setError(
            'Too many sign-in attempts from this network. Wait a minute and try again.',
          );
          return;
        }
        // 404 / other: silently treat as not invited; UI advances anyway.
      } catch {
        // Network failure on the gate -- fail closed (do NOT call OTP).
        // Still advance the UI so behavior matches the gate-rejected case.
      }

      if (allowSend) {
        const callbackUrl = buildCallbackUrl(redirectTo);
        const supabase = getSupabaseBrowserClient();
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: callbackUrl,
            // Defense in depth: even if the gate ever misfires open,
            // shouldCreateUser:false prevents Supabase Auth from
            // auto-provisioning an account for an uninvited email.
            shouldCreateUser: false,
          },
        });
        if (otpError) {
          // Don't surface the underlying error -- it would leak
          // whether the email exists in Supabase Auth's user table
          // (a separate enumeration surface from composers).
          // Generic-progress is the right answer.
        }
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
  const origin = window.location.origin;
  const params = new URLSearchParams();
  params.set('redirect', redirectTo);
  return `${origin}/sign-in/callback?${params.toString()}`;
}
