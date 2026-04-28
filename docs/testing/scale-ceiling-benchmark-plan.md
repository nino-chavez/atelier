# Scale ceiling benchmark plan (BRD-OPEN-QUESTIONS section 7)

**Status:** Design draft 2026-04-28. The plan can land now; benchmark execution requires a deployed Atelier (M2+ for endpoint scale tests; M4+ for broadcast scale tests; M5+ for vector index scale tests). Resolves `BRD-OPEN-QUESTIONS.md` section 7; lands as updates to ARCH section 9 plus possibly a new ADR if measured limits diverge materially from the documented envelope.

**Audience:** whoever runs the load tests (ops engineer or contractor). Plan is detailed enough to brief without further design.

---

## 1. Purpose and gating

The architectural model (per ADR-015 "one guild, many projects") supports plural projects per guild from v1. ARCH section 9.3 lists the per-guild infrastructure (1 datastore, 1 endpoint, 1 hosting deployment per project, 1 scheduler). Open question: at what dimensions does the architecture stop being adequate?

Different scale dimensions matter at different milestones:
- **Reaper cron parallelism** matters from M2 (sessions table + reaper)
- **Endpoint p95 under load** matters from M2 (12-tool endpoint live)
- **Pub/sub topology** matters from M4 (broadcast substrate live)
- **Vector index ceiling** matters from M5 (find_similar live)
- **Cross-dimension interaction** matters from M6+ (real teams using everything together)

This plan exists so the team commits to a defensible v1 scale envelope rather than over-promising or being silent. The existing recommendation in BRD-OPEN-QUESTIONS section 7 was "10 projects x 20 composers x 10K contributions per project = 2M rows." This plan validates that envelope or revises it with data.

---

## 2. Scope

**In scope:**
- Synthetic load tests against a deployed staging Atelier across the four scale dimensions
- Architectural sizing predictions before the benchmark runs (so the benchmark confirms or contradicts hypotheses, not "discovers" baseline)
- Documented v1 scale envelope committed in ARCH section 9
- Documented escape hatches when the envelope is exceeded (tier upgrade; multiple guilds per team)
- Triggers in observability that warn before envelope is reached

**Out of scope:**
- Optimizing past the v1 envelope (sharding, external vector index, multi-datastore guilds) -- that's v1.x or v2 work
- SaaS scale (per ADR-007 Atelier is self-hosted only; "what if 10000 teams" is not a v1 question)
- Production tuning per-deployment (the envelope is a portable default; teams with bigger hardware will exceed it naturally)
- Cost optimization (cost-per-row at scale is a teams-deploy-this concern, not a spec concern)

---

## 3. What can be done now (no implementation dependency)

Three pieces are desk work and can land before M2:

1. **Architectural sizing predictions** -- analyze ARCH section 5 indexes, RLS policies, pub/sub topology to predict where bottlenecks live. The benchmark then confirms or contradicts. See section 5.
2. **Scale dimension list with target envelope** -- commit to numbers in ARCH section 9 ahead of the benchmark; revise post-benchmark if measurements diverge. See section 4.
3. **Load-test methodology** -- which scenarios to run, what tools, what metrics. See section 6.

The benchmark itself requires a deployed Atelier. Earliest meaningful run: M2 exit (endpoint + reaper scale tests). Vector index tests need M5. Cross-dimension tests need M6+.

---

## 4. Scale dimensions and target v1 envelope

| Dimension | v1 envelope | Beyond envelope |
|---|---|---|
| Projects per guild | 10 | Tier upgrade or split into multiple guilds |
| Composers per project | 20 | Same |
| Composers per guild (sum across projects) | 100 (assumes overlap) | Same |
| Contributions per project (lifetime) | 10,000 | Archive policy + tier upgrade |
| Contributions per guild (sum) | 50,000 | Same |
| Concurrent active sessions per project | 20 | Same |
| Concurrent active sessions per guild | 100 | Same |
| Decisions (ADRs) per project (lifetime) | 500 | Per-ADR file split per ADR-030 means no single-file growth issue; vector index handles this comfortably |
| BRD stories per project | 200 | Same |
| Research artifacts per project | 1,000 | Same |
| Vector index rows per guild | 100,000 | 1M with tier upgrade; 10M+ needs sharding (v1.x) |
| Pub/sub messages per minute per project (peak) | 60 | Same |
| Pub/sub subscribers per project | 20 (= concurrent sessions) | Same |
| Find_similar QPS per project (peak) | 10 | Same |

**Total guild-level row count target: ~2M.** Matches the existing recommendation.

These are the v1 commitment. Any team running below these limits should expect the documented NFRs (endpoint p95 under 500ms, broadcast latency under 2 seconds, etc.) to hold. Beyond, behavior is undefined-but-not-broken: things will work but may degrade past NFRs.

---

## 5. Architectural sizing predictions

Pre-benchmark hypotheses about where bottlenecks live, derived from analyzing ARCH section 5. Benchmark confirms or contradicts.

### 5.1 Reaper cron

Per ARCH section 6.1 the reaper scans `sessions` for `heartbeat_at < now() - session_ttl_seconds` (default 90s). Per ARCH section 5.2 there's an index on `(heartbeat_at) WHERE status='active'` for stale-session detection.

**Hypothesis:** Reaper completes in <100ms even with 10K total sessions in the table (most marked dead/cleaned). Single global scan; no per-project parallelization needed at v1 envelope.

**Risk:** If a project has many short-lived ephemeral sessions (e.g., agents that register/deregister per task), the table grows fast. ~~ARCH does not currently specify a `sessions` cleanup policy beyond the reaper marking dead.~~ **Gap surfaced by this analysis: need cleanup policy for `status=dead` sessions older than X.** **RESOLVED 2026-04-28** -- see ARCH section 6.1.2 (session row cleanup policy; default 24-hour retention, configurable via `policy.session_dead_retention_seconds`).

### 5.2 Endpoint p95 latency under concurrent load

Per ARCH section 9.3 the endpoint is a serverless deployment. Cold-start dominates first-request latency; warm latency is mostly DB query time + auth validation.

**Hypothesis:** p95 under 500ms at v1 envelope (100 concurrent sessions per guild making typical tool calls). Cold-start adds 1-3 seconds for the first request after idle; tool-call rate keeps the endpoint warm at typical use.

**Risk:** Vercel's serverless cold-start is real. Functions that haven't run in ~5 minutes typically pay 1-3s cold-start cost. At v1 envelope, the function is rarely fully cold (100 concurrent sessions x heartbeat-every-30s = 3.3 calls/second sustained). Below ~5 sessions/project, cold-start may be visible.

### 5.3 Pub/sub topology (post-M4)

ARCH section 6 doesn't specify channel topology explicitly. Two models possible:
- **Per-project channel:** each project gets its own broadcast channel; subscribers join only their project's channels
- **Per-guild channel with payload filtering:** one channel; clients filter by `project_id` in the payload

**Hypothesis:** Per-project channel is the right default. Cleaner subscriber model (no client-side filtering); Supabase Realtime handles channel count comfortably (documented limits in the thousands per cluster); per-project-channel limits subscriber fanout to `composers_in_project` (max 20 at envelope) which is well within typical channel-subscriber limits.

~~**Decision needed pre-M4:** Add an ARCH subsection explicitly specifying per-project channel topology before M4 lands. Currently a gap.~~ **RESOLVED 2026-04-28** -- see ARCH section 6.8 (broadcast topology; per-project channels with naming convention, event categories, subscriber lifecycle, BroadcastService interface contract, degraded-broadcast failure mode).

### 5.4 Vector index ceiling (post-M5)

pgvector with HNSW index is the default per ADR-027 (Supabase). Public benchmarks place HNSW competitive with external services up to ~1M rows on typical hardware, with degradation appearing past 10M depending on configuration.

**Hypothesis:** At v1 envelope (~100K vector rows per guild), p95 kNN query under 50ms with HNSW. At 1M (10x envelope), under 200ms with appropriate `m` and `ef` parameters.

**Risk:** Embedding model dimension matters. The D24 candidates range from 768 to 3072 dimensions. Higher dim = more storage and slightly slower kNN. Confirm at benchmark time with the chosen model.

### 5.5 Connection pooling

Supabase ships PgBouncer with the database; default Pro tier supports ~60 transaction-mode connections.

**Hypothesis:** At v1 envelope (100 concurrent sessions x 1 connection/session via the endpoint serverless function, with connection reuse via PgBouncer), well within limit. Each Vercel function invocation acquires a transient connection.

**Risk:** Long-running queries (e.g., a slow find_similar over a large index) hold connections longer. Worth measuring at benchmark time.

### 5.6 RLS query efficacy

Every project-scoped query carries an RLS predicate `WHERE project_id = current_composer_project_id()`. Per ARCH section 5.2 the relevant indexes are on `(project_id, state)` etc. so the predicate uses an index seek not a table scan.

**Hypothesis:** RLS adds <1ms overhead per query at v1 envelope. No degradation at scale because the RLS predicate matches the natural query predicate.

**Risk:** None apparent from analysis; benchmark to confirm.

---

## 6. Benchmark plan (load tests)

Five scenarios, each measuring a specific dimension. Run against a staging deployment with the same Supabase + Vercel tier as production-target.

### Scenario A: Endpoint sustained load (M2+)

- Setup: 1 project, 100 synthetic composers, each holding an active session with heartbeat-every-30s
- Workload: each composer does a random tool call (claim, get_context, find_similar where available, log_decision) at Poisson-distributed intervals averaging 1 call/minute per composer
- Duration: 30 minutes after warmup
- Measure: endpoint p50/p95/p99 latency per tool; CPU utilization on the serverless platform; DB connection pool utilization
- Pass: p95 < 500ms across all tools (NFR target)

### Scenario B: Reaper cycle time (M2+)

- Setup: pre-populate sessions table with 10,000 rows distributed across 10 projects, varying ages (some active, some about-to-expire, some dead)
- Workload: trigger reaper cron 100 times back-to-back
- Measure: cycle time per run (median, p95)
- Pass: each cycle <100ms; no observable interference with concurrent endpoint requests

### Scenario C: Broadcast fanout (M4+)

- Setup: 10 projects, 200 total subscribers across all projects (20 per project on average)
- Workload: each project emits 1 broadcast per second for 5 minutes
- Measure: per-subscriber receive latency p50/p95/p99; subscriber message-loss rate; channel reconnect rate
- Pass: p95 receive latency <2s (NFR target); zero loss; minimal reconnects

### Scenario D: Vector index kNN at scale (M5+)

- Setup: index pre-populated with 100K embeddings (envelope) and separately 1M embeddings (10x), using the D24-chosen model's dimensionality
- Workload: random 1000 queries (drawn from the seed eval set per the D24 plan)
- Measure: kNN p50/p95/p99 latency per query; index storage size; index rebuild time
- Pass: at envelope, p95 <50ms; at 10x, p95 <200ms

### Scenario E: Cross-dimension stress (M6+)

- Setup: full v1 envelope (10 projects, 100 composers, 50K contributions, broadcast active, find_similar live)
- Workload: realistic mixed traffic over 1 hour
- Measure: all of the above in a single run; cross-interference effects
- Pass: every individual NFR continues to hold

### Tooling

For scenarios A-D: a load-generation script (k6, Artillery, or a custom Node.js harness) running from a deployment region near the Atelier endpoint to minimize network noise. For scenario E: same plus a synthetic-composer simulator that exercises full workflows.

For all: Supabase observability dashboards + the Atelier `/atelier/observability` route (per ARCH section 8.2, lands at M2+).

---

## 7. Triggers and decision criteria

When benchmark results are in:

**If results match hypotheses:** commit the v1 envelope to ARCH section 9 with the benchmark report cited. Add observability alerts at 80% of envelope per dimension so teams get warning before exceeding. No ADR needed (benchmark confirms hypothesis).

**If results diverge by <2x:** revise the envelope with the measured numbers (less optimistic = OK; more optimistic also OK). Cite benchmark in ARCH. Still no ADR.

**If results diverge by >2x in either direction:** material gap between architecture and reality. File an ADR documenting the surprise + the architectural change required (e.g., "vector index degrades sharply past 50K rows; v1 envelope reduced to 50K and observability alerts shifted accordingly"). This is a real architectural decision.

**If a hypothesis is contradicted in a way that breaks a v1 NFR:** the NFR moves to an open question for revision, OR the architecture changes to preserve the NFR. Either is a real ADR event.

---

## 8. Deliverables

1. **Numbers report** -- `prototype/eval/scale/benchmark-<date>.md` with per-scenario per-dimension metrics, hypothesis confirmation/contradiction, recommended envelope adjustments
2. **ARCH section 9 update** -- envelope numbers committed; per-dimension thresholds documented
3. **Observability alert specs** -- per-dimension alerts at 80% of envelope, defined as configuration in `.atelier/config.yaml: observability.alerts`
4. **ADR(s) only if results force architectural change** -- per section 7 decision criteria
5. **Plus side-deliverables surfaced by analysis (section 5):**
   - ~~ARCH addition: `sessions` cleanup policy for `status=dead` rows older than X (per section 5.1 risk)~~ **LANDED 2026-04-28** as ARCH section 6.1.2
   - ~~ARCH addition: explicit pub/sub channel topology spec (per section 5.3 decision needed)~~ **LANDED 2026-04-28** as ARCH section 6.8

---

## 9. Effort estimate

| Task | Effort | Dependency |
|---|---|---|
| Architectural sizing analysis (already in section 5) | done in this plan | none |
| Load-generation harness (k6 scripts or custom) | ~3 person-days | Atelier deployed |
| Scenario A run (endpoint load) | ~1 person-day | M2 |
| Scenario B run (reaper) | ~0.5 person-days | M2 |
| Scenario C run (broadcast) | ~1 person-day | M4 |
| Scenario D run (vector kNN) | ~1 person-day | M5 + D24 resolved |
| Scenario E run (cross-dimension) | ~2 person-days | M6 |
| Analysis + ARCH update + alert specs | ~2 person-days | All scenarios |

**Total: ~10 person-days spread across M2 through M6.** Not a single concentrated work block; runs incrementally as each scale dimension goes live.

**Cost: ~$200-500 in cloud bills for the benchmark deployments + load-test runs.**

---

## 10. Pre-conditions to start

For the desk-work portion (sections 4 and 5): nothing; can land in ARCH now.

For Scenario A: M2 exit (endpoint + reaper live).
For Scenario B: M2 exit.
For Scenario C: M4 exit.
For Scenario D: M5 entry, plus D24 resolution (chosen embedding model determines dimensionality).
For Scenario E: M6 exit.

---

## 11. Open questions about the plan itself

- **Should the envelope be tier-aware?** The numbers above assume Supabase Pro tier + Vercel Pro. A team on Free tier has tighter limits; a team on Enterprise has looser. Recommend: document the envelope as "Supabase Pro + Vercel Pro target" and add a sub-table for Free tier (much lower) and Enterprise (~10x).
- **Should benchmarks re-run periodically?** Atelier's own scale will grow; Supabase/Vercel's tier limits change. Recommend: re-run on every major Atelier release + when a tier provider changes pricing/limits.
- **Should multi-region deployments be in scope?** Currently single-region assumed. Multi-region adds latency between endpoint and DB. Document as v1.x scope; not benchmarked at v1.
- **Should cost-per-dimension be a deliverable?** Teams deploying Atelier care about cost-at-scale. Currently only as a "side note" in benchmark output. Recommend: yes, include cost estimates per dimension in the report so adopting teams can budget.

---

## 12. Cross-references

- BRD-OPEN-QUESTIONS section 7 -- the open question this plan addresses
- ADR-007 -- no SaaS; self-hosted means each team's deployment is theirs to size
- ADR-015 -- one guild, many projects (architectural assumption that generates the scale dimensions)
- ADR-027 -- reference implementation stack including Supabase + Vercel (the platforms benchmarked against)
- ARCH section 5.x -- entities, indexes, RLS (the schema this plan stress-tests)
- ARCH section 6.1 -- session lifecycle + reaper (Scenario B target)
- ARCH section 8.x -- observability (where alerts land)
- ARCH section 9.x -- deployment model (where the envelope commits)
- `embedding-model-benchmark-plan.md` -- the D24 plan; D24 must resolve before Scenario D runs
