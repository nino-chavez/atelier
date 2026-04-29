#!/usr/bin/env -S npx tsx
//
// Substrate smoke test for M1 step 4.iii.
//
// Exercises all five sync scripts + the event bus + the no-op adapter
// against a fresh local Supabase. Each script runs in --once-equivalent
// in-process mode (we call exported functions directly so we can assert
// on results) rather than spawning child processes.
//
// Run:  npx tsx scripts/sync/__smoke__/substrate.smoke.ts

import { Client } from 'pg';
import { promises as fs } from 'node:fs';
import {
  CHANNEL,
  type ContributionStateChangedPayload,
  getEventBus,
  resetEventBus,
} from '../lib/event-bus.ts';
import {
  noopDeliveryAdapter,
  noopInvocationLog,
  clearNoopInvocations,
  resolveDeliveryAdapter,
} from '../lib/adapters.ts';
import { AtelierClient } from '../lib/write.ts';
import { pollOnce, registerSubscriber } from '../publish-delivery.ts';
import { publishDoc } from '../publish-docs.ts';
import { pullForProject } from '../mirror-delivery.ts';
import { reconcile, extractContributionIdFromRef } from '../reconcile.ts';
import { routeProposal } from '../triage/route-proposal.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

const PROJECT_ID = '99999999-9999-9999-9999-999999999999';
const DEV_COMPOSER_ID = '88888888-8888-8888-8888-888888888888';
const TRIAGE_COMPOSER_ID = '77777777-7777-7777-7777-777777777777';
const TERRITORY_ID = '66666666-6666-6666-6666-666666666666';

async function seed(): Promise<void> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    await c.query(`DELETE FROM projects WHERE id = $1`, [PROJECT_ID]);
    await c.query(
      `INSERT INTO projects (id, name, repo_url, template_version)
       VALUES ($1, 'smoke-substrate', 'https://example.invalid/substrate', '1.0')`,
      [PROJECT_ID],
    );
    await c.query(
      `INSERT INTO composers (id, project_id, email, display_name, discipline)
       VALUES ($1, $2, 'dev@substrate.invalid', 'Dev', 'dev'),
              ($3, $2, 'triage@substrate.invalid', 'Triage System', 'pm')`,
      [DEV_COMPOSER_ID, PROJECT_ID, TRIAGE_COMPOSER_ID],
    );
    await c.query(
      `INSERT INTO territories (id, project_id, name, owner_role, review_role, scope_kind, scope_pattern)
       VALUES ($1, $2, 'substrate-territory', 'dev', 'architect', 'files', ARRAY['scripts/substrate/**'])`,
      [TERRITORY_ID, PROJECT_ID],
    );
  } finally {
    await c.end();
  }
}

async function main(): Promise<void> {
  await seed();
  resetEventBus();
  clearNoopInvocations();

  const client = new AtelierClient({ databaseUrl: DB_URL });
  const session = await client.createSession({
    projectId: PROJECT_ID,
    composerId: DEV_COMPOSER_ID,
    surface: 'terminal',
  });
  const triageSession = await client.createSession({
    projectId: PROJECT_ID,
    composerId: TRIAGE_COMPOSER_ID,
    surface: 'terminal',
  });

  // Create a real contribution so publish-delivery has something to detect.
  const claim = await client.claim({
    contributionId: null,
    sessionId: session.id,
    kind: 'implementation',
    traceIds: ['US-2.1'],
    territoryId: TERRITORY_ID,
    contentRef: 'scripts/substrate/example.ts',
    artifactScope: ['scripts/substrate/example.ts'],
  });
  await client.close();

  const sinceCursor = new Date(Date.now() - 60_000); // 60s ago

  console.log('\n[1] event-bus: typed pub/sub');
  const bus = getEventBus();
  let received: ContributionStateChangedPayload | null = null;
  bus.subscribe<ContributionStateChangedPayload>(CHANNEL.CONTRIBUTION_STATE_CHANGED, (env) => {
    received = env.payload;
  });
  await bus.publish<ContributionStateChangedPayload>(CHANNEL.CONTRIBUTION_STATE_CHANGED, {
    contributionId: 'test',
    projectId: PROJECT_ID,
    newState: 'claimed',
    priorState: 'open',
    observedAt: new Date().toISOString(),
    source: 'polling',
  });
  await bus.drain();
  check('subscriber received published event', received !== null && (received as ContributionStateChangedPayload).contributionId === 'test');

  resetEventBus();
  clearNoopInvocations();

  console.log('\n[2] publish-delivery: polling source -> bus -> noop adapter');
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const bus2 = getEventBus();
  const adapter = resolveDeliveryAdapter('noop');
  registerSubscriber(bus2, db, adapter, false);
  const pollResult = await pollOnce({ db, bus: bus2, since: sinceCursor, dryRun: true, projectId: PROJECT_ID });
  await bus2.drain();
  check('polling detected the seeded contribution', pollResult.detected >= 1);

  const noopInvocations = noopInvocationLog().filter((i) => i.method === 'upsertIssue');
  check('noop adapter received upsertIssue', noopInvocations.length >= 1);

  // Confirm the delivery.synced telemetry was recorded
  const { rows: syncedRows } = await db.query<{ count: string }>(
    `SELECT count(*) FROM telemetry WHERE project_id = $1 AND action = 'delivery.synced'`,
    [PROJECT_ID],
  );
  check('delivery.synced telemetry recorded', Number(syncedRows[0]!.count) >= 1);
  await db.end();

  console.log('\n[3] publish-docs: doc -> noop adapter');
  const docPath = '/tmp/atelier-substrate-smoke-doc.md';
  await fs.writeFile(docPath, '# Substrate Smoke Doc\n\nVerifies publish-docs.\n');
  clearNoopInvocations();
  const docResult = await publishDoc({
    docPath,
    adapterName: 'noop',
    space: 'smoke',
    dryRun: false,
  });
  check('publishDoc returns external_url', !!docResult.externalUrl);
  const docInvocations = noopInvocationLog().filter((i) => i.method === 'publishPage');
  check('noop doc adapter received publishPage', docInvocations.length === 1);
  // Verify the body has the banner prepended
  const recordedArgs = (docInvocations[0]?.args ?? {}) as { bodyHtml?: string };
  check('publish-docs prepended overwrite banner', !!recordedArgs.bodyHtml?.startsWith('> Edits here will be overwritten.'));
  await fs.unlink(docPath).catch(() => {});

  console.log('\n[4] mirror-delivery: pulls based on prior delivery.synced rows');
  const db2 = new Client({ connectionString: DB_URL });
  await db2.connect();
  const mirrorResult = await pullForProject({
    db: db2,
    projectId: PROJECT_ID,
    adapterName: 'noop',
    dryRun: true,
  });
  // noop pullIssue returns null, so pulled=0 is expected. The point of the
  // smoke is that the script runs without error and queries the right rows.
  check('mirror-delivery completes without error', typeof mirrorResult.pulled === 'number');
  await db2.end();

  console.log('\n[5] reconcile: drift detection (no drift expected) + branch reaping default-off');
  const db3 = new Client({ connectionString: DB_URL });
  await db3.connect();
  const report = await reconcile({
    db: db3,
    projectId: PROJECT_ID,
    args: {
      reapBranches: null,
      apply: null,
      maxAgeDays: 30,
      adapter: 'noop',
      traceabilityPath: 'traceability.json',
    },
    reapingEnabled: false,
    reapingApply: false,
  });
  check('reconcile runs without crashing', typeof report.driftDetected === 'number');
  check('branch reaping skipped when default-off', report.branchesScanned === 0);

  // Run reaping enabled (still dry-run; noop adapter returns []).
  const reapReport = await reconcile({
    db: db3,
    projectId: PROJECT_ID,
    args: {
      reapBranches: true,
      apply: null,
      maxAgeDays: 30,
      adapter: 'noop',
      traceabilityPath: 'traceability.json',
    },
    reapingEnabled: true,
    reapingApply: false,
  });
  check('reaping enabled with empty adapter returns 0 candidates', reapReport.branchesEligibleForReaping === 0);
  await db3.end();

  console.log('\n[6] reconcile: extractContributionIdFromRef parses atelier/<uuid>');
  const ref = `atelier/${claim.contributionId}`;
  const parsed = extractContributionIdFromRef(ref);
  check('atelier/<uuid> parses to contribution_id', parsed === claim.contributionId);
  check('non-matching ref returns null', extractContributionIdFromRef('feature/unrelated') === null);

  console.log('\n[7] triage: classifier + drafter + route-proposal');
  const triageClient = new AtelierClient({ databaseUrl: DB_URL });
  try {
    const decision = await routeProposal({
      client: triageClient,
      comment: {
        source: 'github',
        externalCommentId: 'github-comment-1',
        externalAuthor: 'someone',
        text: 'Should we also handle the empty-array case? This seems missing.',
        context: { trace_ids: ['US-2.1'] },
        receivedAt: new Date().toISOString(),
      },
      classifierName: 'heuristic-v1',
      triageSessionId: triageSession.id,
      territoryId: TERRITORY_ID,
      contentRef: 'triage/github-comment-1.md',
      threshold: 0.5,
      dryRun: false,
    });
    check(
      'triage created a contribution',
      decision.outcome === 'contribution_created' && !!decision.contributionId,
    );
    check('classification was scope or question', decision.category === 'scope' || decision.category === 'question');

    // Confirm requires_owner_approval=true on the routed contribution
    const verifyDb = new Client({ connectionString: DB_URL });
    await verifyDb.connect();
    const { rows: verifyRows } = await verifyDb.query<{
      requires_owner_approval: boolean;
      kind: string;
    }>(
      `SELECT requires_owner_approval, kind FROM contributions WHERE id = $1`,
      [decision.contributionId],
    );
    await verifyDb.end();
    check('routed contribution has requires_owner_approval=true (ADR-033)', verifyRows[0]?.requires_owner_approval === true);

    console.log('\n[8] triage: low-confidence routes to human queue');
    const lowConfidence = await routeProposal({
      client: triageClient,
      comment: {
        source: 'github',
        externalCommentId: 'github-comment-2',
        externalAuthor: 'someone',
        text: 'lol',
        context: {},
        receivedAt: new Date().toISOString(),
      },
      classifierName: 'heuristic-v1',
      triageSessionId: triageSession.id,
      territoryId: TERRITORY_ID,
      contentRef: 'triage/github-comment-2.md',
      threshold: 0.5,
      dryRun: false,
    });
    check('low-confidence comment routed to human queue', lowConfidence.outcome === 'routed_to_human_queue');
    check('no contribution created for low-confidence', lowConfidence.contributionId === null);
  } finally {
    await triageClient.close();
  }

  // Confirm noop adapter was registered as default
  check('noop adapter resolvable by name', noopDeliveryAdapter.name === 'noop');

  console.log('\n=========================================');
  if (failures === 0) {
    console.log('ALL SUBSTRATE CHECKS PASSED');
  } else {
    console.log(`${failures} SUBSTRATE CHECK(S) FAILED`);
  }
  console.log('=========================================');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SUBSTRATE SMOKE CRASHED:', err);
  process.exit(2);
});
