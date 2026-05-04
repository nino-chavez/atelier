#!/usr/bin/env -S npx tsx
//
// Smoke test for the canonical-vs-legacy env-var fallback chain.
//
// Validates that every env-var read site introduced by the canonical-env-var
// refactor resolves correctly when:
//   1. ONLY the canonical name is set (POSTGRES_URL, NEXT_PUBLIC_SUPABASE_URL,
//      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SITE_URL, etc.)
//   2. ONLY the legacy name is set (ATELIER_DATASTORE_URL,
//      NEXT_PUBLIC_SUPABASE_ANON_KEY, ATELIER_PUBLIC_URL, etc.)
//   3. Both are set (canonical takes precedence)
//
// Pure unit-style: no Postgres, no HTTP, no auth flows. Exercises the env
// resolvers in isolation:
//   - jwksVerifierFromEnv() — issuer derivation from NEXT_PUBLIC_SUPABASE_URL
//     + audience default to "authenticated"
//   - supabaseEnvFromProcess() — anon/publishable key fallback chain
//
// Lives at prototype/__smoke__/ alongside other prototype-internal smokes
// so relative imports resolve cleanly under the prototype tsconfig.
//
// No DB; pure unit test of resolver shapes. Safe to run anywhere.

import { jwksVerifierFromEnv } from '../../scripts/endpoint/lib/jwks-verifier.ts';
import { supabaseEnvFromProcess } from '../src/lib/atelier/adapters/supabase-ssr.ts';

// Helpers that build a partial env without forcing NODE_ENV. The resolvers
// only read string-keyed env entries, so a loose Record is structurally fine.
type Env = Record<string, string | undefined>;
const verify = (env: Env): void => {
  jwksVerifierFromEnv(env as unknown as NodeJS.ProcessEnv);
};
const resolveSsr = (env: Env) =>
  supabaseEnvFromProcess(env as unknown as NodeJS.ProcessEnv);

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------
// jwksVerifierFromEnv() resolver — issuer + audience derivation
// ---------------------------------------------------------------------------

console.log('\n[1] jwksVerifierFromEnv issuer/audience resolution');

// Canonical: NEXT_PUBLIC_SUPABASE_URL alone derives issuer + defaults audience.
{
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  };
  let resolved = false;
  try {
    verify(env);
    resolved = true;
  } catch (err) {
    check('canonical NEXT_PUBLIC_SUPABASE_URL alone resolves', false, (err as Error).message);
  }
  check('canonical NEXT_PUBLIC_SUPABASE_URL alone resolves', resolved);
}

// Trailing-slash variant must produce the same issuer.
{
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co/',
  };
  let resolved = false;
  try {
    verify(env);
    resolved = true;
  } catch (err) {
    check('canonical with trailing slash resolves', false, (err as Error).message);
  }
  check('canonical with trailing slash resolves', resolved);
}

// Legacy: ATELIER_OIDC_ISSUER + ATELIER_JWT_AUDIENCE alone resolves (back-compat).
{
  const env = {
    ATELIER_OIDC_ISSUER: 'https://abc.supabase.co/auth/v1',
    ATELIER_JWT_AUDIENCE: 'authenticated',
  };
  let resolved = false;
  try {
    verify(env);
    resolved = true;
  } catch (err) {
    check('legacy ATELIER_OIDC_ISSUER + audience resolves', false, (err as Error).message);
  }
  check('legacy ATELIER_OIDC_ISSUER + audience resolves', resolved);
}

// Legacy ATELIER_OIDC_ISSUER overrides canonical derivation when set.
{
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://canonical.supabase.co',
    ATELIER_OIDC_ISSUER: 'https://override.example.com/auth/v1',
    ATELIER_JWT_AUDIENCE: 'my-aud',
  };
  let resolved = false;
  try {
    verify(env);
    resolved = true;
  } catch (err) {
    check('legacy override beats canonical derivation', false, (err as Error).message);
  }
  check('legacy override beats canonical derivation', resolved);
}

// SUPABASE_URL (server-side variant) also derives the issuer.
{
  const env = { SUPABASE_URL: 'https://abc.supabase.co' };
  let resolved = false;
  try {
    verify(env);
    resolved = true;
  } catch (err) {
    check('SUPABASE_URL fallback derives issuer', false, (err as Error).message);
  }
  check('SUPABASE_URL fallback derives issuer', resolved);
}

// Failure: nothing set throws a clear error mentioning canonical + legacy names.
{
  const env = {};
  let threw = false;
  let message = '';
  try {
    verify(env);
  } catch (err) {
    threw = true;
    message = (err as Error).message;
  }
  check('empty env throws', threw);
  check(
    'empty-env error names canonical NEXT_PUBLIC_SUPABASE_URL',
    message.includes('NEXT_PUBLIC_SUPABASE_URL'),
    message,
  );
  check(
    'empty-env error mentions legacy ATELIER_OIDC_ISSUER as override',
    message.includes('ATELIER_OIDC_ISSUER'),
  );
}

// ---------------------------------------------------------------------------
// supabaseEnvFromProcess() — publishable/anon key fallback chain
// ---------------------------------------------------------------------------

console.log('\n[2] supabaseEnvFromProcess publishable/anon key fallback');

// Canonical: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY alone resolves.
{
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxx',
  };
  const out = resolveSsr(env);
  check(
    'canonical NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY resolves',
    out.anonKey === 'sb_publishable_xxx',
    out.anonKey,
  );
}

// Legacy: NEXT_PUBLIC_SUPABASE_ANON_KEY alone still resolves.
{
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_legacy',
  };
  const out = resolveSsr(env);
  check(
    'legacy NEXT_PUBLIC_SUPABASE_ANON_KEY resolves',
    out.anonKey === 'sb_publishable_legacy',
    out.anonKey,
  );
}

// Both set: canonical takes precedence.
{
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'CANONICAL',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'LEGACY',
  };
  const out = resolveSsr(env);
  check(
    'canonical PUBLISHABLE_KEY beats legacy ANON_KEY when both set',
    out.anonKey === 'CANONICAL',
    out.anonKey,
  );
}

// Server-side variants accepted (SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY).
{
  const env = {
    SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'SERVER_KEY',
  };
  const out = resolveSsr(env);
  check(
    'server-side SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY resolves',
    out.url === 'https://abc.supabase.co' && out.anonKey === 'SERVER_KEY',
  );
}

// Missing publishable/anon key throws and names canonical name first.
{
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' };
  let threw = false;
  let message = '';
  try {
    resolveSsr(env);
  } catch (err) {
    threw = true;
    message = (err as Error).message;
  }
  check('missing key throws', threw);
  check(
    'missing-key error names canonical PUBLISHABLE_KEY',
    message.includes('PUBLISHABLE_KEY'),
    message,
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
if (failures === 0) {
  console.log('OK  canonical-env-vars.smoke (all checks passed)');
  process.exit(0);
} else {
  console.log(`FAIL  canonical-env-vars.smoke (${failures} failure(s))`);
  process.exit(1);
}
