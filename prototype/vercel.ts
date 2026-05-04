// Atelier prototype Vercel project configuration.
//
// vercel.ts is the typed config-as-code shape per the 2026-02 Vercel
// knowledge update. The local `VercelConfig` shape mirrors the
// `@vercel/config/v1` interface; we keep it inline rather than importing
// because the package was not yet published on npm at the time this PR
// landed. Flip the import once `@vercel/config` ships and delete the
// local interface.
//
// Atelier's crons (reaper, mirror-delivery, reconcile, triage per ARCH §6.5
// / §7.4 / §8) ship as cron-route handlers in a follow-up PR; the schedules
// are declared here as the contract, route handlers backfill incrementally.
//
// Closes audit F5 (vercel-config baseline missing).

interface VercelConfig {
  framework?: string;
  buildCommand?: string;
  installCommand?: string;
  functions?: Record<string, { maxDuration?: number; memory?: number }>;
  crons?: Array<{ path: string; schedule: string }>;
}

export const config: VercelConfig = {
  buildCommand: 'npm run build',
  framework: 'nextjs',

  // Function timeout pin: the lens reads + observability dashboard fan out
  // to Postgres RPCs that can be slow on cold caches. The 2026-02 platform
  // default is 300s; we explicitly hold to 60s for the lens path so a
  // runaway RPC surfaces as a 504 in observability rather than tying up
  // a worker. /api/mcp keeps the platform default (longer running tool
  // calls).
  functions: {
    'src/app/atelier/**/*': { maxDuration: 60 },
    'src/app/api/mcp/**/*': { maxDuration: 300 },
    'src/app/oauth/api/mcp/**/*': { maxDuration: 300 },
  },

  // Cron stubs. Schedules per ARCH §6.5 / §7.4 / §8. Each requires a
  // `/api/cron/<name>` route handler (follow-up PR; the schedule is the
  // contract, the handler is the implementation).
  crons: [
    // Reaper (ARCH §6.1): sweep stale sessions + release their locks.
    { path: '/api/cron/reaper', schedule: '*/5 * * * *' },
    // Mirror delivery (ARCH §7.4): publish doc/decision events to outbound mirrors.
    { path: '/api/cron/mirror-delivery', schedule: '*/2 * * * *' },
    // Reconcile (ARCH §6.6): re-validate contract changes + classifier signals.
    { path: '/api/cron/reconcile', schedule: '15 * * * *' },
    // Triage (ARCH §6.5.2): poll external integrations for new feedback rows.
    { path: '/api/cron/triage', schedule: '*/10 * * * *' },
  ],
};

export default config;
