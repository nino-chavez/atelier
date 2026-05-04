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
        options: { emailRedirectTo: callbackUrl },
      });
      if (otpError) {
        setError(otpError.message);
        return;
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
          We sent a sign-in link and 6-digit code to <strong>{email}</strong>.
          Click the link OR enter the code below.
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
  // Lightweight client-side gate; Supabase Auth does the authoritative
  // validation server-side and surfaces a structured error if the
  // address is unroutable.
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function buildCallbackUrl(redirectTo: string): string {
  // Same-origin absolute URL the email link will hit. Encoding the
  // intended post-sign-in path lets the callback handler bounce the
  // user back where they started.
  const origin = window.location.origin;
  const params = new URLSearchParams();
  params.set('redirect', redirectTo);
  return `${origin}/sign-in/callback?${params.toString()}`;
}
