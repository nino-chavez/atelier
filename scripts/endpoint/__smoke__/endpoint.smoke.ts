// Smoke test for the M2-entry MCP endpoint substrate.
//
// Exercises:
//   1. ARCH 6.1.1 self-verification flow: register -> heartbeat -> get_context -> deregister
//   2. The 12-tool surface count is exact (per ADR-013 + ADR-040)
//   3. ADR-039 plan-review paths:
//        - opt-in territory: claimed -> plan_review -> in_progress (approved)
//        - opt-out territory: claimed -> plan_review rejected with BAD_REQUEST
//        - opt-in territory: opt-out path (claimed -> in_progress) rejected
//        - self-approval blocked
//        - non-reviewer blocked
//        - rejection returns to claimed; plan_review_approved_* remain NULL
//        - release after plan-approval clears plan_review_approved_* (audit H3)
//        - telemetry actions emitted: contribution.plan_submitted/_approved/_rejected
//
// Run against a fresh local Supabase (`supabase db reset --local` first):
//   DATABASE_URL=... npx tsx scripts/endpoint/__smoke__/endpoint.smoke.ts

import { Client } from 'pg';
import { AtelierClient } from '../../sync/lib/write.ts';
import { stubVerifier } from '../lib/auth.ts';
import { dispatch, TOOL_NAMES } from '../lib/dispatch.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  // Seed fixtures via raw pg.Client (bypasses RLS via service_role)
  const seed = new Client({ connectionString: DB_URL });
  await seed.connect();
  await seed.query(`DELETE FROM projects WHERE name LIKE 'endpoint-smoke-%'`);

  const projectId = '99999999-1111-1111-1111-111111111111';
  const devComposerId = '99999999-2222-2222-2222-222222222222';
  const reviewerComposerId = '99999999-3333-3333-3333-333333333333';
  const otherDevComposerId = '99999999-4444-4444-4444-444444444444';
  const planReviewTerritoryId = '99999999-5555-5555-5555-555555555555';
  const simpleTerritoryId = '99999999-6666-6666-6666-666666666666';

  await seed.query(
    `INSERT INTO projects (id, name, repo_url, template_version)
     VALUES ($1, 'endpoint-smoke', 'https://example.invalid/ep-smoke', '1.0')`,
    [projectId],
  );
  await seed.query(
    `INSERT INTO composers (id, project_id, email, display_name, discipline, identity_subject)
     VALUES ($1, $2, 'dev-ep@smoke.invalid', 'Dev', 'dev', 'sub-ep-dev'),
            ($3, $2, 'reviewer-ep@smoke.invalid', 'Reviewer', 'architect', 'sub-ep-reviewer'),
            ($4, $2, 'other-dev-ep@smoke.invalid', 'Other Dev', 'dev', 'sub-ep-other-dev')`,
    [devComposerId, projectId, reviewerComposerId, otherDevComposerId],
  );
  await seed.query(
    `INSERT INTO territories (id, project_id, name, owner_role, review_role, scope_kind, scope_pattern, requires_plan_review)
     VALUES ($1, $2, 'plan-review-territory', 'dev', 'architect', 'files', ARRAY['ep-smoke/pr/**'], true),
            ($3, $2, 'simple-territory',     'dev', 'architect', 'files', ARRAY['ep-smoke/sim/**'], false)`,
    [planReviewTerritoryId, projectId, simpleTerritoryId],
  );
  await seed.end();

  const client = new AtelierClient({ databaseUrl: DB_URL });
  const deps = { client, verifier: stubVerifier };

  const devBearer = 'stub:sub-ep-dev';
  const reviewerBearer = 'stub:sub-ep-reviewer';
  const otherDevBearer = 'stub:sub-ep-other-dev';

  try {
    // -------------------------------------------------------------
    // [0] 12-tool surface count is exact (ADR-013 + ADR-040)
    // -------------------------------------------------------------
    console.log('\n[0] 12-tool surface lock');
    check('TOOL_NAMES has exactly 12 entries', TOOL_NAMES.length === 12, `actual: ${TOOL_NAMES.length}`);
    check(
      'no get_contracts in surface (folded into get_context per ADR-040)',
      !TOOL_NAMES.includes('get_contracts' as never),
    );
    check(
      'propose_contract_change in surface (per ADR-040)',
      TOOL_NAMES.includes('propose_contract_change'),
    );
    check(
      'no publish_contract in surface (renamed per ADR-040)',
      !TOOL_NAMES.includes('publish_contract' as never),
    );

    // -------------------------------------------------------------
    // [1] ARCH 6.1.1 self-verification flow
    // -------------------------------------------------------------
    console.log('\n[1] ARCH 6.1.1 self-verification (register/heartbeat/get_context/deregister)');

    const regResult = await dispatch(
      { tool: 'register', bearer: devBearer, body: { surface: 'ide', agent_client: 'smoke/0.1.0' } },
      deps,
    );
    check('register returns ok', regResult.ok === true);
    if (!regResult.ok) {
      console.log('register error:', regResult.error);
      throw new Error('register failed; aborting smoke');
    }
    const sessionId = (regResult.data as { session_id: string }).session_id;
    check('register response carries session_id', typeof sessionId === 'string' && sessionId.length > 0);

    const hbResult = await dispatch(
      { tool: 'heartbeat', bearer: devBearer, body: { session_id: sessionId } },
      deps,
    );
    check('heartbeat returns ok', hbResult.ok === true);

    const ctxResult = await dispatch(
      { tool: 'get_context', bearer: devBearer, body: { session_id: sessionId } },
      deps,
    );
    check('get_context returns ok', ctxResult.ok === true);
    if (ctxResult.ok) {
      const ctx = ctxResult.data as {
        charter: { paths: string[] };
        recent_decisions: { direct: unknown[] };
        territories: { owned: unknown[]; consumed: unknown[] };
        contributions_summary: { by_state: Record<string, number> };
      };
      check('charter.paths is non-empty', ctx.charter.paths.length > 0);
      check('charter.paths includes CLAUDE.md', ctx.charter.paths.includes('CLAUDE.md'));
      check('territories.owned contains plan-review-territory for dev', ctx.territories.owned.length >= 2);
      check('contributions_summary returns by_state object', typeof ctx.contributions_summary.by_state === 'object');
    }

    // Reject unknown tool name
    const invalidResult = await dispatch(
      { tool: 'not_a_tool', bearer: devBearer, body: {} },
      deps,
    );
    check(
      'unknown tool -> INVALID_TOOL',
      invalidResult.ok === false && (invalidResult as { error: { code: string } }).error.code === 'INVALID_TOOL',
    );

    // -------------------------------------------------------------
    // [2] ADR-039 plan-review opt-in path (territory.requires_plan_review=true)
    // -------------------------------------------------------------
    console.log('\n[2] Plan-review opt-in path (claimed -> plan_review -> in_progress)');

    const claimResult = await dispatch(
      {
        tool: 'claim',
        bearer: devBearer,
        body: {
          contribution_id: null,
          session_id: sessionId,
          kind: 'implementation',
          trace_ids: ['US-2.1'],
          territory_id: planReviewTerritoryId,
          content_ref: 'ep-smoke/pr/feature.md',
          artifact_scope: ['ep-smoke/pr/feature.md'],
        },
      },
      deps,
    );
    check('claim returns ok', claimResult.ok === true);
    if (!claimResult.ok) throw new Error('claim failed: ' + JSON.stringify(claimResult.error));
    const contribId = (claimResult.data as { contributionId: string }).contributionId;

    // Skip plan-review and try claimed -> in_progress directly: must be rejected
    const skipResult = await dispatch(
      {
        tool: 'update',
        bearer: devBearer,
        body: { contribution_id: contribId, session_id: sessionId, state: 'in_progress' },
      },
      deps,
    );
    check(
      'territory requires plan_review: claimed -> in_progress rejected',
      skipResult.ok === false &&
        (skipResult as { error: { code: string; message: string } }).error.code === 'BAD_REQUEST' &&
        (skipResult as { error: { message: string } }).error.message.includes('plan_review'),
    );

    // Submit a plan
    const planSubmitResult = await dispatch(
      {
        tool: 'update',
        bearer: devBearer,
        body: {
          contribution_id: contribId,
          session_id: sessionId,
          state: 'plan_review',
          plan_payload: '# Plan\n\n- approach: TBD\n- files: ep-smoke/pr/feature.md',
        },
      },
      deps,
    );
    check('plan submission returns ok', planSubmitResult.ok === true);
    if (planSubmitResult.ok) {
      const r = planSubmitResult.data as { state: string };
      check('state is plan_review after submission', r.state === 'plan_review');
    }

    // Self-approval: dev (the author) cannot approve their own plan
    const selfApproveResult = await dispatch(
      {
        tool: 'update',
        bearer: devBearer,
        body: { contribution_id: contribId, session_id: sessionId, state: 'in_progress' },
      },
      deps,
    );
    check(
      'self-approval blocked (author cannot approve own plan)',
      selfApproveResult.ok === false &&
        (selfApproveResult as { error: { code: string } }).error.code === 'FORBIDDEN',
    );

    // Non-reviewer blocked: another dev (wrong discipline) cannot approve
    const otherDevReg = await dispatch(
      { tool: 'register', bearer: otherDevBearer, body: { surface: 'ide' } },
      deps,
    );
    if (!otherDevReg.ok) throw new Error('other-dev register failed');
    const otherDevSessionId = (otherDevReg.data as { session_id: string }).session_id;
    const wrongDisciplineResult = await dispatch(
      {
        tool: 'update',
        bearer: otherDevBearer,
        body: { contribution_id: contribId, session_id: otherDevSessionId, state: 'in_progress' },
      },
      deps,
    );
    check(
      'non-reviewer (wrong discipline) blocked',
      wrongDisciplineResult.ok === false &&
        (wrongDisciplineResult as { error: { code: string } }).error.code === 'FORBIDDEN',
    );

    // Reviewer with correct discipline approves
    const reviewerReg = await dispatch(
      { tool: 'register', bearer: reviewerBearer, body: { surface: 'web' } },
      deps,
    );
    if (!reviewerReg.ok) throw new Error('reviewer register failed');
    const reviewerSessionId = (reviewerReg.data as { session_id: string }).session_id;

    const approveResult = await dispatch(
      {
        tool: 'update',
        bearer: reviewerBearer,
        body: { contribution_id: contribId, session_id: reviewerSessionId, state: 'in_progress' },
      },
      deps,
    );
    check('plan approval returns ok', approveResult.ok === true);
    if (approveResult.ok) {
      const r = approveResult.data as {
        state: string;
        planReviewApprovedByComposerId: string | null;
        planReviewApprovedAt: Date | null;
      };
      check('state is in_progress after approval', r.state === 'in_progress');
      check(
        'plan_review_approved_by_composer_id populated to reviewer',
        r.planReviewApprovedByComposerId === reviewerComposerId,
      );
      check('plan_review_approved_at populated', r.planReviewApprovedAt !== null);
    }

    // -------------------------------------------------------------
    // [3] ADR-039 plan-review opt-out path (territory.requires_plan_review=false)
    // -------------------------------------------------------------
    console.log('\n[3] Plan-review opt-out path (territory.requires_plan_review=false)');

    const claim2 = await dispatch(
      {
        tool: 'claim',
        bearer: devBearer,
        body: {
          contribution_id: null,
          session_id: sessionId,
          kind: 'implementation',
          trace_ids: ['US-2.1'],
          territory_id: simpleTerritoryId,
          content_ref: 'ep-smoke/sim/feature.md',
          artifact_scope: ['ep-smoke/sim/feature.md'],
        },
      },
      deps,
    );
    if (!claim2.ok) throw new Error('claim2 failed: ' + JSON.stringify(claim2.error));
    const contrib2Id = (claim2.data as { contributionId: string }).contributionId;

    // Try to enter plan_review: must be rejected (territory does not require it)
    const planNotAllowedResult = await dispatch(
      {
        tool: 'update',
        bearer: devBearer,
        body: {
          contribution_id: contrib2Id,
          session_id: sessionId,
          state: 'plan_review',
          plan_payload: '# Plan',
        },
      },
      deps,
    );
    check(
      'plan_review on opt-out territory rejected with BAD_REQUEST',
      planNotAllowedResult.ok === false &&
        (planNotAllowedResult as { error: { code: string; message: string } }).error.code === 'BAD_REQUEST' &&
        (planNotAllowedResult as { error: { message: string } }).error.message.includes('does not require plan_review'),
    );

    // claimed -> in_progress works directly on opt-out territory
    const directResult = await dispatch(
      {
        tool: 'update',
        bearer: devBearer,
        body: { contribution_id: contrib2Id, session_id: sessionId, state: 'in_progress' },
      },
      deps,
    );
    check('claimed -> in_progress on opt-out territory works', directResult.ok === true);

    // -------------------------------------------------------------
    // [4] Plan-rejection path returns to claimed; columns remain NULL
    // -------------------------------------------------------------
    console.log('\n[4] Plan-rejection: plan_review -> claimed (columns stay NULL)');

    const claim3 = await dispatch(
      {
        tool: 'claim',
        bearer: devBearer,
        body: {
          contribution_id: null,
          session_id: sessionId,
          kind: 'implementation',
          trace_ids: ['US-2.1'],
          territory_id: planReviewTerritoryId,
          content_ref: 'ep-smoke/pr/rejected.md',
          artifact_scope: ['ep-smoke/pr/rejected.md'],
        },
      },
      deps,
    );
    if (!claim3.ok) throw new Error('claim3 failed');
    const contrib3Id = (claim3.data as { contributionId: string }).contributionId;

    await dispatch(
      {
        tool: 'update',
        bearer: devBearer,
        body: {
          contribution_id: contrib3Id,
          session_id: sessionId,
          state: 'plan_review',
          plan_payload: 'rough plan',
        },
      },
      deps,
    );

    const rejectResult = await dispatch(
      {
        tool: 'update',
        bearer: reviewerBearer,
        body: {
          contribution_id: contrib3Id,
          session_id: reviewerSessionId,
          state: 'claimed',
          reason: 'plan does not address auth contract; revise',
        },
      },
      deps,
    );
    check('rejection returns ok', rejectResult.ok === true);
    if (rejectResult.ok) {
      const r = rejectResult.data as {
        state: string;
        planReviewApprovedByComposerId: string | null;
        planReviewApprovedAt: Date | null;
      };
      check('state is claimed after rejection', r.state === 'claimed');
      check(
        'plan_review_approved_by_composer_id remains NULL on rejection',
        r.planReviewApprovedByComposerId === null,
      );
      check('plan_review_approved_at remains NULL on rejection', r.planReviewApprovedAt === null);
    }

    // Reject without reason -> BAD_REQUEST
    await dispatch(
      {
        tool: 'update',
        bearer: devBearer,
        body: {
          contribution_id: contrib3Id,
          session_id: sessionId,
          state: 'plan_review',
          plan_payload: 'second attempt',
        },
      },
      deps,
    );
    const rejectNoReasonResult = await dispatch(
      {
        tool: 'update',
        bearer: reviewerBearer,
        body: { contribution_id: contrib3Id, session_id: reviewerSessionId, state: 'claimed' },
      },
      deps,
    );
    check(
      'rejection without reason -> BAD_REQUEST',
      rejectNoReasonResult.ok === false &&
        (rejectNoReasonResult as { error: { code: string } }).error.code === 'BAD_REQUEST',
    );

    // -------------------------------------------------------------
    // [5] Audit H3: release after plan-approval clears plan_review_approved_*
    // -------------------------------------------------------------
    console.log('\n[5] Audit H3: release-from-in_progress clears plan_review_approved_*');

    // Use contribId from step [2] which is now in state=in_progress with
    // plan_review_approved_* populated
    const releaseResult = await dispatch(
      {
        tool: 'release',
        bearer: devBearer,
        body: { contribution_id: contribId, session_id: sessionId, reason: 'scope changed' },
      },
      deps,
    );
    check('release after plan-approval returns ok', releaseResult.ok === true);

    // Read the row directly to confirm columns are NULL
    const verify = new Client({ connectionString: DB_URL });
    await verify.connect();
    try {
      const { rows } = await verify.query<{
        state: string;
        plan_review_approved_by_composer_id: string | null;
        plan_review_approved_at: Date | null;
      }>(
        `SELECT state::text AS state, plan_review_approved_by_composer_id, plan_review_approved_at
           FROM contributions WHERE id = $1`,
        [contribId],
      );
      const row = rows[0]!;
      check('post-release state is open', row.state === 'open');
      check(
        'post-release plan_review_approved_by_composer_id IS NULL',
        row.plan_review_approved_by_composer_id === null,
      );
      check('post-release plan_review_approved_at IS NULL', row.plan_review_approved_at === null);
    } finally {
      await verify.end();
    }

    // -------------------------------------------------------------
    // [6] Telemetry: plan_submitted / plan_approved / plan_rejected emitted
    // -------------------------------------------------------------
    console.log('\n[6] Telemetry: plan_submitted / plan_approved / plan_rejected');

    const tele = new Client({ connectionString: DB_URL });
    await tele.connect();
    try {
      const { rows } = await tele.query<{ action: string; n: string }>(
        `SELECT action, COUNT(*)::text AS n
           FROM telemetry WHERE project_id = $1 AND action LIKE 'contribution.plan_%'
           GROUP BY action`,
        [projectId],
      );
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.action] = Number(r.n);
      console.log(`    telemetry: ${JSON.stringify(counts)}`);
      check('contribution.plan_submitted emitted', (counts['contribution.plan_submitted'] ?? 0) >= 1);
      check('contribution.plan_approved emitted', (counts['contribution.plan_approved'] ?? 0) >= 1);
      check('contribution.plan_rejected emitted', (counts['contribution.plan_rejected'] ?? 0) >= 1);
    } finally {
      await tele.end();
    }

    // -------------------------------------------------------------
    // [7] ARCH 6.1.1 step 4: deregister + replay heartbeat returns 401-equivalent
    // -------------------------------------------------------------
    console.log('\n[7] Deregister; subsequent heartbeat returns NOT_FOUND');

    // Use a fresh session that has no claimed contributions to avoid
    // tripping unrelated invariants
    const freshReg = await dispatch(
      { tool: 'register', bearer: devBearer, body: { surface: 'ide' } },
      deps,
    );
    if (!freshReg.ok) throw new Error('fresh register failed');
    const freshSid = (freshReg.data as { session_id: string }).session_id;

    const deregResult = await dispatch(
      { tool: 'deregister', bearer: devBearer, body: { session_id: freshSid } },
      deps,
    );
    check('deregister returns ok', deregResult.ok === true);

    const replayHb = await dispatch(
      { tool: 'heartbeat', bearer: devBearer, body: { session_id: freshSid } },
      deps,
    );
    check(
      'replay heartbeat after deregister -> NOT_FOUND',
      replayHb.ok === false && (replayHb as { error: { code: string } }).error.code === 'NOT_FOUND',
    );

    // -------------------------------------------------------------
    // [8] Auth: invalid bearer -> FORBIDDEN
    // -------------------------------------------------------------
    console.log('\n[8] Auth path: invalid bearer rejected');

    const badBearer = await dispatch(
      { tool: 'heartbeat', bearer: 'stub:nonexistent-sub', body: { session_id: 'x' } },
      deps,
    );
    check(
      'unknown sub -> FORBIDDEN',
      badBearer.ok === false && (badBearer as { error: { code: string } }).error.code === 'FORBIDDEN',
    );

    const noBearer = await dispatch(
      { tool: 'heartbeat', bearer: '', body: { session_id: 'x' } },
      deps,
    );
    check(
      'empty bearer -> FORBIDDEN',
      noBearer.ok === false && (noBearer as { error: { code: string } }).error.code === 'FORBIDDEN',
    );
  } finally {
    await client.close();
  }

  console.log('');
  if (failures > 0) {
    console.log(`=========================================`);
    console.log(`FAIL: ${failures} assertion(s) failed`);
    console.log(`=========================================`);
    process.exit(1);
  }
  console.log(`=========================================`);
  console.log(`ALL ENDPOINT + PLAN-REVIEW CHECKS PASSED`);
  console.log(`=========================================`);
}

main().catch((err) => {
  console.error('SMOKE TEST CRASHED:', err);
  process.exit(2);
});
