// Smoke test for the M3 /atelier lens substrate.
//
// Exercises:
//   1. Each of the five lens configs returns a view-model populated from
//      the canonical state slice + lens-augmenting queries.
//   2. Lens-appropriate panels are present in config.panels per ADR-017 +
//      NORTH-STAR section 4.
//   3. Lens-appropriate affordances: write surfaces present for the four
//      authoring lenses; absent (canWrite=false) for stakeholder.
//   4. Per-lens kind-weight ordering is reflected in activeContributions:
//      analyst weights research; dev weights implementation; designer
//      weights design; pm + stakeholder uniform.
//   5. Presence indicators show seeded sessions; locks show seeded locks;
//      contracts show seeded contracts; review_queue shows contributions
//      whose territory.review_role matches the viewer's discipline.
//   6. defaultLensFor maps disciplines + access_level correctly.
//   7. Auth failure paths: no bearer -> reason=no_bearer; bearer with
//      a sub that no composer maps to -> reason=no_composer (D7
//      differentiated this from invalid_bearer so the user-facing
//      LensUnauthorized state can render an actionable "ask your admin
//      to invite you" message instead of a generic diagnostic).
//
// Lives at prototype/__smoke__/ rather than prototype/src/ so Next.js does
// not include it in the build. Import paths reach into prototype/src for
// the lens substrate. The smoke only exercises the data layer; UI render
// is verified by the manual /atelier walk-through documented in the M3-
// exit notes (a CSS-modules-aware renderer outside Next is too brittle
// for a smoke gate).
//
// Prerequisites: fresh local Supabase (`supabase db reset --local`) on
// the configured DATABASE_URL.

import { Client } from 'pg';
import {
  defaultLensFor,
  LENS_IDS,
  LENS_CONFIGS,
  type LensId,
} from '../src/lib/atelier/lens-config.ts';
import { loadLensViewModel } from '../src/lib/atelier/lens-data.ts';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

function fakeRequest(lensId: LensId): Request {
  return new Request(`http://internal/atelier/${lensId}`);
}

async function main(): Promise<void> {
  // Configure deps for stub-verifier mode before any module reads it.
  // ATELIER_ALLOW_DEV_BEARER must be set explicitly per session.ts:resolveBearer
  // to opt into the stub-bearer fallback (real deployments never set this).
  process.env.ATELIER_DATASTORE_URL = DB_URL;
  process.env.ATELIER_ALLOW_DEV_BEARER = 'true';
  process.env.ATELIER_DEV_BEARER = 'stub:sub-lens-smoke-analyst';

  // ---- seed ----
  const seed = new Client({ connectionString: DB_URL });
  await seed.connect();
  // Reset prior runs. The decisions table has an append-only delete-blocking
  // trigger (ADR-005 / ARCH 7.6); we disable just that trigger for the
  // cascade DELETE so FK constraints still fire (session_replication_role=
  // replica would also bypass cascades, leaving orphan composer/territory
  // rows). This is a smoke-test-only escape; real operators never DELETE
  // decisions.
  await seed.query(`ALTER TABLE decisions DISABLE TRIGGER decisions_block_delete`);
  try {
    await seed.query(`DELETE FROM projects WHERE name LIKE 'lens-smoke%' OR id = $1`, [
      '88888888-1111-1111-1111-111111111111',
    ]);
  } finally {
    await seed.query(`ALTER TABLE decisions ENABLE TRIGGER decisions_block_delete`);
  }

  const projectId    = '88888888-1111-1111-1111-111111111111';
  const analystId    = '88888888-2222-2222-2222-aaaaaaaaaaaa';
  const devId        = '88888888-2222-2222-2222-bbbbbbbbbbbb';
  const pmId         = '88888888-2222-2222-2222-cccccccccccc';
  const designerId   = '88888888-2222-2222-2222-dddddddddddd';
  const stakeholderId= '88888888-2222-2222-2222-eeeeeeeeeeee';
  const archId       = '88888888-2222-2222-2222-ffffffffffff';
  const stratResId   = '88888888-3333-3333-3333-aaaaaaaaaaaa';
  const protocolId   = '88888888-3333-3333-3333-bbbbbbbbbbbb';
  const designId     = '88888888-3333-3333-3333-dddddddddddd';

  await seed.query(
    `INSERT INTO projects (id, name, repo_url, template_version)
     VALUES ($1, 'lens-smoke', 'https://example.invalid/lens', '1.0')`,
    [projectId],
  );

  await seed.query(
    `INSERT INTO composers (id, project_id, email, display_name, discipline, access_level, identity_subject)
     VALUES ($1, $2, 'analyst@lens.invalid',     'Analyst Ana',     'analyst',  'member',      'sub-lens-smoke-analyst'),
            ($3, $2, 'dev@lens.invalid',         'Dev Dee',         'dev',      'member',      'sub-lens-smoke-dev'),
            ($4, $2, 'pm@lens.invalid',          'PM Pat',          'pm',       'member',      'sub-lens-smoke-pm'),
            ($5, $2, 'designer@lens.invalid',    'Designer Des',    'designer', 'member',      'sub-lens-smoke-designer'),
            ($6, $2, 'stakeholder@lens.invalid', 'Stakeholder Sam', NULL,       'stakeholder', 'sub-lens-smoke-stakeholder'),
            ($7, $2, 'arch@lens.invalid',        'Architect Arc',   'architect','member',      'sub-lens-smoke-arch')`,
    [analystId, projectId, devId, pmId, designerId, stakeholderId, archId],
  );

  await seed.query(
    `INSERT INTO territories (id, project_id, name, owner_role, review_role, scope_kind, scope_pattern, requires_plan_review)
     VALUES ($1, $2, 'strategy-research', 'analyst',  'pm',       'research_artifact', ARRAY['research/**/*'], false),
            ($3, $2, 'protocol',          'dev',      'dev',      'files',             ARRAY['scripts/**'],    false),
            ($4, $2, 'prototype-design',  'designer', 'designer', 'design_component',  ARRAY['prototype/src/components/**'], false)`,
    [stratResId, projectId, protocolId, designId],
  );

  // Contributions across kinds + states
  await seed.query(
    `INSERT INTO contributions
       (project_id, author_composer_id, author_session_id, trace_ids, territory_id, artifact_scope,
        state, kind, requires_owner_approval, content_ref)
     VALUES
       ($1, $2, NULL, ARRAY['US-1.3'], $3, ARRAY['research/comp.md'],   'in_progress', 'research',       false, 'research/competitive.md'),
       ($1, $2, NULL, ARRAY['US-1.4'], $3, ARRAY['research/red.md'],    'review',      'research',       false, 'research/red-team.md'),
       ($1, $4, NULL, ARRAY['US-2.9'], $5, ARRAY['scripts/sync.ts'],    'claimed',     'implementation', false, 'scripts/sync.ts'),
       ($1, $4, NULL, ARRAY['US-2.1'], $5, ARRAY['scripts/lock.ts'],    'in_progress', 'implementation', false, 'scripts/lock.ts'),
       ($1, $6, NULL, ARRAY['US-3.3'], $7, ARRAY['prototype/src/components/Btn.tsx'], 'review', 'design', true,  'prototype/src/components/Button.tsx')
    `,
    [projectId, analystId, stratResId, devId, protocolId, designerId, designId],
  );

  // Decisions
  await seed.query(
    `INSERT INTO decisions
       (project_id, author_composer_id, trace_ids, category, summary, rationale, repo_commit_sha)
     VALUES
       ($1, $2, ARRAY['US-1.3'], 'research', 'Competitive deploy patterns favor self-host', 'rationale', 'aaaaaaa1'),
       ($1, $3, ARRAY['US-2.9'], 'architecture', 'Fencing tokens monotonic per project', 'rationale', 'bbbbbbb1'),
       ($1, $4, ARRAY['US-3.3'], 'design', 'Tertiary button variant uses token-driven styling', 'rationale', 'ccccccc1')`,
    [projectId, analystId, devId, designerId],
  );

  // Sessions (presence)
  await seed.query(
    `INSERT INTO sessions (project_id, composer_id, surface, agent_client, status, heartbeat_at)
     VALUES ($1, $2, 'web', 'claude.ai',     'active', now() - interval '2 minutes'),
            ($1, $3, 'ide', 'claude-code',   'active', now() - interval '1 minute'),
            ($1, $4, 'web', 'claude.ai',     'active', now())`,
    [projectId, analystId, devId, designerId],
  );

  // Locks (need a contribution + session for the lock holder)
  const { rows: contribRows } = await seed.query<{ id: string }>(
    `SELECT id FROM contributions WHERE project_id = $1 AND kind = 'implementation' ORDER BY created_at LIMIT 1`,
    [projectId],
  );
  const lockContribId = contribRows[0]!.id;
  await seed.query(
    `INSERT INTO locks (project_id, holder_composer_id, contribution_id, artifact_scope, fencing_token)
     VALUES ($1, $2, $3, ARRAY['scripts/sync.ts'], 1),
            ($1, $2, $3, ARRAY['scripts/lock.ts'], 2)`,
    [projectId, devId, lockContribId],
  );

  // Contracts (territory has to exist and contracts table has FK)
  await seed.query(
    `INSERT INTO contracts (project_id, territory_id, name, schema, version, classifier_decision)
     VALUES ($1, $2, 'design_tokens',     '{"v":1}'::jsonb, 1, 'additive'),
            ($1, $2, 'component_variants','{"v":1}'::jsonb, 1, 'breaking')`,
    [projectId, designId],
  );

  await seed.end();

  // ---- defaultLensFor mapping ----
  console.log('\n[0] defaultLensFor mapping');
  check('analyst -> analyst', defaultLensFor({ discipline: 'analyst' }) === 'analyst');
  check('dev -> dev', defaultLensFor({ discipline: 'dev' }) === 'dev');
  check('architect -> dev (closes territories.yaml architect-discipline gap)', defaultLensFor({ discipline: 'architect' }) === 'dev');
  check('pm -> pm', defaultLensFor({ discipline: 'pm' }) === 'pm');
  check('designer -> designer', defaultLensFor({ discipline: 'designer' }) === 'designer');
  check('access_level=stakeholder overrides discipline', defaultLensFor({ discipline: 'analyst', accessLevel: 'stakeholder' }) === 'stakeholder');
  check('null discipline -> analyst fallback', defaultLensFor({ discipline: null }) === 'analyst');

  // ---- per-lens view-model ----
  for (const lensId of LENS_IDS) {
    console.log(`\n[lens:${lensId}] view-model assertions`);
    process.env.ATELIER_DEV_BEARER = `stub:sub-lens-smoke-${lensId === 'dev' ? 'dev' : lensId}`;
    const result = await loadLensViewModel(lensId, fakeRequest(lensId), { cookies: null });
    if (!result.ok) {
      check(`load ok`, false, `reason=${result.reason}: ${result.message}`);
      continue;
    }
    const vm = result.viewModel;
    const cfg = LENS_CONFIGS[lensId];

    check('config.id matches lensId', vm.config.id === lensId);
    check('viewer.composerName populated', typeof vm.viewer.composerName === 'string' && vm.viewer.composerName.length > 0);
    check('charter has CLAUDE.md', vm.charter.paths.includes('CLAUDE.md'));
    check('recentDecisions includes seeded entries', vm.recentDecisions.direct.length >= 3);
    check('contributionsByState contains in_progress', (vm.contributionsByState['in_progress'] ?? 0) >= 1);
    check('activeContributions populated', vm.activeContributions.length >= 1);
    check('presence has at least 1 active session', vm.presence.length >= 1);

    // Per-lens panel composition
    if (lensId === 'analyst') {
      check('analyst panels include find_similar', cfg.panels.includes('find_similar'));
      check('analyst panels include review_queue', cfg.panels.includes('review_queue'));
      check('analyst weights research highest', cfg.depth.contributionsKindWeights.research === 3);
      check('analyst canWrite=true', cfg.affordances.canWrite === true);
      // First active contribution should be a research kind (weights research:3)
      check(
        'analyst first active contribution is research kind',
        vm.activeContributions[0]?.kind === 'research',
        `actual: ${vm.activeContributions[0]?.kind}`,
      );
    }
    if (lensId === 'dev') {
      check('dev panels include locks', cfg.panels.includes('locks'));
      check('dev panels include contracts', cfg.panels.includes('contracts'));
      check('dev weights implementation highest', cfg.depth.contributionsKindWeights.implementation === 3);
      check('dev locks present', vm.locks.length >= 2);
      check(
        'dev first active contribution is implementation kind',
        vm.activeContributions[0]?.kind === 'implementation',
        `actual: ${vm.activeContributions[0]?.kind}`,
      );
    }
    if (lensId === 'pm') {
      check('pm panels include review_queue', cfg.panels.includes('review_queue'));
      check('pm canTriage=true', cfg.affordances.canTriage === true);
      check('pm weights uniform', cfg.depth.contributionsKindWeights.implementation === 1 && cfg.depth.contributionsKindWeights.research === 1);
      // PM is review_role for strategy-research; a contribution in state=review there should appear in reviewQueue
      check(
        'pm reviewQueue includes strategy-research review',
        vm.reviewQueue.some((q) => q.territoryName === 'strategy-research'),
      );
    }
    if (lensId === 'designer') {
      check('designer panels include feedback_queue', cfg.panels.includes('feedback_queue'));
      check('designer panels include contracts', cfg.panels.includes('contracts'));
      check('designer weights design highest', cfg.depth.contributionsKindWeights.design === 3);
      check('designer contracts include design_tokens', vm.contracts.some((c) => c.name === 'design_tokens'));
      check(
        'designer reviewQueue includes prototype-design review',
        vm.reviewQueue.some((q) => q.territoryName === 'prototype-design'),
      );
    }
    if (lensId === 'stakeholder') {
      check('stakeholder canWrite=false (read-only)', cfg.affordances.canWrite === false);
      check('stakeholder canTriage=false', cfg.affordances.canTriage === false);
      check('stakeholder panels exclude find_similar', !cfg.panels.includes('find_similar'));
      check('stakeholder panels exclude review_queue', !cfg.panels.includes('review_queue'));
      check('stakeholder panels exclude locks', !cfg.panels.includes('locks'));
      check('stakeholder panels exclude feedback_queue', !cfg.panels.includes('feedback_queue'));
      check('stakeholder panels exclude contracts', !cfg.panels.includes('contracts'));
      check(
        'stakeholder reviewQueue empty (no discipline)',
        vm.reviewQueue.length === 0,
      );
    }

    // Owner of the strategy-research territory should see it as owned
    if (lensId === 'analyst') {
      check(
        'analyst sees strategy-research as owned',
        vm.territories.some((t) => t.name === 'strategy-research' && t.isOwned),
      );
    }
    if (lensId === 'dev') {
      check(
        'dev sees protocol as owned',
        vm.territories.some((t) => t.name === 'protocol' && t.isOwned),
      );
    }
    if (lensId === 'designer') {
      check(
        'designer sees prototype-design as owned',
        vm.territories.some((t) => t.name === 'prototype-design' && t.isOwned),
      );
    }
  }

  // ---- auth failure paths ----
  console.log('\n[auth] failure paths');

  delete process.env.ATELIER_DEV_BEARER;
  const noBearer = await loadLensViewModel('analyst', fakeRequest('analyst'), { cookies: null });
  check(
    'no bearer -> reason=no_bearer',
    !noBearer.ok && noBearer.reason === 'no_bearer',
    noBearer.ok ? 'unexpected ok' : `actual reason=${noBearer.reason}`,
  );

  process.env.ATELIER_DEV_BEARER = 'stub:nonexistent-sub';
  const bogus = await loadLensViewModel('analyst', fakeRequest('analyst'), { cookies: null });
  check(
    'unknown sub -> reason=no_composer',
    !bogus.ok && bogus.reason === 'no_composer',
    bogus.ok ? 'unexpected ok' : `actual reason=${bogus.reason}`,
  );

  // ---- result ----
  console.log('');
  if (failures > 0) {
    console.log(`=========================================`);
    console.log(`FAIL: ${failures} assertion(s) failed`);
    console.log(`=========================================`);
    process.exit(1);
  }
  console.log(`=========================================`);
  console.log(`ALL LENS SMOKE CHECKS PASSED`);
  console.log(`=========================================`);
}

main().catch((err) => {
  console.error('LENS SMOKE CRASHED:', err);
  process.exit(2);
});
