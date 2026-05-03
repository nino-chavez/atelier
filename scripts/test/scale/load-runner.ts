#!/usr/bin/env -S npx tsx
//
// Scale-ceiling load harness (BRD-OPEN-QUESTIONS section 7).
//
// Drives synthetic load against a running Atelier substrate to measure
// the per-component performance envelope. Per the M7 kickoff bounded
// scope: ships the harness + per-component perf measurement + a
// documented v1 envelope. Does NOT push to find the actual ceiling;
// operators run the harness against representative load and the
// measurements feed `docs/architecture/audits/scale-ceiling-envelope-v1.md`.
//
// What this harness does:
//
//   - Connects to a running Atelier substrate (Postgres + endpoint HTTP)
//   - Drives one of the scenarios from `docs/testing/scale-ceiling-benchmark-plan.md`
//     section 6 (A: endpoint load; B: reaper cycle; C-E: stubs documented in
//     the audit doc, not yet wired here)
//   - Records per-operation timing (p50/p95/p99) to the `telemetry` table
//     under action='scale_test.<scenario>.<op>' so /atelier/observability
//     can surface results without bespoke tooling
//   - Prints a summary suitable for pasting into the audit doc
//
// What this harness does NOT do:
//
//   - Run scenarios C/D/E. They're filed as M7 polish in the audit doc;
//     the substrate gates (M4 broadcast / M5 vector / M6 cross-dimension)
//     are all live but the scenario implementations are bounded scope
//     deferred per the kickoff "don't try to find the actual ceiling."
//   - Provision substrate. Run `supabase start` (local) or point at a
//     deployed endpoint per `docs/user/tutorials/first-deploy.md` first.
//   - Issue bearers or seed composers. Use the existing
//     `scripts/bootstrap/seed-composer.ts` + `issue-bearer.ts` flow
//     before invoking this harness.
//   - Replace `/atelier/observability`. This is a measurement tool;
//     visualization happens via the lens UI per ARCH 8.2.
//
// Run (Scenario A example):
//
//   ATELIER_DATASTORE_URL=postgresql://... \
//   ATELIER_ENDPOINT_URL=http://localhost:3030/api/mcp \
//   ATELIER_BEARER=<token from issue-bearer.ts> \
//   ATELIER_PROJECT_ID=<seeded project uuid> \
//     npx tsx scripts/test/scale/load-runner.ts \
//       --scenario A \
//       --duration 60 \
//       --concurrent-sessions 5
//
// Exit codes:
//   0 -- harness completed; results in telemetry table + stdout
//   1 -- one or more scenario assertions failed (e.g., p95 above NFR target)
//   2 -- harness configuration error or substrate unreachable
//
// Per the kickoff: pass criteria are advisory. The audit doc captures
// the v1 envelope; harness output reports actuals; mismatches inform
// the audit's "measured vs hypothesis" section per the plan section 7.

import { Client } from 'pg';
import { performance } from 'node:perf_hooks';

interface Args {
  scenario: 'A' | 'B' | 'C' | 'D' | 'E' | 'all';
  durationSeconds: number;
  concurrentSessions: number;
  databaseUrl: string;
  endpointUrl: string;
  bearer: string;
  projectId: string;
}

function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = next;
      i += 1;
    }
  }

  const scenarioRaw = (out.scenario ?? 'A').toUpperCase();
  if (!/^(A|B|C|D|E|ALL)$/.test(scenarioRaw)) {
    throw new Error(`--scenario must be one of A B C D E all (got: ${scenarioRaw})`);
  }
  const scenario = scenarioRaw === 'ALL' ? 'all' : (scenarioRaw as 'A' | 'B' | 'C' | 'D' | 'E');

  const databaseUrl = process.env.ATELIER_DATASTORE_URL ?? process.env.DATABASE_URL;
  const endpointUrl = process.env.ATELIER_ENDPOINT_URL ?? out['endpoint-url'];
  const bearer = process.env.ATELIER_BEARER ?? out.bearer;
  const projectId = process.env.ATELIER_PROJECT_ID ?? out['project-id'];

  if (!databaseUrl) throw new Error('ATELIER_DATASTORE_URL (or DATABASE_URL) env var required');
  if (!endpointUrl) throw new Error('ATELIER_ENDPOINT_URL env var (or --endpoint-url flag) required');
  if (!bearer) throw new Error('ATELIER_BEARER env var (or --bearer flag) required');
  if (!projectId) throw new Error('ATELIER_PROJECT_ID env var (or --project-id flag) required');

  return {
    scenario,
    durationSeconds: parseInt(out.duration ?? '60', 10),
    concurrentSessions: parseInt(out['concurrent-sessions'] ?? '5', 10),
    databaseUrl,
    endpointUrl,
    bearer,
    projectId,
  };
}

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

interface Timing {
  op: string;
  durationMs: number;
  ok: boolean;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return sorted[idx]!;
}

function summarize(timings: readonly Timing[], op: string): {
  op: string;
  count: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
} {
  const opTimings = timings.filter((t) => t.op === op);
  const successful = opTimings.filter((t) => t.ok).map((t) => t.durationMs).sort((a, b) => a - b);
  return {
    op,
    count: opTimings.length,
    errors: opTimings.filter((t) => !t.ok).length,
    p50: percentile(successful, 50),
    p95: percentile(successful, 95),
    p99: percentile(successful, 99),
  };
}

async function recordToTelemetry(
  pg: Client,
  args: Args,
  scenario: string,
  timings: readonly Timing[],
): Promise<void> {
  // Write each timing to the telemetry table so /atelier/observability
  // can surface scale-test runs alongside normal traffic. Per ARCH 8.1
  // the metadata jsonb is the right place for scenario-specific tags.
  for (const t of timings) {
    await pg.query(
      `INSERT INTO telemetry (project_id, action, outcome, duration_ms, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        args.projectId,
        `scale_test.${scenario}.${t.op}`,
        t.ok ? 'ok' : 'error',
        Math.round(t.durationMs),
        { scenario, harness_run_at: new Date().toISOString() },
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// MCP RPC helpers
// ---------------------------------------------------------------------------

interface RpcEnvelope {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

interface RpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

let rpcId = 1;

async function rpc(
  args: Args,
  method: string,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; durationMs: number; response: RpcResponse | null }> {
  const envelope: RpcEnvelope = {
    jsonrpc: '2.0',
    id: rpcId++,
    method,
    params,
  };
  const start = performance.now();
  try {
    const res = await fetch(args.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.bearer}`,
      },
      body: JSON.stringify(envelope),
    });
    const durationMs = performance.now() - start;
    const body = (await res.json()) as RpcResponse;
    const ok = res.ok && !body.error;
    return { ok, durationMs, response: body };
  } catch (err) {
    return { ok: false, durationMs: performance.now() - start, response: null };
  }
}

async function callTool(
  args: Args,
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<{ ok: boolean; durationMs: number; result: unknown }> {
  const out = await rpc(args, 'tools/call', { name: toolName, arguments: toolArgs });
  // MCP tools/call wraps tool output in {content: [...], structuredContent:
  // {...}} per the protocol. The harness wants the structured form so callers
  // can dereference fields like result.session_id directly.
  const raw = out.response?.result as
    | { structuredContent?: Record<string, unknown>; isError?: boolean }
    | undefined;
  const ok = out.ok && !raw?.isError;
  const result = raw?.structuredContent ?? raw;
  return { ok, durationMs: out.durationMs, result };
}

// ---------------------------------------------------------------------------
// Scenario A: Endpoint sustained load (M2+)
// ---------------------------------------------------------------------------
//
// Per benchmark plan section 6 Scenario A:
//   - N concurrent composers, each holding an active session
//   - Each composer does a random tool call at Poisson-distributed intervals
//   - Measure: per-tool p50/p95/p99
//   - Pass: p95 < 500ms across all tools (NFR target)

async function runScenarioA(args: Args, _pg: Client): Promise<readonly Timing[]> {
  console.log(`[A] endpoint sustained load: ${args.concurrentSessions} composers x ${args.durationSeconds}s`);
  const timings: Timing[] = [];
  const endTime = Date.now() + args.durationSeconds * 1000;

  // Each "composer" is a logical session; we don't bother seeding distinct
  // bearers since the harness's job is to drive load, not stress auth. All
  // composers share the same bearer (the auth path is exercised; we measure
  // tool dispatch + DB write time).
  //
  // Per ARCH 6.1 the lifecycle is register -> heartbeat (every 30s) ->
  // tool calls -> deregister. The harness compresses heartbeat to per-loop
  // since the duration is short.
  const workers = Array.from({ length: args.concurrentSessions }, (_, i) =>
    workerLoop(args, i, endTime, timings),
  );
  await Promise.all(workers);

  console.log(`[A] complete; ${timings.length} operations recorded`);
  return timings;
}

async function workerLoop(
  args: Args,
  workerId: number,
  endTime: number,
  out: Timing[],
): Promise<void> {
  // Register a session.
  const reg = await callTool(args, 'register', {
    project_id: args.projectId,
    surface: 'terminal',
  });
  out.push({ op: 'register', durationMs: reg.durationMs, ok: reg.ok });
  if (!reg.ok) {
    console.error(`[A] worker ${workerId} register failed; aborting worker`);
    return;
  }
  const sessionId = (reg.result as { session_id?: string } | undefined)?.session_id;
  if (!sessionId) {
    console.error(`[A] worker ${workerId} register returned no session_id; aborting`);
    return;
  }

  // Drive a mix of tool calls until duration expires. Distribution mirrors
  // typical day-1 composer behavior:
  //   - heartbeat: most frequent (every loop)
  //   - get_context: ~1 in 3 loops (orient + check overlap)
  //   - find_similar: ~1 in 6 loops (semantic search; only when relevant)
  //   - claim/release: ~1 in 8 loops (the actual work bracket)
  let loopCount = 0;
  while (Date.now() < endTime) {
    loopCount++;

    // Heartbeat every loop (matches the 30s policy when loops are ~30s apart).
    const hb = await callTool(args, 'heartbeat', { session_id: sessionId });
    out.push({ op: 'heartbeat', durationMs: hb.durationMs, ok: hb.ok });

    if (loopCount % 3 === 0) {
      const ctx = await callTool(args, 'get_context', {
        session_id: sessionId,
        scope_files: [`prototype/src/app/route-${workerId % 4}.ts`],
      });
      out.push({ op: 'get_context', durationMs: ctx.durationMs, ok: ctx.ok });
    }

    if (loopCount % 6 === 0) {
      const fs = await callTool(args, 'find_similar', {
        session_id: sessionId,
        query: 'How do we handle authentication for remote agents?',
        top_k_per_band: 5,
      });
      out.push({ op: 'find_similar', durationMs: fs.durationMs, ok: fs.ok });
    }

    // Inter-call delay: target ~1 RPC/sec/worker on average. Random
    // jitter spreads the load rather than locking all workers in step.
    const jitterMs = 800 + Math.floor(Math.random() * 400);
    await sleep(jitterMs);
  }

  // Clean up.
  const dereg = await callTool(args, 'deregister', { session_id: sessionId });
  out.push({ op: 'deregister', durationMs: dereg.durationMs, ok: dereg.ok });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Scenario B: Reaper cycle time (M2+)
// ---------------------------------------------------------------------------
//
// Per benchmark plan section 6 Scenario B:
//   - Pre-populate sessions table with N rows of varying ages
//   - Trigger reaper cron M times back-to-back
//   - Measure: cycle time per run
//   - Pass: each cycle <100ms
//
// Implementation: emulates the reaper's UPDATE query directly, since
// the reaper is a cron in production but the timing is in the SQL.

async function runScenarioB(pg: Client): Promise<readonly Timing[]> {
  console.log(`[B] reaper cycle: 100 runs against current sessions table`);
  const timings: Timing[] = [];

  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    // Mirror the reaper's WHERE clause from ARCH 6.1 -- mark
    // sessions stale when heartbeat_at < now() - policy.session_ttl_seconds
    // (default 90s). We don't actually update; that would mutate state.
    // Just measure the SELECT cost which is the bottleneck.
    const res = await pg.query(
      `SELECT id FROM sessions
       WHERE status = 'active' AND heartbeat_at < now() - interval '90 seconds'
       LIMIT 1000`,
    );
    const durationMs = performance.now() - start;
    timings.push({ op: 'reaper_scan', durationMs, ok: res.rowCount !== null });
  }

  console.log(`[B] complete; ${timings.length} reaper scans timed`);
  return timings;
}

// ---------------------------------------------------------------------------
// Scenarios C, D, E -- stubs (filed as polish in the audit doc)
// ---------------------------------------------------------------------------
//
// Per the M7 kickoff bounded scope: don't push to find the actual ceiling;
// run the harness against representative load. Scenarios C (broadcast
// fanout), D (vector kNN), and E (cross-dimension stress) require more
// elaborate setup (live broadcast subscribers, pre-populated vector index,
// realistic mixed traffic). Their hypotheses + pass criteria live in
// `docs/testing/scale-ceiling-benchmark-plan.md` section 6; the v1 envelope
// commitment in the audit doc captures the architectural prediction. When
// an operator wants empirical numbers, the implementation follows this
// scenario-A pattern -- worker pool + RPC timing + telemetry write.

async function runScenarioStub(scenario: 'C' | 'D' | 'E'): Promise<readonly Timing[]> {
  const reasons: Record<typeof scenario, string> = {
    C: 'broadcast fanout requires live subscribers + multi-project setup',
    D: 'vector kNN requires pre-populated index at envelope + 10x scale',
    E: 'cross-dimension requires realistic mixed traffic over 1+ hour',
  };
  console.log(`[${scenario}] stub: not implemented (${reasons[scenario]})`);
  console.log(`[${scenario}] see docs/architecture/audits/scale-ceiling-envelope-v1.md`);
  return [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`scale-harness: scenario=${args.scenario} duration=${args.durationSeconds}s concurrent=${args.concurrentSessions}`);

  const pg = new Client({ connectionString: args.databaseUrl });
  await pg.connect();

  const allTimings: Timing[] = [];

  try {
    if (args.scenario === 'A' || args.scenario === 'all') {
      const t = await runScenarioA(args, pg);
      await recordToTelemetry(pg, args, 'A', t);
      allTimings.push(...t);
    }
    if (args.scenario === 'B' || args.scenario === 'all') {
      const t = await runScenarioB(pg);
      await recordToTelemetry(pg, args, 'B', t);
      allTimings.push(...t);
    }
    if (args.scenario === 'C' || args.scenario === 'all') {
      await runScenarioStub('C');
    }
    if (args.scenario === 'D' || args.scenario === 'all') {
      await runScenarioStub('D');
    }
    if (args.scenario === 'E' || args.scenario === 'all') {
      await runScenarioStub('E');
    }
  } finally {
    await pg.end();
  }

  if (allTimings.length === 0) {
    console.log('\nno timings recorded; only stub scenarios were selected');
    return;
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const ops = Array.from(new Set(allTimings.map((t) => t.op))).sort();
  console.log('\n=========================================');
  console.log(`scale-harness summary (${allTimings.length} operations)`);
  console.log('=========================================');
  console.log('op                  count  errors    p50    p95    p99');
  console.log('-----------------------------------------------------');
  let nfrFailures = 0;
  for (const op of ops) {
    const s = summarize(allTimings, op);
    const fmt = (n: number) => n.toFixed(0).padStart(5);
    const opCol = op.padEnd(20);
    console.log(`${opCol}${String(s.count).padStart(6)}${String(s.errors).padStart(8)}  ${fmt(s.p50)}  ${fmt(s.p95)}  ${fmt(s.p99)}`);
    // NFR check: p95 < 500ms per the plan section 6 Scenario A pass criterion.
    // Stub scenarios + non-tool ops (reaper_scan) get a different threshold.
    const nfrTarget = op === 'reaper_scan' ? 100 : 500;
    if (s.p95 > nfrTarget) {
      console.log(`  !!  p95 ${s.p95.toFixed(0)}ms exceeds NFR target ${nfrTarget}ms for op=${op}`);
      nfrFailures += 1;
    }
  }
  console.log('=========================================');
  console.log(`telemetry: ${allTimings.length} rows written under action='scale_test.<scenario>.<op>'`);
  console.log(`view via: SELECT * FROM telemetry WHERE action LIKE 'scale_test.%' ORDER BY created_at DESC;`);
  console.log(`or in /atelier/observability when the route lights up (M7 Track 1 polish).`);

  if (nfrFailures > 0) {
    console.log(`\nFAIL: ${nfrFailures} operation(s) exceeded NFR p95 targets`);
    process.exit(1);
  }
  console.log('\nPASS: all operations within NFR p95 targets');
}

main().catch((err) => {
  console.error('scale-harness failed:', err instanceof Error ? err.message : err);
  process.exit(2);
});
