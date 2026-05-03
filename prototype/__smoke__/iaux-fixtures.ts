// Deterministic fixture seeding for the IA/UX DOM Playwright suite.
//
// Generates a single project (`iaux-smoke`) with enough rows to exercise
// the rendered DOM beyond the trivial 5-row lens-smoke fixture:
//   - 100 contributions (well above the lens.activeContributions LIMIT
//     of ~20 in default lens config; meaningful "moderate scale")
//   - 50 locks (matches lens.locks LIMIT exactly to assert ceiling holds)
//   - 200 telemetry rows for contributions (drives observability
//     recentTransitions LIMIT 50)
//   - 30 lock telemetry rows (drives observability lockLedger LIMIT 25)
//
// One scale is enough to catch the load-bearing failure modes (does the
// DOM cap at the SQL ceiling? does the renderer stay responsive? is
// recency-first preserved?). Multi-scale (500/5000) sweeps are filed as
// v1.x polish — the marginal failure modes at 5000 are mostly virtualization
// concerns (scroll perf), assertable but not essential to the M7-exit
// gate's "does the substrate behave correctly under realistic data" bar.
//
// Reuses the lens-smoke seeding pattern: trigger-disable for the
// append-only decisions table cascade delete, project-scoped cleanup.

import { Client } from 'pg';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export const IAUX_PROJECT_ID = '99999999-1111-1111-1111-111111111111';
export const IAUX_ANALYST_ID = '99999999-2222-2222-2222-aaaaaaaaaaaa';
export const IAUX_DEV_ID = '99999999-2222-2222-2222-bbbbbbbbbbbb';
export const IAUX_PM_ID = '99999999-2222-2222-2222-cccccccccccc';
export const IAUX_DESIGNER_ID = '99999999-2222-2222-2222-dddddddddddd';
export const IAUX_TERRITORY_ID = '99999999-3333-3333-3333-aaaaaaaaaaaa';

export const IAUX_ANALYST_BEARER = 'stub:sub-iaux-smoke-analyst';
export const IAUX_DEV_BEARER = 'stub:sub-iaux-smoke-dev';
export const IAUX_PM_BEARER = 'stub:sub-iaux-smoke-pm';

const CONTRIBUTION_COUNT = 100;
const LOCK_COUNT = 50;
const CONTRIB_TELEMETRY_COUNT = 200;
const LOCK_TELEMETRY_COUNT = 30;

const KINDS = ['implementation', 'research', 'design'] as const;
const STATES = ['open', 'claimed', 'plan_review', 'in_progress', 'review'] as const;

async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function seedIauxFixtures(): Promise<void> {
  await withDb(async (client) => {
    // Cleanup first (idempotent re-runs).
    await cleanup(client);

    await client.query(
      `INSERT INTO projects (id, name, repo_url, template_version)
       VALUES ($1, 'iaux-smoke', 'https://example.invalid/iaux', '1.0')`,
      [IAUX_PROJECT_ID],
    );

    // Analyst is access_level=admin so the same bearer can open both the
    // analyst lens AND the admin-gated observability dashboard. Splitting
    // bearers per-test would require a per-test webServer restart.
    await client.query(
      `INSERT INTO composers (id, project_id, email, display_name, discipline, access_level, identity_subject)
       VALUES ($1, $2, 'analyst@iaux.invalid', 'IA/UX Analyst',  'analyst', 'admin',  'sub-iaux-smoke-analyst'),
              ($3, $2, 'dev@iaux.invalid',     'IA/UX Dev',      'dev',     'member', 'sub-iaux-smoke-dev'),
              ($4, $2, 'pm@iaux.invalid',      'IA/UX PM',       'pm',      'member', 'sub-iaux-smoke-pm'),
              ($5, $2, 'designer@iaux.invalid','IA/UX Designer', 'designer','member', 'sub-iaux-smoke-designer')`,
      [IAUX_ANALYST_ID, IAUX_PROJECT_ID, IAUX_DEV_ID, IAUX_PM_ID, IAUX_DESIGNER_ID],
    );

    await client.query(
      `INSERT INTO territories (id, project_id, name, owner_role, review_role, scope_kind, scope_pattern, requires_plan_review)
       VALUES ($1, $2, 'iaux-territory', 'dev', 'pm', 'files', ARRAY['scripts/iaux/**'], false)`,
      [IAUX_TERRITORY_ID, IAUX_PROJECT_ID],
    );

    // Contributions — staggered timestamps so default-view recency ordering
    // is unambiguous. Most-recent contribution (i=0) gets timestamp
    // `now() - 1 minute`; earlier indices get progressively older. The test
    // asserts the i=0 row appears first in the rendered list.
    const composers = [IAUX_ANALYST_ID, IAUX_DEV_ID, IAUX_PM_ID, IAUX_DESIGNER_ID];
    const contribValues: string[] = [];
    const contribParams: unknown[] = [];
    for (let i = 0; i < CONTRIBUTION_COUNT; i += 1) {
      const kind = KINDS[i % KINDS.length]!;
      const state = STATES[i % STATES.length]!;
      const composer = composers[i % composers.length]!;
      const idx = i * 9;
      const minutesOld = i + 1;
      contribValues.push(
        `($${idx + 1}::uuid, $${idx + 2}::uuid, NULL, ARRAY[$${idx + 3}::text], $${idx + 4}::uuid, ARRAY[$${idx + 5}::text], $${idx + 6}::contribution_state, $${idx + 7}::contribution_kind, false, $${idx + 8}, now() - ($${idx + 9}::int * interval '1 minute'), now() - ($${idx + 9}::int * interval '1 minute'))`,
      );
      contribParams.push(
        IAUX_PROJECT_ID,
        composer,
        `US-IAUX.${i + 1}`,
        IAUX_TERRITORY_ID,
        `scripts/iaux/${kind}-${i + 1}.ts`,
        state,
        kind,
        `scripts/iaux/${kind}-${i + 1}.ts`,
        minutesOld,
      );
    }
    await client.query(
      `INSERT INTO contributions
         (project_id, author_composer_id, author_session_id, trace_ids, territory_id, artifact_scope,
          state, kind, requires_owner_approval, content_ref, created_at, updated_at)
       VALUES ${contribValues.join(', ')}`,
      contribParams,
    );

    // Locks — need a contribution and the holder composer's session.
    const { rows: contribIds } = await client.query<{ id: string }>(
      `SELECT id FROM contributions WHERE project_id = $1 ORDER BY updated_at DESC LIMIT $2`,
      [IAUX_PROJECT_ID, LOCK_COUNT],
    );

    // Two sessions for presence-panel coverage.
    await client.query(
      `INSERT INTO sessions (project_id, composer_id, surface, agent_client, status, heartbeat_at)
       VALUES ($1::uuid, $2::uuid, 'web', 'claude.ai',   'active', now() - interval '1 minute'),
              ($1::uuid, $3::uuid, 'ide', 'claude-code', 'active', now())`,
      [IAUX_PROJECT_ID, IAUX_DEV_ID, IAUX_ANALYST_ID],
    );

    const lockValues: string[] = [];
    const lockParams: unknown[] = [];
    for (let i = 0; i < contribIds.length; i += 1) {
      const cid = contribIds[i]!.id;
      const idx = i * 6;
      lockValues.push(
        `($${idx + 1}::uuid, $${idx + 2}::uuid, $${idx + 3}::uuid, ARRAY[$${idx + 4}::text], $${idx + 5}::bigint, now() - ($${idx + 6}::int * interval '30 seconds'))`,
      );
      lockParams.push(IAUX_PROJECT_ID, IAUX_DEV_ID, cid, `scripts/iaux/lock-${i + 1}.ts`, i + 1, i + 1);
    }
    if (lockValues.length > 0) {
      await client.query(
        `INSERT INTO locks (project_id, holder_composer_id, contribution_id, artifact_scope, fencing_token, acquired_at)
         VALUES ${lockValues.join(', ')}`,
        lockParams,
      );
    }

    // Telemetry — contribution transitions (drives recentTransitions LIMIT 50).
    const txValues: string[] = [];
    const txParams: unknown[] = [];
    for (let i = 0; i < CONTRIB_TELEMETRY_COUNT; i += 1) {
      const composer = composers[i % composers.length]!;
      const idx = i * 3;
      txValues.push(
        `($${idx + 1}::uuid, $${idx + 2}::uuid, 'contribution.claimed', 'success', '{}'::jsonb, now() - ($${idx + 3}::int * interval '1 minute'))`,
      );
      txParams.push(IAUX_PROJECT_ID, composer, i + 1);
    }
    await client.query(
      `INSERT INTO telemetry (project_id, composer_id, action, outcome, metadata, created_at)
       VALUES ${txValues.join(', ')}`,
      txParams,
    );

    // Telemetry — lock acquired/released (drives lockLedger LIMIT 25).
    const lockTelemetryValues: string[] = [];
    const lockTelemetryParams: unknown[] = [];
    for (let i = 0; i < LOCK_TELEMETRY_COUNT; i += 1) {
      const composer = i % 2 === 0 ? IAUX_DEV_ID : IAUX_ANALYST_ID;
      const action = i % 2 === 0 ? 'lock.acquired' : 'lock.released';
      const idx = i * 4;
      lockTelemetryValues.push(
        `($${idx + 1}::uuid, $${idx + 2}::uuid, $${idx + 3}, 'success', '{}'::jsonb, now() - ($${idx + 4}::int * interval '30 seconds'))`,
      );
      lockTelemetryParams.push(IAUX_PROJECT_ID, composer, action, i + 1);
    }
    await client.query(
      `INSERT INTO telemetry (project_id, composer_id, action, outcome, metadata, created_at)
       VALUES ${lockTelemetryValues.join(', ')}`,
      lockTelemetryParams,
    );
  });
}

export async function cleanupIauxFixtures(): Promise<void> {
  await withDb(cleanup);
}

async function cleanup(client: Client): Promise<void> {
  await client.query(`ALTER TABLE decisions DISABLE TRIGGER decisions_block_delete`);
  try {
    await client.query(`DELETE FROM projects WHERE id = $1 OR name = 'iaux-smoke'`, [
      IAUX_PROJECT_ID,
    ]);
  } finally {
    await client.query(`ALTER TABLE decisions ENABLE TRIGGER decisions_block_delete`);
  }
}

// CLI entrypoint when invoked directly: seed and exit.
if (process.argv[1] && process.argv[1].endsWith('iaux-fixtures.ts')) {
  const action = process.argv[2] ?? 'seed';
  const main = action === 'cleanup' ? cleanupIauxFixtures : seedIauxFixtures;
  main()
    .then(() => {
      console.log(`iaux-fixtures: ${action} complete`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`iaux-fixtures: ${action} failed:`, err);
      process.exit(1);
    });
}
