#!/usr/bin/env -S npx tsx
//
// Schema-invariant smoke tests. These assert contracts that the write
// library never directly exercises, so library-only tests cannot detect
// regressions:
//
//   2. ADR-005 append-only on decisions: UPDATE / DELETE rejected by the
//      trigger even under service_role (which bypasses RLS).
//   3. RLS default-deny baseline: as the `authenticated` role (not bypass),
//      reads return 0 rows and writes are rejected on every table. M2 will
//      layer JWT-mapped policies over this baseline; if the baseline isn't
//      actually deny, M2 won't catch the gap.
//   4. ADR-036 immortal attribution: deleting a session does not strip
//      author_composer_id from contributions; only author_session_id is
//      nulled (ON DELETE SET NULL).
//   5. Stale fencing token rejected: after release+re-acquire on the same
//      scope, the original token no longer matches any active lock and
//      an update() carrying it must fail with CONFLICT.
//   6. ADR-035 effective_decision: the GENERATED ... STORED column
//      computes COALESCE(override_decision, classifier_decision) for both
//      branches; the override CHECK enforces non-empty justification.
//   7. M4 allocate_broadcast_seq: per-project monotonic; nonexistent
//      project_id rejected; per-project isolation. Mirrors the existing
//      fencing-token / ADR-number allocator contracts.
//
// Run:  npx tsx scripts/test/__smoke__/schema-invariants.smoke.ts

import { Client } from 'pg';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AtelierClient, AtelierError } from '../../sync/lib/write.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

// Per-test fresh fixtures. Append-only decisions (ADR-005) block any
// cascade delete from projects, so we don't share project rows across
// test blocks -- each block calls seed() which generates new uuids.
interface Fixture {
  projectId: string;
  composerId: string;
  territoryId: string;
}

async function seed(): Promise<Fixture> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO projects (name, repo_url, template_version)
       VALUES ('schema-invariants', 'https://example.invalid/si', '1.0')
       RETURNING id`,
    );
    const projectId = rows[0]!.id;
    const { rows: composerRows } = await c.query<{ id: string }>(
      `INSERT INTO composers (project_id, email, display_name, discipline, identity_subject)
       VALUES ($1, $2, 'SI Composer', 'dev', $3)
       RETURNING id`,
      [projectId, `si-${projectId.slice(0, 8)}@invalid.test`, `sub-si-${projectId.slice(0, 8)}`],
    );
    const composerId = composerRows[0]!.id;
    const { rows: terrRows } = await c.query<{ id: string }>(
      `INSERT INTO territories (project_id, name, owner_role, review_role, scope_kind, scope_pattern)
       VALUES ($1, 'si-territory', 'dev', 'architect', 'files', ARRAY['si/**'])
       RETURNING id`,
      [projectId],
    );
    const territoryId = terrRows[0]!.id;
    return { projectId, composerId, territoryId };
  } finally {
    await c.end();
  }
}

// =========================================================================
// [2] ADR-005 append-only on decisions
// =========================================================================
async function testAppendOnly(): Promise<void> {
  console.log('\n[2] ADR-005 append-only on decisions');
  const fx = await seed();
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    // Run as service_role -- the role that bypasses RLS in production. The
    // trigger must fire regardless of RLS bypass.
    await c.query(`SET ROLE service_role`);
    const { rows: roleRows } = await c.query<{ rolname: string; rolbypassrls: boolean }>(
      `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    check('running as service_role with bypassrls=true', roleRows[0]?.rolbypassrls === true, `rolname=${roleRows[0]?.rolname}`);

    const { rows: insertRows } = await c.query<{ id: string }>(
      `INSERT INTO decisions (project_id, author_composer_id, trace_ids, category, summary, rationale, repo_commit_sha)
       VALUES ($1, $2, ARRAY['ADR-AO'], 'architecture', 'Append-only smoke', 'Verifies trigger', 'deadbeef')
       RETURNING id`,
      [fx.projectId, fx.composerId],
    );
    const decisionId = insertRows[0]!.id;

    // UPDATE attempt under service_role
    let updateRejected = false;
    let updateMessage = '';
    try {
      await c.query(`UPDATE decisions SET summary = 'TAMPERED' WHERE id = $1`, [decisionId]);
    } catch (err) {
      updateRejected = true;
      updateMessage = String((err as Error).message);
    }
    check('UPDATE rejected by trigger', updateRejected);
    check('error message names ADR-005', updateMessage.includes('ADR-005'));

    // DELETE attempt under service_role
    let deleteRejected = false;
    try {
      await c.query(`DELETE FROM decisions WHERE id = $1`, [decisionId]);
    } catch {
      deleteRejected = true;
    }
    check('DELETE rejected by trigger', deleteRejected);

    // Cascade-delete attempt: deleting the project must also be blocked
    // because decisions cascade-delete by FK and the trigger fires for
    // each cascaded row. This confirms append-only protects against
    // indirect deletion paths.
    await c.query(`RESET ROLE`);
    let cascadeBlocked = false;
    try {
      await c.query(`DELETE FROM projects WHERE id = $1`, [fx.projectId]);
    } catch {
      cascadeBlocked = true;
    }
    check('cascade DELETE through projects blocked by trigger', cascadeBlocked);

    const { rows: rowsAfter } = await c.query<{ summary: string }>(
      `SELECT summary FROM decisions WHERE id = $1`,
      [decisionId],
    );
    check('row unchanged after all rejected mutations', rowsAfter[0]?.summary === 'Append-only smoke');
  } finally {
    await c.query(`RESET ROLE`).catch(() => {});
    await c.end();
  }
}

// =========================================================================
// [3] RLS default-deny baseline across all tables
// =========================================================================
async function testRlsBaseline(): Promise<void> {
  console.log('\n[3] RLS default-deny baseline (authenticated role; no policies)');
  const fx = await seed();

  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    // Insert a session as superuser so there's at least one row whose
    // visibility under RLS we can confirm.
    await c.query(
      `INSERT INTO sessions (project_id, composer_id, surface) VALUES ($1, $2, 'terminal')`,
      [fx.projectId, fx.composerId],
    );

    await c.query(`SET ROLE authenticated`);
    const tables = [
      'projects', 'composers', 'sessions', 'territories',
      'contributions', 'decisions', 'locks', 'contracts',
      'telemetry', 'delivery_sync_state',
    ];

    // Reads under authenticated must return 0 rows (RLS filters all rows
    // when no policy permits read).
    for (const t of tables) {
      const { rows } = await c.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${t}`,
      );
      check(`RLS hides all rows in ${t} from authenticated`, rows[0]?.count === '0');
    }

    // Writes must error with row-level security violation.
    let projectsInsertBlocked = false;
    try {
      await c.query(
        `INSERT INTO projects (name, repo_url, template_version) VALUES ('bad', 'x', '1.0')`,
      );
    } catch (err) {
      projectsInsertBlocked = /row-level security|new row violates|RLS/i.test(String((err as Error).message));
    }
    check('INSERT into projects blocked by RLS', projectsInsertBlocked);

    let telemetryInsertBlocked = false;
    try {
      await c.query(
        `INSERT INTO telemetry (project_id, action, outcome, metadata) VALUES ($1, 'x', 'ok', '{}'::jsonb)`,
        [fx.projectId],
      );
    } catch (err) {
      telemetryInsertBlocked = /row-level security|new row violates|RLS/i.test(String((err as Error).message));
    }
    check('INSERT into telemetry blocked by RLS', telemetryInsertBlocked);

    let decisionsInsertBlocked = false;
    try {
      await c.query(
        `INSERT INTO decisions (project_id, author_composer_id, trace_ids, category, summary, rationale, repo_commit_sha)
         VALUES ($1, $2, ARRAY['t'], 'architecture', 's', 'r', 'sha')`,
        [fx.projectId, fx.composerId],
      );
    } catch (err) {
      decisionsInsertBlocked = /row-level security|new row violates|RLS/i.test(String((err as Error).message));
    }
    check('INSERT into decisions blocked by RLS', decisionsInsertBlocked);

    await c.query(`RESET ROLE`);
  } finally {
    await c.query(`RESET ROLE`).catch(() => {});
    await c.end();
  }
}

// =========================================================================
// [4] ADR-036 immortal attribution survives session reap
// =========================================================================
async function testAttributionSurvivesReap(): Promise<void> {
  console.log('\n[4] ADR-036 immortal attribution survives session reap');
  const fx = await seed();

  const lib = new AtelierClient({ databaseUrl: DB_URL });
  try {
    const session = await lib.createSession({
      projectId: fx.projectId,
      composerId: fx.composerId,
      surface: 'terminal',
    });
    const claim = await lib.claim({
      contributionId: null,
      sessionId: session.id,
      kind: 'implementation',
      traceIds: ['ADR-036-test'],
      territoryId: fx.territoryId,
      contentRef: 'si/example.ts',
      artifactScope: ['si/example.ts'],
    });

    // Reap the session by deleting it (simulates the reaper transition).
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    try {
      await c.query(`DELETE FROM sessions WHERE id = $1`, [session.id]);

      const { rows } = await c.query<{
        author_composer_id: string | null;
        author_session_id: string | null;
        state: string;
      }>(
        `SELECT author_composer_id, author_session_id, state FROM contributions WHERE id = $1`,
        [claim.contributionId],
      );
      const row = rows[0]!;
      check('author_composer_id immortal across session reap', row.author_composer_id === fx.composerId);
      check('author_session_id nulled on session reap (ON DELETE SET NULL)', row.author_session_id === null);
      check('contribution state preserved (still claimed)', row.state === 'claimed');
    } finally {
      await c.end();
    }
  } finally {
    await lib.close();
  }
}

// =========================================================================
// [5] Stale fencing token rejected after release+re-acquire
// =========================================================================
async function testStaleFencingToken(): Promise<void> {
  console.log('\n[5] Stale fencing token rejected after release+re-acquire');
  const fx = await seed();

  const lib = new AtelierClient({ databaseUrl: DB_URL });
  try {
    const session = await lib.createSession({
      projectId: fx.projectId,
      composerId: fx.composerId,
      surface: 'terminal',
    });
    const claim = await lib.claim({
      contributionId: null,
      sessionId: session.id,
      kind: 'implementation',
      traceIds: ['stale-token-test'],
      territoryId: fx.territoryId,
      contentRef: 'si/stale.ts',
      artifactScope: ['si/stale.ts'],
    });

    // Acquire then release lock A, then acquire a new lock on the same scope.
    const lockA = await lib.acquireLock({
      contributionId: claim.contributionId,
      sessionId: session.id,
      artifactScope: ['si/stale.ts'],
    });
    await lib.releaseLock({ lockId: lockA.lockId, sessionId: session.id });

    const lockB = await lib.acquireLock({
      contributionId: claim.contributionId,
      sessionId: session.id,
      artifactScope: ['si/stale.ts'],
    });
    check('re-acquired token is monotonically greater (counter advanced)', lockB.fencingToken > lockA.fencingToken);

    // Update with the stale token must reject. The active lock now carries
    // tokenB; tokenA points at the released (now-deleted) lock row.
    let staleRejected = false;
    let staleCode: string | undefined;
    try {
      await lib.update({
        contributionId: claim.contributionId,
        sessionId: session.id,
        contentRef: 'si/stale-v2.ts',
        fencingToken: lockA.fencingToken,
      });
    } catch (err) {
      if (err instanceof AtelierError) {
        staleRejected = true;
        staleCode = err.code;
      }
    }
    check('stale fencing token rejected', staleRejected);
    check('rejection code is CONFLICT', staleCode === 'CONFLICT');

    // Sanity: the fresh token works.
    const ok = await lib.update({
      contributionId: claim.contributionId,
      sessionId: session.id,
      contentRef: 'si/stale-v2.ts',
      fencingToken: lockB.fencingToken,
    });
    check('fresh token accepted', ok.contributionId === claim.contributionId);
  } finally {
    await lib.close();
  }
}

// =========================================================================
// [6] ADR-035 effective_decision generated column
// =========================================================================
async function testEffectiveDecision(): Promise<void> {
  console.log('\n[6] ADR-035 effective_decision generated column');
  const fx = await seed();

  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    // Branch A: no override -> effective = classifier
    await c.query(
      `INSERT INTO contracts (project_id, territory_id, name, schema, version, classifier_decision, classifier_reasons)
       VALUES ($1, $2, 'contract-a', '{}'::jsonb, 1000, 'breaking', '[]'::jsonb)`,
      [fx.projectId, fx.territoryId],
    );
    const { rows: a } = await c.query<{ effective_decision: string }>(
      `SELECT effective_decision FROM contracts WHERE name = 'contract-a' AND project_id = $1`,
      [fx.projectId],
    );
    check('no override: effective = classifier (breaking)', a[0]?.effective_decision === 'breaking');

    // Branch B: override flips classifier
    await c.query(
      `INSERT INTO contracts (project_id, territory_id, name, schema, version, classifier_decision, classifier_reasons,
                              override_decision, override_justification)
       VALUES ($1, $2, 'contract-b', '{}'::jsonb, 1000, 'breaking', '[]'::jsonb,
               'additive', 'territory-owner judgement: existing consumers tolerate the change')`,
      [fx.projectId, fx.territoryId],
    );
    const { rows: b } = await c.query<{ effective_decision: string }>(
      `SELECT effective_decision FROM contracts WHERE name = 'contract-b' AND project_id = $1`,
      [fx.projectId],
    );
    check('override flips classifier: effective = override (additive)', b[0]?.effective_decision === 'additive');

    // Branch C: missing justification -> CHECK rejects
    let missingJustRejected = false;
    try {
      await c.query(
        `INSERT INTO contracts (project_id, territory_id, name, schema, version, classifier_decision, classifier_reasons,
                                override_decision)
         VALUES ($1, $2, 'contract-c', '{}'::jsonb, 1000, 'breaking', '[]'::jsonb, 'additive')`,
        [fx.projectId, fx.territoryId],
      );
    } catch (err) {
      missingJustRejected = /override_justification|check constraint|contracts_override_justification_present/i
        .test(String((err as Error).message));
    }
    check('override without justification rejected by CHECK', missingJustRejected);

    // Branch D: empty/whitespace-only justification -> CHECK rejects
    let emptyJustRejected = false;
    try {
      await c.query(
        `INSERT INTO contracts (project_id, territory_id, name, schema, version, classifier_decision, classifier_reasons,
                                override_decision, override_justification)
         VALUES ($1, $2, 'contract-d', '{}'::jsonb, 1000, 'breaking', '[]'::jsonb, 'additive', '   ')`,
        [fx.projectId, fx.territoryId],
      );
    } catch (err) {
      emptyJustRejected = /override_justification|check constraint|contracts_override_justification_present/i
        .test(String((err as Error).message));
    }
    check('override with whitespace-only justification rejected by CHECK', emptyJustRejected);

    // Verify effective_decision is non-writable (it's GENERATED ALWAYS)
    let writeRejected = false;
    try {
      await c.query(
        `UPDATE contracts SET effective_decision = 'additive' WHERE name = 'contract-a' AND project_id = $1`,
        [fx.projectId],
      );
    } catch (err) {
      writeRejected = /generated|cannot be used|column "effective_decision"/i.test(String((err as Error).message));
    }
    check('UPDATE on GENERATED effective_decision rejected', writeRejected);
  } finally {
    await c.end();
  }
}

// =========================================================================
// [7] M4 broadcast seq: per-project monotonic + nonexistent-project rejected
//
// Migration 5 mirrors the allocate_fencing_token / allocate_adr_number
// pattern (atomic UPDATE ... RETURNING, raises on missing project). The
// SQL function's atomicity is what enforces multi-instance monotonicity
// in production -- the broadcast smoke asserts the wire contract; this
// invariant block asserts the SQL contract directly.
// =========================================================================
async function testBroadcastSeqAllocator(): Promise<void> {
  console.log('\n[7] M4 broadcast seq allocator (allocate_broadcast_seq)');
  const fix = await seed();
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    const { rows: r1 } = await c.query<{ allocate_broadcast_seq: string }>(
      `SELECT allocate_broadcast_seq($1)`,
      [fix.projectId],
    );
    const { rows: r2 } = await c.query<{ allocate_broadcast_seq: string }>(
      `SELECT allocate_broadcast_seq($1)`,
      [fix.projectId],
    );
    const { rows: r3 } = await c.query<{ allocate_broadcast_seq: string }>(
      `SELECT allocate_broadcast_seq($1)`,
      [fix.projectId],
    );
    const seq1 = BigInt(r1[0]!.allocate_broadcast_seq);
    const seq2 = BigInt(r2[0]!.allocate_broadcast_seq);
    const seq3 = BigInt(r3[0]!.allocate_broadcast_seq);
    check('first allocation returns starting seq (>=1)', seq1 >= 1n, seq1.toString());
    check('seqs strictly monotonic (1 < 2)', seq1 < seq2);
    check('seqs strictly monotonic (2 < 3)', seq2 < seq3);
    check(
      'no gaps in single-writer sequence',
      seq2 === seq1 + 1n && seq3 === seq2 + 1n,
      `${seq1}, ${seq2}, ${seq3}`,
    );

    // Per-project isolation: a fresh project starts at its own counter,
    // not affected by the seqs allocated above.
    const fix2 = await seed();
    const { rows: rOther } = await c.query<{ allocate_broadcast_seq: string }>(
      `SELECT allocate_broadcast_seq($1)`,
      [fix2.projectId],
    );
    const otherSeq = BigInt(rOther[0]!.allocate_broadcast_seq);
    check(
      'separate project gets independent seq',
      otherSeq < seq3,
      `project1 seq=${seq3}, project2 seq=${otherSeq}`,
    );

    // Missing project must raise foreign_key_violation, mirroring the
    // allocate_fencing_token / allocate_adr_number contract.
    let missingRejected = false;
    let missingMessage = '';
    try {
      await c.query(`SELECT allocate_broadcast_seq($1)`, ['00000000-0000-0000-0000-000000000000']);
    } catch (err) {
      missingRejected = true;
      missingMessage = String((err as Error).message);
    }
    check('nonexistent project_id rejected', missingRejected, missingMessage.slice(0, 80));
  } finally {
    await c.end();
  }
}

// =========================================================================
// [8] E1 atelier_schema_versions baseline tracking
//
// Per BRD-OPEN-QUESTIONS section 29 (E1 substrate). The bootstrap migration
// 20260504000010_atelier_schema_versions.sql creates the tracking table
// and inserts a row for every existing migration. Assert: table exists +
// every supabase/migrations/*.sql file has a corresponding row.
// =========================================================================
async function testSchemaVersionsBaseline(): Promise<void> {
  console.log('\n[8] E1 atelier_schema_versions baseline tracking');
  const migDir = resolve(import.meta.dirname, '..', '..', '..', 'supabase', 'migrations');
  const onDisk = (await readdir(migDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    const { rows: tableRows } = await c.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name='atelier_schema_versions'
       ) AS exists`,
    );
    check('atelier_schema_versions table exists', tableRows[0]?.exists === true);

    const { rows: applied } = await c.query<{ filename: string; content_sha256: string }>(
      `SELECT filename, content_sha256 FROM atelier_schema_versions ORDER BY filename`,
    );
    const appliedNames = new Set(applied.map((r) => r.filename));

    for (const f of onDisk) {
      check(`baseline row present for ${f}`, appliedNames.has(f));
    }

    // Bootstrap rows (migration 10 + any baseline-extension migrations
    // that backfill tracking rows for post-bootstrap migrations applied
    // via supabase CLI) use sentinel hash 'bootstrap'. Their self-rows
    // skip drift check because the file's own SHA includes its own
    // INSERT statement (chicken-and-egg). Every other row carries the
    // canonical 64-hex SHA-256 of the migration file content.
    const bootstrap = applied.find((r) => r.filename === '20260504000010_atelier_schema_versions.sql');
    check('bootstrap row content_sha256 is the sentinel', bootstrap?.content_sha256 === 'bootstrap');
    const nonBootstrap = applied.filter((r) => r.content_sha256 !== 'bootstrap');
    check(
      'all non-bootstrap rows carry 64-hex SHA-256 hashes',
      nonBootstrap.every((r) => /^[0-9a-f]{64}$/.test(r.content_sha256)),
    );
  } finally {
    await c.end();
  }
}

// =========================================================================
// Run
// =========================================================================
async function main(): Promise<void> {
  await testAppendOnly();
  await testRlsBaseline();
  await testAttributionSurvivesReap();
  await testStaleFencingToken();
  await testEffectiveDecision();
  await testBroadcastSeqAllocator();
  await testSchemaVersionsBaseline();

  console.log('\n=========================================');
  if (failures === 0) console.log('ALL SCHEMA INVARIANT CHECKS PASSED');
  else console.log(`${failures} SCHEMA INVARIANT CHECK(S) FAILED`);
  console.log('=========================================');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SCHEMA INVARIANT SMOKE CRASHED:', err);
  process.exit(2);
});
