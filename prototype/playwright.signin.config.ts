// Playwright config for the sign-in DOM smoke (D7).
//
// Distinct from playwright.config.ts (iaux DOM smoke) because the
// signin path needs the OPPOSITE env shape:
//
//   iaux  : ATELIER_DEV_BEARER set, ATELIER_OIDC_ISSUER='' -> stubVerifier
//   signin: ATELIER_OIDC_ISSUER=<local-supabase-auth>, no dev bearer
//           -> jwksVerifierFromEnv (real JWKS validation against the
//              Supabase Auth running locally; SAME code path the
//              production deploy uses).
//
// Both configs target port 3030. reuseExistingServer:false here so the
// suite always spawns a fresh dev server with the right env shape; if
// iaux left a server up, Playwright's webServer manager will kill it
// before spawning. Run iaux and signin serially, not in parallel.
//
// Local prerequisites (documented in
// docs/user/guides/sign-in-magic-links.md):
//   1. supabase start (Auth + DB + Mailpit at 54321 / 54322 / 54324)
//   2. eval "$(supabase status -o env)" so SUPABASE_* env vars are set
//   3. npm run smoke:sign-in:dom

import { defineConfig } from '@playwright/test';

const PORT = 3030;

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.API_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.ANON_KEY ??
  '';

if (!SUPABASE_ANON_KEY) {
  throw new Error(
    'SUPABASE_ANON_KEY (or ANON_KEY) must be set so the sign-in form can reach Supabase Auth. ' +
      'Run: eval "$(supabase status -o env)" before `npm run smoke:sign-in:dom`.',
  );
}

export default defineConfig({
  testDir: './__smoke__',
  testMatch: ['sign-in.dom.spec.ts'],
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  webServer: {
    command: 'npm run dev',
    url: `http://127.0.0.1:${PORT}/`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      // Real JWKS verification against local Supabase Auth -- same path
      // the production deploy uses (jwksVerifierFromEnv -> createJwksVerifier).
      ATELIER_OIDC_ISSUER: `${SUPABASE_URL}/auth/v1`,
      ATELIER_JWT_AUDIENCE: 'authenticated',
      // Explicitly empty so resolveVerifier() does NOT take the stub path.
      ATELIER_DEV_BEARER: '',
      ATELIER_DATASTORE_URL:
        process.env.DATABASE_URL ??
        'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    },
  },
});
