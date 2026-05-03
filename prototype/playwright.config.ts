// Playwright config for the IA/UX DOM smoke (M7-exit gate, DOM layer).
//
// Spins up the prototype dev server with the dev-bearer auth bypass set
// to a fixtures-seeded composer subject, then runs the spec against
// http://localhost:3030/atelier. Single worker because the suite shares
// one fixture set (parallel would race on cleanup).
//
// Local dev only; CI integration deferred until local stability is proven.

import { defineConfig } from '@playwright/test';

const PORT = 3030;

export default defineConfig({
  testDir: './__smoke__',
  testMatch: ['iaux.dom.spec.ts'],
  timeout: 30_000,
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
    // Use the root route as the readiness probe; /atelier requires auth and
    // would race against the beforeAll fixture seed if used as the gate.
    url: `http://127.0.0.1:${PORT}/`,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: {
      // Auth bypass: route requests with this bearer to the seeded
      // composer subject. The fixture seeder creates the matching row.
      // Empty OIDC vars override .env.local so resolveVerifier() picks
      // stubVerifier instead of the JWKS path (which would reject
      // "stub:..." as an invalid JWS).
      ATELIER_ALLOW_DEV_BEARER: 'true',
      ATELIER_DEV_BEARER: 'stub:sub-iaux-smoke-analyst',
      ATELIER_OIDC_ISSUER: '',
      ATELIER_JWT_AUDIENCE: '',
      ATELIER_DATASTORE_URL:
        process.env.DATABASE_URL ??
        'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      // Local Supabase URL + anon key required by the broadcast client
      // island (supabase-browser.ts) and the SSR cookie adapter. The
      // local-dev Supabase anon key is a public well-known JWT (Supabase
      // ships the same one with every `supabase start` install) — safe
      // to commit to a test config since it only authenticates against
      // a developer's local Postgres. Tests don't actually depend on
      // Realtime delivering events; they just need the islands not to
      // throw on hydration.
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
    },
  },
});
