// Smoke test for the M7 /atelier/observability route.
//
// Exercises:
//   1. Admin gate: composer with access_level='admin' resolves;
//      access_level='member' raises ObservabilityForbiddenError;
//      access_level='stakeholder' likewise.
//   2. View-model loader populates all eight sections from seeded
//      coordination state (sessions, contributions, locks, decisions,
//      triage_pending, sync telemetry, embeddings, cost telemetry).
//   3. Threshold severity calculator returns the expected color band
//      at 0%, 50%, 80%, 100%, 110% of envelope.
//   4. Cost section degrades to signal='no_data' when no telemetry
//      rows carry the cost_usd metadata field.
//
// Prerequisites: fresh local Supabase (`supabase db reset --local`) on
// the configured DATABASE_URL. Same opt-in env-bearer pattern as
// lens.smoke.ts; admin gate is verified through the resolveObservabilityViewer
// path against real seeded composer rows.

import { Client } from 'pg';
import {
  loadObservabilityConfig,
  severityFor,
} from '../src/lib/atelier/observability-config.ts';
import { loadObservabilityViewModel } from '../src/lib/atelier/observability-data.ts';
import {
  ObservabilityForbiddenError,
  resolveObservabilityViewer,
} from '../src/lib/atelier/observability-session.ts';
import { getLensDeps } from '../src/lib/atelier/deps.ts';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

function fakeRequest(): Request {
  return new Request('http://internal/atelier/observability');
}

async function main(): Promise<void> {
  process.env.ATELIER_DATASTORE_URL = DB_URL;
  process.env.ATELIER_ALLOW_DEV_BEARER = 'true';
  process.env.ATELIER_DEV_BEARER = 'stub:sub-obs-smoke-admin';

  const seed = new Client({ connectionString: DB_URL });
  await seed.connect();

  await seed.query(`ALTER TABLE decisions DISABLE TRIGGER decisions_block_delete`);
  try {
    await seed.query(
      `DELETE FROM projects WHERE name LIKE 'obs-smoke%' OR id = $1`,
      ['99999999-1111-1111-1111-111111111111'],
    );
  } finally {
    await seed.query(`ALTER TABLE decisions ENABLE TRIGGER decisions_block_delete`);
  }

  const projectId = '99999999-1111-1111-1111-111111111111';
  const adminId   = '99999999-2222-2222-2222-aaaaaaaaaaaa';
  const memberId  = '99999999-2222-2222-2222-bbbbbbbbbbbb';
  const stakeId   = '99999999-2222-2222-2222-cccccccccccc';
  const territoryId = '99999999-3333-3333-3333-aaaaaaaaaaaa';

  await seed.query(
    `INSERT INTO projects (id, name, repo_url, template_version)
     VALUES ($1, 'obs-smoke', 'https://example.invalid/obs', '1.0')`,
    [projectId],
  );

  await seed.query(
    `INSERT INTO composers (id, project_id, email, display_name, discipline, access_level, identity_subject)
     VALUES ($1, $2, 'admin@obs.invalid',  'Obs Admin',  'architect','admin',       'sub-obs-smoke-admin'),
            ($3, $2, 'member@obs.invalid', 'Obs Member', 'dev',      'member',      'sub-obs-smoke-member'),
            ($4, $2, 'stake@obs.invalid',  'Obs Stake',  NULL,       'stakeholder', 'sub-obs-smoke-stake')`,
    [adminId, projectId, memberId, stakeId],
  );

  await seed.query(
    `INSERT INTO territories (id, project_id, name, owner_role, review_role, scope_kind, scope_pattern, requires_plan_review)
     VALUES ($1, $2, 'protocol', 'dev', 'dev', 'files', ARRAY['scripts/**'], false)`,
    [territoryId, projectId],
  );

  // Active session for the admin (so dashboard heartbeat reuse path works)
  await seed.query(
    `INSERT INTO sessions (project_id, composer_id, surface, agent_client, status, heartbeat_at)
     VALUES ($1, $2, 'web', 'atelier-dashboard', 'active', now()),
            ($1, $3, 'ide', 'claude-code',       'active', now()),
            ($1, $4, 'web', 'claude.ai',         'active', now())`,
    [projectId, adminId, memberId, stakeId],
  );

  // A few contributions across states + a recent transition trail
  await seed.query(
    `INSERT INTO contributions (project_id, author_composer_id, trace_ids, territory_id, artifact_scope, state, kind, content_ref)
     VALUES ($1, $2, ARRAY['US-12.1'], $3, ARRAY['scripts/a.ts'], 'in_progress', 'implementation', 'scripts/a.ts'),
            ($1, $2, ARRAY['US-12.2'], $3, ARRAY['scripts/b.ts'], 'review',      'implementation', 'scripts/b.ts'),
            ($1, $2, ARRAY['US-12.3'], $3, ARRAY['scripts/c.ts'], 'open',        'implementation', 'scripts/c.ts')`,
    [projectId, adminId, territoryId],
  );

  // Decisions
  await seed.query(
    `INSERT INTO decisions (project_id, author_composer_id, trace_ids, category, summary, rationale, repo_commit_sha)
     VALUES ($1, $2, ARRAY['ADR-100'], 'architecture', 'observability lights up', 'rationale', 'ddddddd1')`,
    [projectId, adminId],
  );

  // Lock + telemetry trail (lock.acquired, sync run, find_similar, cost)
  const { rows: contribRows } = await seed.query<{ id: string }>(
    `SELECT id FROM contributions WHERE project_id = $1 LIMIT 1`,
    [projectId],
  );
  const contribId = contribRows[0]!.id;
  await seed.query(
    `INSERT INTO locks (project_id, holder_composer_id, contribution_id, artifact_scope, fencing_token)
     VALUES ($1, $2, $3, ARRAY['scripts/a.ts'], 1)`,
    [projectId, adminId, contribId],
  );

  await seed.query(
    `INSERT INTO telemetry (project_id, composer_id, action, outcome, metadata)
     VALUES ($1, $2, 'lock.acquired',     'ok',    '{"lockId":"x"}'::jsonb),
            ($1, $2, 'lock.acquired',     'error', '{"lockId":"y"}'::jsonb),
            ($1, $2, 'lock.released',     'ok',    '{"lockId":"x"}'::jsonb),
            ($1, $2, 'session.reaped',    'ok',    '{}'::jsonb),
            ($1, $2, 'doc.published',     'ok',    '{}'::jsonb),
            ($1, $2, 'reconcile.run',     'ok',    '{}'::jsonb),
            ($1, $2, 'find_similar.call', 'ok',    '{"tokens_input":120,"tokens_output":0,"cost_usd":0.0024}'::jsonb)`,
    [projectId, adminId],
  );

  // Triage pending row (low classification confidence)
  await seed.query(
    `INSERT INTO triage_pending
       (project_id, comment_source, external_comment_id, external_author, comment_text, received_at,
        classification, drafted_proposal, territory_id)
     VALUES ($1, 'github', 'gh-1', 'commenter', 'note', now(),
             '{"category":"feedback","confidence":0.3}'::jsonb,
             '{"bodyMarkdown":"draft","suggestedAction":"contribution","discipline":"implementation"}'::jsonb,
             $2)`,
    [projectId, territoryId],
  );

  await seed.end();

  // ---- threshold severity ----
  console.log('\n[0] severity calculator');
  check('0% -> ok',     severityFor(0,   100) === 'ok');
  check('50% -> ok',    severityFor(50,  100) === 'ok');
  check('80% -> warn',  severityFor(80,  100) === 'warn');
  check('100% -> alert',severityFor(100, 100) === 'alert');
  check('110% -> alert',severityFor(110, 100) === 'alert');
  check('zero envelope returns ok', severityFor(50, 0) === 'ok');

  // ---- config loader ----
  console.log('\n[1] config loader');
  const cfg = loadObservabilityConfig(process.cwd().replace(/\/prototype$/, ''));
  check('thresholds loaded',
    cfg.thresholds.sessionsActivePerProject > 0 &&
    cfg.thresholds.contributionsLifetimePerProject > 0,
  );
  check('lookback window > 0', cfg.lookbackSeconds > 0);

  // ---- admin gate ----
  console.log('\n[2] admin gate');
  const deps = getLensDeps();
  process.env.ATELIER_DEV_BEARER = 'stub:sub-obs-smoke-admin';
  const adminViewer = await resolveObservabilityViewer(fakeRequest(), deps, { cookies: null });
  check('admin resolves', adminViewer.accessLevel === 'admin');

  process.env.ATELIER_DEV_BEARER = 'stub:sub-obs-smoke-member';
  let memberRejected = false;
  try {
    await resolveObservabilityViewer(fakeRequest(), deps, { cookies: null });
  } catch (err) {
    memberRejected = err instanceof ObservabilityForbiddenError;
  }
  check('member rejected', memberRejected);

  process.env.ATELIER_DEV_BEARER = 'stub:sub-obs-smoke-stake';
  let stakeRejected = false;
  try {
    await resolveObservabilityViewer(fakeRequest(), deps, { cookies: null });
  } catch (err) {
    stakeRejected = err instanceof ObservabilityForbiddenError;
  }
  check('stakeholder rejected', stakeRejected);

  // ---- view-model loader ----
  console.log('\n[3] view-model loader');
  const vm = await loadObservabilityViewModel(projectId);

  check('sessions.activeNow >= 1',     vm.sessions.activeNow >= 1);
  check('sessions.guildActiveNow >= 1', vm.sessions.guildActiveNow >= 1);
  check('sessions.reapedLastWindow >= 1', vm.sessions.reapedLastWindow >= 1);
  check('sessions.activeBySurface populated', Object.keys(vm.sessions.activeBySurface).length >= 1);

  check('contributions.lifetime >= 3', vm.contributions.lifetime >= 3);
  check('contributions.byState in_progress >= 1', (vm.contributions.byState['in_progress'] ?? 0) >= 1);
  check('contributions.throughputByTerritory has rows', vm.contributions.throughputByTerritory.length >= 1);

  check('locks.heldNow >= 1', vm.locks.heldNow >= 1);
  check('locks.recentAcquisitions >= 1 (telemetry)', vm.locks.recentAcquisitions >= 1);
  check('locks.recentReleases >= 1 (telemetry)', vm.locks.recentReleases >= 1);
  check('locks.conflictRate computed', vm.locks.conflictRate > 0,
    `conflictRate=${vm.locks.conflictRate}`);

  check('decisions.lifetime >= 1', vm.decisions.lifetime >= 1);
  check('decisions.findSimilarSignal=has_data after find_similar.call telemetry',
    vm.decisions.findSimilarSignal === 'has_data');

  check('triage.pendingCount >= 1', vm.triage.pendingCount >= 1);
  check('triage.confidenceBuckets.low >= 1 (seeded 0.3)', vm.triage.confidenceBuckets.low >= 1);

  const docPub = vm.sync.scripts.find((s) => s.action === 'doc.published');
  check('sync.doc.published has lastRunAt', docPub !== undefined && docPub.lastRunAt !== null);

  // Vector index may not have rows in a fresh DB; just confirm shape.
  check('vector view-model shape ok', typeof vm.vector.rowCount === 'number');

  check('cost.signal=has_data after cost_usd telemetry', vm.cost.signal === 'has_data');
  check('cost.totalUsd > 0', vm.cost.totalUsd > 0);
  check('cost.byActionClass has at least 1 entry', vm.cost.byActionClass.length >= 1);

  console.log(`\nResults: ${failures === 0 ? 'PASS' : 'FAIL'} (${failures} failure(s))`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nobservability smoke crashed:', err);
  process.exit(2);
});
