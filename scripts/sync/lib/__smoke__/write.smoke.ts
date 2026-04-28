// Smoke test for scripts/sync/lib/write.ts
//
// Run against a fresh local Supabase (`supabase db reset --local` first):
//   npx tsx scripts/sync/lib/__smoke__/write.smoke.ts
//
// Exits 0 on success, non-zero on any assertion failure. Each block prints
// a one-line PASS/FAIL with the relevant ARCH section.

import { Client } from 'pg';
import { AtelierClient, AtelierError } from '../write.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

async function main() {
  // Use a raw pg.Client for fixture seeding so we don't go through RLS or the
  // library's own write paths.
  const seed = new Client({ connectionString: DB_URL });
  await seed.connect();

  // Wipe any prior smoke fixtures (decisions are append-only -- accept that
  // smoke decisions accumulate; CASCADE the projects rows we created).
  await seed.query(`DELETE FROM projects WHERE name LIKE 'smoke-%'`);

  // Fresh project + composers
  const projectId = '11111111-1111-1111-1111-111111111111';
  const devComposerId = '22222222-2222-2222-2222-222222222222';
  const architectComposerId = '33333333-3333-3333-3333-333333333333';
  // Second architect required so the legitimate-approval path (step 12) and
  // the self-approval-block path (step 13) can both be exercised cleanly.
  const reviewerComposerId = '55555555-5555-5555-5555-555555555555';
  const territoryId = '44444444-4444-4444-4444-444444444444';

  await seed.query(
    `INSERT INTO projects (id, name, repo_url, template_version)
     VALUES ($1, 'smoke-write-lib', 'https://example.invalid/smoke', '1.0')`,
    [projectId],
  );
  await seed.query(
    `INSERT INTO composers (id, project_id, email, display_name, discipline)
     VALUES ($1, $2, 'dev@smoke.invalid', 'Dev Composer', 'dev'),
            ($3, $2, 'architect@smoke.invalid', 'Architect Composer', 'architect'),
            ($4, $2, 'reviewer@smoke.invalid', 'Reviewer Composer', 'architect')`,
    [devComposerId, projectId, architectComposerId, reviewerComposerId],
  );
  await seed.query(
    `INSERT INTO territories (id, project_id, name, owner_role, review_role, scope_kind, scope_pattern)
     VALUES ($1, $2, 'smoke-territory', 'dev', 'architect', 'files',
             ARRAY['scripts/smoke/**'])`,
    [territoryId, projectId],
  );
  await seed.end();

  const client = new AtelierClient({ databaseUrl: DB_URL });

  console.log('\n[1] Sessions');
  const devSession = await client.createSession({
    projectId,
    composerId: devComposerId,
    surface: 'terminal',
    agentClient: 'smoke-test/0.0.1',
  });
  check('createSession returns id and active status', !!devSession.id && devSession.status === 'active');

  const architectSession = await client.createSession({
    projectId,
    composerId: architectComposerId,
    surface: 'terminal',
  });
  check('second session for architect', !!architectSession.id);

  const reviewerSession = await client.createSession({
    projectId,
    composerId: reviewerComposerId,
    surface: 'terminal',
  });
  check('reviewer session created', !!reviewerSession.id);

  await client.heartbeat(devSession.id);
  check('heartbeat ok', true);

  console.log('\n[2] Claim - atomic-create (ARCH 6.2.1)');
  const claimed = await client.claim({
    contributionId: null,
    sessionId: devSession.id,
    kind: 'implementation',
    traceIds: ['US-2.1'],
    territoryId,
    contentRef: 'scripts/smoke/example.ts',
    artifactScope: ['scripts/smoke/example.ts'],
  });
  check('atomic-create returns claimed state', claimed.state === 'claimed');
  check('atomic-create marks created=true', claimed.created === true);
  check(
    'discipline matches owner_role -> requires_owner_approval=false',
    claimed.requiresOwnerApproval === false,
  );

  console.log('\n[3] Claim - cross-discipline -> requires_owner_approval (ADR-033)');
  const crossClaimed = await client.claim({
    contributionId: null,
    sessionId: architectSession.id,
    kind: 'implementation',
    traceIds: ['US-2.2'],
    territoryId,
    contentRef: 'scripts/smoke/cross.ts',
    artifactScope: ['scripts/smoke/cross.ts'],
  });
  check(
    'architect into dev-territory -> requires_owner_approval=true',
    crossClaimed.requiresOwnerApproval === true,
  );

  console.log('\n[4] Claim - pre-existing path (ARCH 6.2.1.5)');
  // Seed an open contribution then claim it
  const preOpen = await rawInsertOpenContribution(DB_URL, projectId, territoryId);
  const preClaim = await client.claim({
    contributionId: preOpen.id,
    sessionId: devSession.id,
  });
  check('pre-existing claim returns created=false', preClaim.created === false);
  check('pre-existing claim transitions to claimed', preClaim.state === 'claimed');

  console.log('\n[5] Claim - racing claim returns CONFLICT');
  let conflictCaught = false;
  try {
    await client.claim({ contributionId: preOpen.id, sessionId: architectSession.id });
  } catch (err) {
    conflictCaught = err instanceof AtelierError && err.code === 'CONFLICT';
  }
  check('second claim on already-claimed row -> CONFLICT', conflictCaught);

  console.log('\n[6] acquireLock + fencing token monotonicity (ARCH 7.4)');
  const lockA = await client.acquireLock({
    contributionId: claimed.contributionId,
    sessionId: devSession.id,
    artifactScope: ['scripts/smoke/example.ts'],
  });
  check('lock A returns fencing_token', typeof lockA.fencingToken === 'bigint');

  // Acquire a second lock on a different scope to verify monotonicity
  const lockB = await client.acquireLock({
    contributionId: claimed.contributionId,
    sessionId: devSession.id,
    artifactScope: ['scripts/smoke/other.ts'],
  });
  check('lock B fencing_token > lock A fencing_token', lockB.fencingToken > lockA.fencingToken);

  console.log('\n[7] acquireLock - overlap detection');
  let overlapCaught = false;
  try {
    await client.acquireLock({
      contributionId: claimed.contributionId,
      sessionId: devSession.id,
      artifactScope: ['scripts/smoke/example.ts'], // same as lockA
    });
  } catch (err) {
    overlapCaught = err instanceof AtelierError && err.code === 'CONFLICT';
  }
  check('overlapping lock -> CONFLICT', overlapCaught);

  console.log('\n[8] update - state transition + content_ref (ARCH 6.2.2)');
  const updated = await client.update({
    contributionId: claimed.contributionId,
    sessionId: devSession.id,
    state: 'in_progress',
    contentRef: 'scripts/smoke/example-v2.ts',
    fencingToken: lockA.fencingToken,
  });
  check('update returns new state', updated.state === 'in_progress');

  console.log('\n[9] update - content_ref without fencing_token -> BAD_REQUEST');
  let missingTokenCaught = false;
  try {
    await client.update({
      contributionId: claimed.contributionId,
      sessionId: devSession.id,
      contentRef: 'scripts/smoke/again.ts',
    });
  } catch (err) {
    missingTokenCaught = err instanceof AtelierError && err.code === 'BAD_REQUEST';
  }
  check('content_ref without fencing_token -> BAD_REQUEST', missingTokenCaught);

  console.log('\n[10] update - non-author cannot update -> FORBIDDEN');
  let nonAuthorCaught = false;
  try {
    await client.update({
      contributionId: claimed.contributionId,
      sessionId: architectSession.id,
      state: 'review',
    });
  } catch (err) {
    nonAuthorCaught = err instanceof AtelierError && err.code === 'FORBIDDEN';
  }
  check('non-author update -> FORBIDDEN', nonAuthorCaught);

  console.log('\n[11] update - illegal transition (in_progress -> claimed)');
  let illegalCaught = false;
  try {
    await client.update({
      contributionId: claimed.contributionId,
      sessionId: devSession.id,
      state: 'claimed',
    });
  } catch (err) {
    illegalCaught = err instanceof AtelierError && err.code === 'BAD_REQUEST';
  }
  check('illegal state transition -> BAD_REQUEST', illegalCaught);

  console.log('\n[12] update(owner_approval=true) - cross-discipline approval (ARCH 5.3 + audit G2)');
  // Author tries to self-approve first -- must fail.
  let selfApprovalBlocked = false;
  try {
    await client.update({
      contributionId: crossClaimed.contributionId,
      sessionId: architectSession.id, // same composer as author
      ownerApproval: true,
    });
  } catch (err) {
    selfApprovalBlocked = err instanceof AtelierError && err.code === 'FORBIDDEN';
  }
  check('self-approval (author == reviewer) -> FORBIDDEN', selfApprovalBlocked);

  // Different architect approves -- must succeed.
  const approval = await client.update({
    contributionId: crossClaimed.contributionId,
    sessionId: reviewerSession.id,
    ownerApproval: true,
  });
  check('owner_approval clears requires_owner_approval', approval.requiresOwnerApproval === false);
  check(
    'approved_by_composer_id is the reviewer',
    approval.approvedByComposerId === reviewerComposerId,
  );

  console.log('\n[13] update(owner_approval=true) - wrong-discipline reviewer blocked');
  // Reset the flag so we can re-approve with a wrong-discipline composer
  const reset = new Client({ connectionString: DB_URL });
  await reset.connect();
  await reset.query(
    `UPDATE contributions SET requires_owner_approval = true,
       approved_by_composer_id = NULL, approved_at = NULL WHERE id = $1`,
    [crossClaimed.contributionId],
  );
  await reset.end();
  let wrongDisciplineBlocked = false;
  try {
    await client.update({
      contributionId: crossClaimed.contributionId,
      sessionId: devSession.id, // dev discipline; territory.review_role = architect
      ownerApproval: true,
    });
  } catch (err) {
    wrongDisciplineBlocked = err instanceof AtelierError && err.code === 'FORBIDDEN';
  }
  check('wrong-discipline reviewer -> FORBIDDEN', wrongDisciplineBlocked);

  console.log('\n[14] release - abandons claim, releases locks (ARCH 6.2.4)');
  const released = await client.release({
    contributionId: claimed.contributionId,
    sessionId: devSession.id,
    reason: 'smoke test cleanup',
  });
  check('release transitions to open', released.state === 'open');

  // Confirm locks are gone
  const lockCheck = new Client({ connectionString: DB_URL });
  await lockCheck.connect();
  const { rowCount: remainingLocks } = await lockCheck.query(
    `SELECT 1 FROM locks WHERE contribution_id = $1`,
    [claimed.contributionId],
  );
  check('release cascades lock cleanup', remainingLocks === 0);
  await lockCheck.end();

  console.log('\n[15] release - cannot release from non-claimed state');
  let releaseStateCaught = false;
  try {
    await client.release({
      contributionId: crossClaimed.contributionId, // still in_progress? actually still claimed
      sessionId: devSession.id, // not the author
    });
  } catch (err) {
    releaseStateCaught = err instanceof AtelierError && err.code === 'FORBIDDEN';
  }
  check('release by non-author -> FORBIDDEN', releaseStateCaught);

  console.log('\n[16] logDecision (ARCH 6.3 / 6.3.1)');
  const fakeSha = 'a1b2c3d4e5f6';
  const decision = await client.logDecision(
    {
      projectId,
      authorComposerId: architectComposerId,
      sessionId: architectSession.id,
      category: 'architecture',
      summary: 'Smoke test ADR for write library',
      rationale: 'Verifies log_decision allocates ADR-NNN, calls commit fn, inserts row.',
      traceIds: ['US-2.1'],
    },
    async (allocation) => {
      check(`commit-fn receives adrId=${allocation.adrId}`, allocation.adrId.startsWith('ADR-'));
      check(
        'commit-fn receives slugged repo_path',
        allocation.repoPath.includes('smoke-test-adr-for-write-library'),
      );
      return fakeSha;
    },
  );
  check('logDecision returns adrId', decision.adrId.startsWith('ADR-'));
  check('logDecision returns repo_commit_sha', decision.repoCommitSha === fakeSha);

  console.log('\n[17] logDecision - reverses validation');
  const decisionId = decision.decisionId;
  // Valid reversal
  const reversal = await client.logDecision(
    {
      projectId,
      authorComposerId: architectComposerId,
      sessionId: architectSession.id,
      category: 'architecture',
      summary: 'Reversal of smoke ADR',
      rationale: 'Smoke test reversal path.',
      traceIds: ['US-2.1'],
      reverses: decisionId,
    },
    async () => 'b2c3d4e5f6a1',
  );
  check('logDecision with valid reverses succeeds', reversal.adrId.startsWith('ADR-'));

  // Reversing a row that's already been reversed
  let alreadyReversedCaught = false;
  try {
    await client.logDecision(
      {
        projectId,
        authorComposerId: architectComposerId,
        sessionId: architectSession.id,
        category: 'architecture',
        summary: 'Double reversal',
        rationale: 'Should fail.',
        traceIds: ['US-2.1'],
        reverses: decisionId,
      },
      async () => 'c3d4e5f6a1b2',
    );
  } catch (err) {
    alreadyReversedCaught = err instanceof AtelierError && err.code === 'BAD_REQUEST';
  }
  check('reversing an already-reversed decision -> BAD_REQUEST', alreadyReversedCaught);

  console.log('\n[18] Telemetry: every mutation emitted an event');
  const tel = new Client({ connectionString: DB_URL });
  await tel.connect();
  const { rows: telemetry } = await tel.query<{ action: string; count: string }>(
    `SELECT action, count(*) AS count FROM telemetry WHERE project_id = $1 GROUP BY action ORDER BY action`,
    [projectId],
  );
  await tel.end();
  const telSummary = telemetry.map((r) => `${r.action}=${r.count}`).join(', ');
  console.log(`    telemetry events: ${telSummary}`);
  check('telemetry has session.created', telemetry.some((r) => r.action === 'session.created'));
  check('telemetry has contribution.claimed', telemetry.some((r) => r.action === 'contribution.claimed'));
  check('telemetry has lock.acquired', telemetry.some((r) => r.action === 'lock.acquired'));
  check('telemetry has contribution.updated', telemetry.some((r) => r.action === 'contribution.updated'));
  check('telemetry has contribution.released', telemetry.some((r) => r.action === 'contribution.released'));
  check('telemetry has decision.logged', telemetry.some((r) => r.action === 'decision.logged'));
  check('telemetry has contribution.approval_recorded', telemetry.some((r) => r.action === 'contribution.approval_recorded'));

  await client.close();

  console.log('\n=========================================');
  if (failures === 0) {
    console.log(`ALL CHECKS PASSED`);
  } else {
    console.log(`${failures} CHECK(S) FAILED`);
  }
  console.log('=========================================');
  process.exit(failures === 0 ? 0 : 1);
}

async function rawInsertOpenContribution(
  url: string,
  projectId: string,
  territoryId: string,
): Promise<{ id: string }> {
  const c = new Client({ connectionString: url });
  await c.connect();
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO contributions (
       project_id, trace_ids, territory_id, artifact_scope, state, kind, content_ref
     ) VALUES ($1, ARRAY['US-2.3'], $2, ARRAY['scripts/smoke/preexisting.ts'],
               'open', 'implementation', 'scripts/smoke/preexisting.ts')
     RETURNING id`,
    [projectId, territoryId],
  );
  await c.end();
  return { id: rows[0]!.id };
}

main().catch((err) => {
  console.error('SMOKE TEST CRASHED:', err);
  process.exit(2);
});
