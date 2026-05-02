# Scale-ceiling envelope v1 (BRD-OPEN-QUESTIONS §7 commitment)

**Status:** v1 envelope committed 2026-05-02 per the M7 Track 2 §7 bounded scope. Numbers below are the architectural prediction from `docs/testing/scale-ceiling-benchmark-plan.md` §4-5 — committed as the v1 envelope without empirical override pending operator runs of the harness.

**Audience:** adopters sizing their Atelier deployment (datastore tier, compute scale, expected concurrency); auditors verifying the envelope holds under their workload; future sessions running the harness against a deployed substrate to populate the "Measured (per run)" columns.

**Source materials:**

- `docs/testing/scale-ceiling-benchmark-plan.md` — design plan; this audit operationalizes its §4 (envelope) + §5 (sizing predictions) + §6 (scenarios)
- `scripts/test/scale/load-runner.ts` — harness implementing scenarios A/B end-to-end + stubs for C/D/E
- ARCH §9.6 — committed canonical envelope (mirrors this audit's §1)

---

## 1. v1 envelope commitment

These numbers represent the v1 reference impl's supported scale on **Supabase Pro + Vercel Pro**. Below the envelope, all documented NFRs (endpoint p95 <500ms, broadcast latency <2s, find_similar p95 <50ms) are expected to hold. Beyond, behavior is undefined-but-not-broken: things will work but may degrade past the NFRs.

| Dimension | v1 envelope | Beyond envelope |
|---|---|---|
| Projects per guild | 10 | Tier upgrade or split into multiple guilds |
| Composers per project | 20 | Same |
| Composers per guild (sum across projects) | 100 (assumes overlap) | Same |
| Contributions per project (lifetime) | 10,000 | Archive policy + tier upgrade |
| Contributions per guild (sum) | 50,000 | Same |
| Concurrent active sessions per project | 20 | Same |
| Concurrent active sessions per guild | 100 | Same |
| Decisions (ADRs) per project (lifetime) | 500 | Per-ADR file split per ADR-030; vector index handles comfortably |
| BRD stories per project | 200 | Same |
| Research artifacts per project | 1,000 | Same |
| Vector index rows per guild | 100,000 | 1M with tier upgrade; 10M+ needs sharding (v1.x) |
| Pub/sub messages per minute per project (peak) | 60 | Same |
| Pub/sub subscribers per project | 20 (= concurrent sessions) | Same |
| Find_similar QPS per project (peak) | 10 | Same |

**Total guild-level row count target: ~2M.**

Other tiers:

- **Free tier:** assume 1/4 of these envelope numbers (smaller connection pool, shorter log retention, asymptotic auto-pause). Adopters evaluating Atelier at hobby scale; not for production.
- **Enterprise tier:** assume ~10x these numbers (larger connection pool, dedicated compute, no auto-pause). Adopters with realistic team-scale workloads.

---

## 2. Architectural sizing predictions (v1 hypothesis)

Pre-benchmark hypotheses about where bottlenecks live. The harness's job is to confirm or contradict these. Per BUILD-SEQUENCE §M7 bounded scope, M7 ships the harness + the prediction commitment; the empirical override happens when operators run the harness against representative load.

### 2.1 Reaper cron (Scenario B)

Per ARCH §6.1: reaper scans `sessions` for `heartbeat_at < now() - session_ttl_seconds` (default 90s). Index on `(heartbeat_at) WHERE status='active'` per ARCH §5.2.

**Hypothesis:** Reaper completes in <100ms even with 10K total sessions (most marked dead). Single global scan; no per-project parallelization needed at v1 envelope.

**Risk surfaced + landed:** Sessions table growth from short-lived ephemeral sessions. Resolved 2026-04-28 as ARCH §6.1.2 (24-hour retention for `status=dead` rows; configurable via `policy.session_dead_retention_seconds`).

### 2.2 Endpoint p95 latency under concurrent load (Scenario A)

Per ARCH §9.3: serverless deployment. Cold-start dominates first-request latency; warm latency is mostly DB query time + auth validation.

**Hypothesis:** p95 under 500ms at v1 envelope (100 concurrent sessions per guild making typical tool calls). Cold-start adds 1-3 seconds for the first request after idle.

**Risk:** Vercel's serverless cold-start is real. At v1 envelope (100 concurrent sessions × heartbeat-every-30s ≈ 3.3 calls/second sustained), the function is rarely fully cold. Below ~5 sessions/project, cold-start may be visible.

### 2.3 Pub/sub topology (Scenario C)

**Hypothesis:** Per-project channel is the right default. Cleaner subscriber model (no client-side filtering); Supabase Realtime handles channel count comfortably (documented limits in the thousands per cluster); per-project-channel limits subscriber fanout to `composers_in_project` (max 20 at envelope) — well within typical channel-subscriber limits.

**Resolved 2026-04-28 as ARCH §6.8** — broadcast topology with per-project channels, naming convention, event categories, subscriber lifecycle, BroadcastService interface contract, degraded-broadcast failure mode.

### 2.4 Vector index ceiling (Scenario D)

**Hypothesis:** At v1 envelope (~100K vector rows per guild), p95 kNN query under 50ms with HNSW. At 1M (10x envelope), under 200ms with appropriate `m` and `ef` parameters. Embedding dimension matters: at the v1 default of 1536-dim per ADR-041, storage is ~6KB per row × 100K = ~600MB index size before compression.

**Risk:** Higher embedding dim = more storage + slightly slower kNN. Confirm at benchmark time with the v1 model (text-embedding-3-small, 1536-dim per ADR-041).

### 2.5 Connection pooling

**Hypothesis:** At v1 envelope (100 concurrent sessions × 1 connection/session via the endpoint serverless function with PgBouncer connection reuse), well within the Pro tier ~60 transaction-mode connection limit.

**Risk:** Long-running queries (slow find_similar over a large index) hold connections longer. Worth measuring at benchmark time.

### 2.6 RLS query efficacy

**Hypothesis:** RLS adds <1ms overhead per query at v1 envelope. No degradation at scale because the RLS predicate (`WHERE project_id = ...`) matches the natural query predicate already covered by indexes per ARCH §5.2.

---

## 3. Scenarios shipped in the harness

Per `scripts/test/scale/load-runner.ts`. The bounded M7 scope ships A + B end-to-end and stubs for C/D/E (each documented in §4 below).

### 3.1 Scenario A: Endpoint sustained load — implemented

- Setup: N concurrent synthetic composers (per `--concurrent-sessions` flag), each holding an active session via `register`
- Workload: per-loop heartbeat + every 3rd loop `get_context(scope_files=...)` + every 6th loop `find_similar` + jittered 800-1200ms delay
- Deregisters cleanly at the end
- Pass criterion: p95 <500ms across all tools (per benchmark plan §6 Scenario A)
- Records to telemetry: `action='scale_test.A.<op>'` with `duration_ms` populated

### 3.2 Scenario B: Reaper cycle time — implemented

- Setup: uses whatever sessions table state exists (no pre-population at v1 — harness measures the read-cost of the reaper's WHERE clause directly)
- Workload: 100 SELECT runs back-to-back against the reaper's stale-session predicate
- Pass criterion: p95 <100ms (per plan §6 Scenario B)
- Records to telemetry: `action='scale_test.B.reaper_scan'`

### 3.3 Scenario C: Broadcast fanout — stub

- Setup needed: 10 projects, 200 total subscribers across all projects (20 per project), each subscribed via the BroadcastService client
- Workload: each project emits 1 broadcast/second for 5 minutes
- Measure: per-subscriber receive latency p50/p95/p99; subscriber message-loss rate
- Pass criterion: p95 receive latency <2s; zero loss
- Why stubbed at M7: requires multi-subscriber setup that the harness skeleton doesn't yet wire (each subscriber = one Realtime client with project_id-bound channel subscription). Pattern: extend `runScenarioA`'s worker-pool shape with a Supabase Realtime client per worker.

### 3.4 Scenario D: Vector kNN at scale — stub

- Setup needed: pre-populate vector index with 100K embeddings (envelope) + separately 1M (10x scale) using the v1 model dimensionality
- Workload: random 1000 queries (drawn from the seed eval set per ADR-041 + ADR-042)
- Measure: kNN p50/p95/p99 latency; index storage size; index rebuild time
- Pass criterion: at envelope, p95 <50ms; at 10x, p95 <200ms
- Why stubbed at M7: requires a multi-day OpenAI embedding pre-population run (~$5-15 in API charges depending on chunk size + corpus selection). Pattern: extend `embed-runner.ts` to seed a synthetic corpus at the target scale; harness then issues random queries against pgvector directly.

### 3.5 Scenario E: Cross-dimension stress — stub

- Setup needed: full v1 envelope state (10 projects, 100 composers, 50K contributions, broadcast active, find_similar live, all populated)
- Workload: realistic mixed traffic over 1+ hour
- Measure: every NFR continues to hold
- Why stubbed at M7: requires the C+D pre-population work plus a synthetic-composer simulator that exercises full workflows. Pattern: combine the worker-pool from A with subscribers from C and queries against the populated index from D.

---

## 4. Measured envelope (operator-populated)

This section is **populated by operators running the harness against their deployed substrate**. The harness writes per-run timings to the telemetry table; the SQL query in `scripts/test/scale/README.md` extracts the numbers below.

### 4.1 Latest run

- Run timestamp: _not yet run_
- Substrate: _not yet run_ (e.g., "Vercel + Supabase Cloud Pro per ADR-046; us-west-1; deployed 2026-05-XX")
- Harness version: `scripts/test/scale/load-runner.ts` (as of M7 entry)
- Configuration: _not yet run_

### 4.2 Per-operation measurements

| Operation | Hypothesis | Measured p50 | Measured p95 | Measured p99 | NFR target | Pass? |
|---|---|---|---|---|---|---|
| `register` | <500ms p95 (warm) | _pending_ | _pending_ | _pending_ | 500ms | _pending_ |
| `heartbeat` | <100ms p95 (warm) | _pending_ | _pending_ | _pending_ | 500ms | _pending_ |
| `get_context` | <300ms p95 (warm) | _pending_ | _pending_ | _pending_ | 500ms | _pending_ |
| `find_similar` | <500ms p95 (warm) | _pending_ | _pending_ | _pending_ | 500ms | _pending_ |
| `deregister` | <100ms p95 (warm) | _pending_ | _pending_ | _pending_ | 500ms | _pending_ |
| `reaper_scan` | <100ms p95 | _pending_ | _pending_ | _pending_ | 100ms | _pending_ |

### 4.3 Hypothesis vs measured assessment

- **If results match hypotheses:** the v1 envelope holds; commit observability alerts at 80% per dimension; no ADR needed.
- **If results diverge by <2x:** revise the envelope numbers in §1; cite the harness run; still no ADR.
- **If results diverge by >2x in either direction:** material gap between architecture and reality. File an ADR documenting the surprise + the architectural change required.
- **If a hypothesis is contradicted in a way that breaks a v1 NFR:** the NFR moves to an open question for revision OR the architecture changes to preserve the NFR. Either is a real ADR event.

(Per benchmark plan §7 decision criteria.)

---

## 5. Observability hooks

The harness uses the existing `telemetry` table per ARCH §8.1 — no new infrastructure. Each scenario writes per-operation rows tagged `action='scale_test.<scenario>.<op>'` with `duration_ms` populated.

When `/atelier/observability` lights up (M7 Track 1), the scale-test rows appear automatically — operators don't need a separate dashboard to view harness output. Filter on `action LIKE 'scale_test.%'` for harness-only views.

The `recordTelemetry` helper in `scripts/sync/lib/write.ts` is the existing path for substrate-emitted telemetry (session lifecycle, claims, locks, decisions). The `duration_ms` column is OPTIONAL and currently NULL for substrate-emitted rows — adding measurement at those call sites is a separate concern (filed as Track 3 polish; not bundled here to avoid conflict with the parallel `write.ts` split work).

---

## 6. Cross-references

- BRD-OPEN-QUESTIONS §7 — the open question this audit addresses
- `docs/testing/scale-ceiling-benchmark-plan.md` — the design plan this audit operationalizes
- ARCH §5 — entities + indexes the harness exercises
- ARCH §6.1 — session lifecycle + reaper (Scenario B target)
- ARCH §6.1.2 — session row cleanup (resolved side-deliverable from the plan analysis)
- ARCH §6.8 — broadcast topology (resolved side-deliverable from the plan analysis)
- ARCH §8.1 — telemetry schema the harness writes to
- ARCH §9 — deployment model + scale envelope (this audit's §1 numbers commit there)
- ADR-027 — reference implementation stack (Supabase Pro + Vercel Pro target tier)
- ADR-029 — GCP-portability constraint (the harness runs against any deployment honoring the constraint; Cloud Run + Cloud SQL is documented migration path)
- ADR-041 — embedding model default (drives Scenario D dimensionality)
- ADR-042 — find_similar hybrid retrieval (drives find_similar latency expectations in Scenario A)
- ADR-046 — deploy strategy (the substrate this harness measures)
- `scripts/test/scale/README.md` — operator runbook for the harness
- `scripts/test/scale/load-runner.ts` — the implementation
