// Triage smoke (M6 / migration 9 / ADR-018).
//
// Dedicated test for the M6 triage substrate: triage_pending insert
// from below-threshold route-proposal, the LLM classifier registry
// seam (mocked chat service for determinism), and the
// triagePendingApprove + triagePendingReject lifecycle.
//
// The broader substrate.smoke.ts already covers above-threshold
// classifier->drafter->claim. This smoke focuses on the M6-specific
// surface that didn't exist before migration 9.
//
// Run against a fresh local Supabase (`supabase db reset --local`):
//   DATABASE_URL=... npx tsx scripts/sync/triage/__smoke__/triage.smoke.ts

import { Client } from 'pg';
import { AtelierClient } from '../../lib/write.ts';
import type { ExternalComment } from '../../lib/adapters.ts';
import { registerClassifier, resolveClassifier } from '../classifier.ts';
import { LlmClassifier } from '../llm-classifier.ts';
import { routeProposal } from '../route-proposal.ts';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatService,
} from '../../../coordination/adapters/openai-compatible-chat.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------
// Mock ChatService (deterministic; no live LLM call)
// ---------------------------------------------------------------------------
//
// Returns a canned classification keyed off the comment text.
// Used to exercise the LlmClassifier code path + the registry seam
// without hitting an external API. Tests that USE the live LLM go
// behind a OPENAI_API_KEY guard in M7 polish; this smoke is
// deterministic by design.

class MockChatService implements ChatService {
  readonly name = 'mock-chat';
  private readonly responses: Map<string, string>;
  private readonly defaultResponse: string;
  callCount = 0;

  constructor(responses: Map<string, string>, defaultResponse: string) {
    this.responses = responses;
    this.defaultResponse = defaultResponse;
  }

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.callCount += 1;
    const userMessage = req.messages.find((m) => m.role === 'user')?.content ?? '';
    for (const [key, response] of this.responses) {
      if (userMessage.includes(key)) {
        return { content: response, model: 'mock' };
      }
    }
    return { content: this.defaultResponse, model: 'mock' };
  }

  async close(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // -------- Seed fixtures --------
  const seed = new Client({ connectionString: DB_URL });
  await seed.connect();
  // Cleanup from prior runs (mind the append-only decisions trigger)
  await seed.query(`DELETE FROM triage_pending WHERE project_id = '77777777-1111-1111-1111-111111111111'`);
  await seed.query(`DELETE FROM contributions WHERE project_id = '77777777-1111-1111-1111-111111111111'`);
  await seed.query(`DELETE FROM territories WHERE project_id = '77777777-1111-1111-1111-111111111111'`);
  await seed.query(`DELETE FROM sessions WHERE composer_id IN ('77777777-2222-2222-2222-222222222222', '77777777-3333-3333-3333-333333333333')`);
  await seed.query(`DELETE FROM composers WHERE project_id = '77777777-1111-1111-1111-111111111111'`);
  await seed.query(`DELETE FROM projects WHERE id = '77777777-1111-1111-1111-111111111111'`);

  const projectId = '77777777-1111-1111-1111-111111111111';
  const triageComposerId = '77777777-2222-2222-2222-222222222222';
  const approverComposerId = '77777777-3333-3333-3333-333333333333';
  const territoryId = '77777777-4444-4444-4444-444444444444';

  await seed.query(
    `INSERT INTO projects (id, name, repo_url, template_version)
     VALUES ($1, 'triage-smoke', 'https://example.invalid/triage-smoke', '1.0')`,
    [projectId],
  );
  await seed.query(
    `INSERT INTO composers (id, project_id, email, display_name, discipline, identity_subject)
     VALUES ($1, $2, 'triage-bot@smoke.invalid', 'Triage Bot', 'dev', 'sub-triage'),
            ($3, $2, 'approver@smoke.invalid', 'Approver', 'architect', 'sub-approver')`,
    [triageComposerId, projectId, approverComposerId],
  );
  await seed.query(
    `INSERT INTO territories (id, project_id, name, owner_role, review_role, scope_kind, scope_pattern)
     VALUES ($1, $2, 'triage-smoke-terr', 'dev', 'architect', 'files', ARRAY['triage-smoke/**'])`,
    [territoryId, projectId],
  );
  await seed.end();

  const client = new AtelierClient({ databaseUrl: DB_URL });
  try {
    // Triage system session (per ARCH 6.5.2)
    const triageSession = await client.createSession({
      projectId,
      composerId: triageComposerId,
      surface: 'passive',
    });

    // -------------------------------------------------------------------
    // [0] LlmClassifier via registry seam (Path A)
    // -------------------------------------------------------------------
    console.log('\n[0] LlmClassifier via registry seam (Path A)');
    const mockChat = new MockChatService(
      new Map([
        ['typo-marker', '{"category":"typo","confidence":0.95,"signals":["mock-typo"]}'],
        ['scope-marker', '{"category":"scope","confidence":0.85,"signals":["mock-scope"]}'],
        ['unparseable-marker', 'this is not JSON'],
      ]),
      '{"category":"off-topic","confidence":0.4,"signals":["mock-default"]}',
    );
    const llmClassifier = new LlmClassifier(mockChat);
    registerClassifier(llmClassifier);
    check('llm-v1 resolvable from registry', resolveClassifier('llm-v1').name === 'llm-v1');

    const typoComment: ExternalComment = {
      source: 'github',
      externalCommentId: 'cmt-typo',
      externalAuthor: 'reviewer',
      text: 'typo-marker: thier should be their',
      context: {},
      receivedAt: new Date().toISOString(),
    };
    const typoClass = await llmClassifier.classify(typoComment);
    check('LLM classifier resolves typo category', typoClass.category === 'typo');
    check('LLM classifier confidence >0.5', typoClass.confidence > 0.5);

    const unparseableComment: ExternalComment = {
      source: 'github',
      externalCommentId: 'cmt-unparseable',
      externalAuthor: 'someone',
      text: 'unparseable-marker also some additional concerns',
      context: {},
      receivedAt: new Date().toISOString(),
    };
    const fbClass = await llmClassifier.classify(unparseableComment);
    check(
      'LLM unparseable response falls back to heuristic',
      fbClass.signals.some((s) => s.includes('llm-fallback')),
    );

    // -------------------------------------------------------------------
    // [1] Below-threshold routing persists in triage_pending
    // -------------------------------------------------------------------
    console.log('\n[1] Below-threshold routing persists in triage_pending');
    const lowComment: ExternalComment = {
      source: 'github',
      externalCommentId: 'cmt-low-1',
      externalAuthor: 'random-user',
      text: 'lol',
      context: {},
      receivedAt: new Date().toISOString(),
    };
    const lowDecision = await routeProposal({
      client,
      comment: lowComment,
      classifierName: 'heuristic-v1',
      projectId,
      triageSessionId: triageSession.id,
      territoryId,
      contentRef: 'triage/cmt-low-1.md',
      threshold: 0.5,
      dryRun: false,
    });
    check(
      '[1] outcome is routed_to_human_queue',
      lowDecision.outcome === 'routed_to_human_queue',
    );
    check('[1] triagePendingId returned', typeof lowDecision.triagePendingId === 'string');
    check('[1] no contribution created', lowDecision.contributionId === null);
    const triagePendingId = lowDecision.triagePendingId!;

    // -------------------------------------------------------------------
    // [2] Idempotent re-routing (UPSERT path)
    // -------------------------------------------------------------------
    console.log('\n[2] Re-routing same comment is idempotent (UPSERT)');
    const lowDecisionRetry = await routeProposal({
      client,
      comment: lowComment,
      classifierName: 'heuristic-v1',
      projectId,
      triageSessionId: triageSession.id,
      territoryId,
      contentRef: 'triage/cmt-low-1.md',
      threshold: 0.5,
      dryRun: false,
    });
    check(
      '[2] re-route returns the SAME triage_pending id',
      lowDecisionRetry.triagePendingId === triagePendingId,
    );

    // -------------------------------------------------------------------
    // [3] triagePendingList default filters to pending-only
    // -------------------------------------------------------------------
    console.log('\n[3] triagePendingList');
    const pendingList = await client.triagePendingList({ projectId });
    check('[3] list returns 1 pending row', pendingList.length === 1);
    check(
      '[3] row has expected external comment id',
      pendingList[0]?.externalCommentId === 'cmt-low-1',
    );
    check('[3] row.routedToContributionId is null', pendingList[0]?.routedToContributionId === null);
    check('[3] row.rejectedAt is null', pendingList[0]?.rejectedAt === null);

    // -------------------------------------------------------------------
    // [4] triagePendingApprove creates contribution + UPDATEs row
    // -------------------------------------------------------------------
    console.log('\n[4] triagePendingApprove');
    const approveResult = await client.triagePendingApprove({
      triagePendingId,
      approverComposerId,
    });
    check('[4] approve returns contributionId', typeof approveResult.contributionId === 'string');
    check('[4] approve returns same triagePendingId', approveResult.triagePendingId === triagePendingId);

    // Pending list (default filter) should now be empty
    const afterApprove = await client.triagePendingList({ projectId });
    check('[4] pending-only list now empty', afterApprove.length === 0);

    // includeDecided list shows the row with routedToContributionId
    const includeAll = await client.triagePendingList({ projectId, includeDecided: true });
    check('[4] includeDecided list has 1 row', includeAll.length === 1);
    check(
      '[4] decided row has routedToContributionId set',
      includeAll[0]?.routedToContributionId === approveResult.contributionId,
    );
    check(
      '[4] decided row has decided_by_composer_id set',
      includeAll[0]?.decidedByComposerId === approverComposerId,
    );

    // -------------------------------------------------------------------
    // [5] Already-decided row can't be re-decided
    // -------------------------------------------------------------------
    console.log('\n[5] Already-decided row blocks re-decision');
    let approveAgainErr: unknown = null;
    try {
      await client.triagePendingApprove({ triagePendingId, approverComposerId });
    } catch (err) {
      approveAgainErr = err;
    }
    check(
      '[5] re-approve throws CONFLICT',
      approveAgainErr !== null && (approveAgainErr as { code?: string }).code === 'CONFLICT',
    );

    let rejectAfterErr: unknown = null;
    try {
      await client.triagePendingReject({
        triagePendingId,
        rejecterComposerId: approverComposerId,
        reason: 'late reject',
      });
    } catch (err) {
      rejectAfterErr = err;
    }
    check(
      '[5] reject-after-approve throws CONFLICT',
      rejectAfterErr !== null && (rejectAfterErr as { code?: string }).code === 'CONFLICT',
    );

    // -------------------------------------------------------------------
    // [6] Reject path: separate row, route low-confidence, reject
    // -------------------------------------------------------------------
    console.log('\n[6] triagePendingReject');
    const lowComment2: ExternalComment = {
      source: 'github',
      externalCommentId: 'cmt-low-2',
      externalAuthor: 'spammer',
      text: 'noise',
      context: {},
      receivedAt: new Date().toISOString(),
    };
    const lowDecision2 = await routeProposal({
      client,
      comment: lowComment2,
      classifierName: 'heuristic-v1',
      projectId,
      triageSessionId: triageSession.id,
      territoryId,
      contentRef: 'triage/cmt-low-2.md',
      threshold: 0.5,
      dryRun: false,
    });
    const rejectResult = await client.triagePendingReject({
      triagePendingId: lowDecision2.triagePendingId!,
      rejecterComposerId: approverComposerId,
      reason: 'spam content',
    });
    check('[6] reject returns same triagePendingId', rejectResult.triagePendingId === lowDecision2.triagePendingId);

    const rejectedRow = (await client.triagePendingList({ projectId, includeDecided: true })).find(
      (r) => r.id === lowDecision2.triagePendingId,
    );
    check('[6] rejected row has rejected_at set', rejectedRow?.rejectedAt !== null);
    check('[6] rejected row has rejection_reason', rejectedRow?.rejectionReason === 'spam content');
    check('[6] rejected row has no contribution', rejectedRow?.routedToContributionId === null);

    // -------------------------------------------------------------------
    // [7] FORBIDDEN on cross-project approver
    // -------------------------------------------------------------------
    console.log('\n[7] Cross-project approver rejected');
    const lowComment3: ExternalComment = {
      source: 'github',
      externalCommentId: 'cmt-low-3',
      externalAuthor: 'someone',
      text: 'meh',
      context: {},
      receivedAt: new Date().toISOString(),
    };
    const lowDecision3 = await routeProposal({
      client,
      comment: lowComment3,
      classifierName: 'heuristic-v1',
      projectId,
      triageSessionId: triageSession.id,
      territoryId,
      contentRef: 'triage/cmt-low-3.md',
      threshold: 0.5,
      dryRun: false,
    });
    let crossProjectErr: unknown = null;
    try {
      await client.triagePendingApprove({
        triagePendingId: lowDecision3.triagePendingId!,
        approverComposerId: '00000000-0000-0000-0000-000000000000', // not a composer in this project
      });
    } catch (err) {
      crossProjectErr = err;
    }
    check(
      '[7] non-existent approver -> FORBIDDEN',
      crossProjectErr !== null && (crossProjectErr as { code?: string }).code === 'FORBIDDEN',
    );
  } finally {
    await client.close();
  }

  console.log('');
  if (failures > 0) {
    console.log('=========================================');
    console.log(`FAIL: ${failures} assertion(s) failed`);
    console.log('=========================================');
    process.exit(1);
  }
  console.log('=========================================');
  console.log('ALL TRIAGE CHECKS PASSED');
  console.log('=========================================');
}

main().catch((err) => {
  console.error('TRIAGE SMOKE CRASHED:', err);
  process.exit(2);
});
