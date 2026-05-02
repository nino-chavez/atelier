# Scale-ceiling load harness

**Purpose:** measure the per-component performance envelope of a running Atelier substrate. Drives synthetic load + writes timing to the `telemetry` table so `/atelier/observability` can surface results without bespoke tooling.

**Source spec:** `docs/testing/scale-ceiling-benchmark-plan.md` — the harness implements scenarios from §6 of that plan; the v1 envelope commitment lives in `docs/architecture/audits/scale-ceiling-envelope-v1.md`.

**Invocation:**

```bash
ATELIER_DATASTORE_URL=postgresql://... \
ATELIER_ENDPOINT_URL=http://localhost:3030/api/mcp \
ATELIER_BEARER=<token from scripts/bootstrap/issue-bearer.ts> \
ATELIER_PROJECT_ID=<seeded project uuid> \
  npx tsx scripts/test/scale/load-runner.ts \
    --scenario A \
    --duration 60 \
    --concurrent-sessions 5
```

**Scenario coverage:**

| Scenario | What it measures | Status |
|---|---|---|
| A | Endpoint sustained load (per-tool p50/p95/p99 under concurrent sessions) | implemented |
| B | Reaper cycle time (sessions table scan latency) | implemented |
| C | Broadcast fanout (per-subscriber receive latency at envelope subscriber count) | stub — see audit doc |
| D | Vector kNN at scale (find_similar p95 at envelope + 10x index size) | stub — see audit doc |
| E | Cross-dimension stress (full-envelope mixed traffic over 1+ hour) | stub — see audit doc |

**Why C/D/E are stubs at M7:** per the kickoff bounded scope: ship the harness skeleton + observability hooks + the v1 envelope commitment; don't push to find the actual ceiling. Implementing C/D/E requires more elaborate setup (live broadcast subscribers, pre-populated vector index, realistic mixed traffic for an hour). The skeleton + scenarios A/B prove the pattern. C/D/E follow the same shape (worker pool + RPC timing + telemetry write) when an operator wants empirical data.

**Output:**

- Per-operation summary (count, errors, p50, p95, p99) on stdout
- Per-operation rows in `telemetry` table tagged `action='scale_test.<scenario>.<op>'` with `duration_ms` populated and `metadata.scenario` + `metadata.harness_run_at` for filtering
- Exit 0 if all p95 within NFR targets (500ms for tool calls, 100ms for reaper scan); exit 1 if any fail; exit 2 on configuration error

**Querying results:**

```sql
-- Latest scale-test run per scenario + op
SELECT action, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms, count(*)
FROM telemetry
WHERE action LIKE 'scale_test.%'
  AND created_at > now() - interval '1 hour'
GROUP BY action
ORDER BY action;
```

When `/atelier/observability` lights up (M7 Track 1), the scale-test rows appear automatically — no separate dashboard needed.

**Pre-flight requirements:**

- Atelier substrate running (local-bootstrap.md OR first-deploy.md)
- A composer seeded for the bearer's email (per `scripts/bootstrap/seed-composer.ts`)
- The bearer is fresh (1-hour TTL per ADR-028; rotate via `scripts/bootstrap/rotate-bearer.ts`)
- The project_id matches the composer's seeded project

**Cross-references:**

- `docs/testing/scale-ceiling-benchmark-plan.md` — the plan this harness implements
- `docs/architecture/audits/scale-ceiling-envelope-v1.md` — v1 envelope commitment + measured-vs-hypothesis tracker
- ARCH §9.6 — deployment scale envelope (committed canonical numbers)
- BRD-OPEN-QUESTIONS §7 — the open question this work addresses
- ADR-046 — deploy strategy (the substrate this harness measures runs on Vercel + Supabase Cloud per ADR-027 reference stack)
