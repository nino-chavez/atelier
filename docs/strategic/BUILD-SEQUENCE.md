# Build Sequence: Atelier reference implementation

**Companion to:** `NORTH-STAR.md`, `../functional/PRD.md`, `../functional/BRD.md`
**Status:** Draft v1.0
**Owner:** Nino Chavez
**Last updated:** 2026-05-03
**Related:** `../architecture/decisions`, `../functional/PRD-COMPANION.md`, `../functional/BRD-OPEN-QUESTIONS.md`

---

## 1. Purpose

This document specifies the **order** in which the v1 destination defined in `NORTH-STAR.md` is built. It is the answer to "we cannot phase the design; how do we sequence the implementation?"

It is explicitly **not** a roadmap, a phased rollout, or a feature-deferral plan. The v1 scope is locked (per ADR-011). Every capability in `NORTH-STAR.md` is in v1. This document only governs the order of construction.

---

## 2. Relationship to other docs

| Doc | Concern | Mutability |
|---|---|---|
| `NORTH-STAR.md`, `../functional/PRD.md`, `../functional/BRD.md`, `../architecture/ARCHITECTURE.md` | What is built (destination scope) | Append/edit; locked v1 scope |
| `../functional/PRD-COMPANION.md` | Why design decisions were made | Editable; rationale record |
| `../architecture/decisions` | Append-only canonical decision log | Append-only |
| **`BUILD-SEQUENCE.md` (this doc)** | **Order of construction** | **Editable; major reorders log an ADR** |

This doc is **not** in the canonical-state precedence list in `CLAUDE.md`. If it conflicts with any design doc, the design doc wins.

---

## 2.5. Reference implementation stack (ADR-027, ADR-028, ADR-029)

The reference impl runs on **GitHub + Supabase (Postgres + Realtime + Auth + pgvector) + Vercel (Functions + Hosting + Cron) + MCP**. This is one valid implementation, not the architecture (per ADR-012). Each capability in `NORTH-STAR.md` §13 stays vendor-neutral; M2 onward simply targets these defaults. Identity default is Supabase Auth per ADR-028; BYO via `.atelier/config.yaml: identity.provider`.

**Portability constraint (ADR-029):** the reference impl is constrained to features with documented GCP equivalents. M2 introduces a `BroadcastService` interface (default impl: Supabase Realtime; documented migration impl: Postgres NOTIFY/LISTEN). No `@vercel/edge`, `@vercel/kv`, Edge Config, or Supabase RPC helpers outside named adapters. Auth verification is OIDC-standard, not Supabase claim helpers. A `docs/migration-to-gcp.md` runbook ships when M2 lands.

---

## 3. The recursion check

Atelier dogfoods itself. The bootstrap inflection point is **M5-exit / M6 onward** per ADR-044: build sessions become MCP clients of the substrate, contributions write through the endpoint, find_similar advisory checks fire against the corpus on PRs. Before that point, the substrate was being *built* — not used to coordinate its own build — through markdown + git + per-session human/agent review.

**Honest read on M0-M5:** the four-table schema landed at M1 and the endpoint at M2, but build-session attribution into `contributions` rows did not begin until M6 (per ADR-044). The original "from M1 onward" / "from M2 onward" framing in earlier drafts of this section overstated the dogfood timeline; ADR-044 codified the actual inflection point and this section now reflects it. By **M6**, the analyst case from `BRD-OPEN-QUESTIONS §1` is not a hypothetical — it is the artifact that produces M7.

**At each milestone from M6 forward, ask:** "Did we use the previous milestone to coordinate building this one?" If the answer is no, dogfooding has drifted and the milestone is suspect. M0-M5 are exempt from this check by ADR-044's design (the substrate was not yet adopter-ready for self-coordination).

This is also the strongest disconfirming test available before public release. A reference implementation that cannot run its own development is unlikely to run anyone else's.

---

## 4. Milestone summary

| ID | Title | Bootstrap function | Status |
|---|---|---|---|
| **M0** | Methodology | Repo + git + markdown is the starting substrate | **Done** (2026-04-24; see `../architecture/audits/milestone-M0-exit.md`) |
| **M1** | SDLC sync substrate (5 scripts) + thin schema (4 tables) + adapter interface + GitHub adapter | Sync scripts run against real persistence | **Done** (2026-04-29; see `../architecture/audits/milestone-M1-exit.md`) |
| **M1.5** | Remaining external adapters (Jira, Linear, Confluence, Notion, Figma) | Full v1 adapter coverage | **Deferred to v1.x** (adopter-signal trigger; see §M1.5 below) |
| **M2** | 12-tool endpoint + fenced locks + remaining schema (5 tables) | Coordination substrate goes live; agents coordinate through the endpoint | **Done** (~2026-04-30; no per-milestone exit audit; backfilled by M7-exit sweep covering the full M2-M7 substrate) |
| **M3** | Prototype shell + `/atelier` + 5 lenses | The dashboard you build is the dashboard you use | **Done** (~2026-04-30; no per-milestone exit audit; backfilled by M7-exit sweep) |
| **M4** | Multi-composer concurrency (real broadcast) | Concurrent authoring is observable and conflict-safe | **Done** (~2026-05-01; no per-milestone exit audit; backfilled by M7-exit sweep) |
| **M5** | find_similar + eval harness + CI gate | Disconfirming test on the commercial wedge fires | **Done** (2026-05-01; no per-milestone exit audit; calibration captured in ADR-042/043; reframed by ADR-047) |
| **M6** | Remote-principal composers + triage | Analyst case executes through Atelier itself; bootstrap inflection point per ADR-044 | **Done** (2026-05-02; see `../architecture/audits/milestone-M6-exit.md`) |
| **M7** | Hardening + open-ADR resolution | Reference implementation is publication-ready | **Done** (2026-05-03; audit at `../architecture/audits/milestone-M7-exit.md`; Playwright IA/UX suite landed via PR #43 (static layer) + PR #44 (DOM layer); v1 substrate complete) |

---

## 5. Milestone details

---

### M0 — Methodology

**Status:** Done (2026-04-24)

**Produces.** Repo conventions, 32 ADRs, `traceability.json` registry, `.atelier/territories.yaml`, `.atelier/config.yaml`, `CLAUDE.md` + `AGENTS.md` agent charter, complete v1 design corpus organized into seven-layer doc tree (per ADR-032), hand-bootstrapped reference repo (Epic 1 CLI surface intentionally deferred to M7 — see §9).

**Operationalizes.** ADR-005, ADR-011, ADR-012, ADR-014, ADR-015, ADR-020 (naming), ADR-030 (per-ADR split), ADR-031 (three-tier consumer model), ADR-032 (extended doc structure).

**Advances.** Pre-BRD; this is methodology setup, not a BRD epic.

**Bootstrap function.** Establishes the substrate every later milestone runs on: markdown is canonical, decisions are append-only, scope is destination-first, architecture is capability-level. Without M0 the rest is unprincipled.

**Demoable.** This repo, https://github.com/Signal-x-Studio-LLC/atelier.

**Exit criteria.** Met: design scope locked, 32 ADRs landed (the doc-organization cleanup added ADR-030/031/032), scaffolding complete, session continuity served by the pre-M2 `.atelier/checkpoints/SESSION.md` stand-in (retired at M2-mid follow-up #1 once `get_context` was first consumed by a real MCP client per the methodology §6.1 transition), docs structurally organized into the seven-layer tree (per ADR-032).

---

### M1 — SDLC sync substrate + thin schema

**Status:** Done (2026-04-29). Audit: `../architecture/audits/milestone-M1-exit.md`. M1 implementation completed across 8 commits 2026-04-28 to 2026-04-29 (`0a283b2..0f9b8c4`). 170 test assertions across 6 smoke suites + 43 canonical files round-trip clean. One HIGH M2-entry follow-up filed (build-registry script for traceability.json entries[]).

**Produces.** All five sync scripts per ADR-008: `publish-docs` (repo → published-doc system, full overwrite + banner), `publish-delivery` (contribution state → delivery tracker), `mirror-delivery` (delivery tracker → registry, nightly), `reconcile` (bidirectional drift detector, reports only), `triage` (external comments → contributions with `kind=<discipline>` + `requires_owner_approval=true` per ADR-033, never auto-merges).

Plus the four schema tables the sync scripts read or write — `projects`, `territories`, `contributions`, `decisions` — with their `ARCHITECTURE.md §5.2` indexes (`contributions(project_id, state)`, GIN on `contributions.trace_ids`, GIN on `decisions.trace_ids`, `decisions(project_id, created_at DESC)`). Row-level authorization scaffolding scoped to `project_id`; append-only enforcement on `decisions`. An internal library `scripts/sync/lib/datastore.ts` wraps writes; no public endpoint surface yet.

The traceability validator under `scripts/traceability/` (separate concern from the five sync scripts) lands here too, since CI gates depend on it.

**Why the four tables land here, not at M2.** Three of the five sync scripts (`publish-delivery`, `mirror-delivery`, `triage`) write to or read from `contributions`. Without the table, ADR-008's "all 5 ship together" cannot be honored against real persistence — only against stubs. Landing the four tables here is the smallest change that makes ADR-008 executable. The remaining five tables (`composers`, `sessions`, `locks`, `contracts`, `telemetry`) stay at M2 because the endpoint is what needs them.

**Operationalizes.** ADR-005, ADR-008, ADR-016, ADR-018 (triage never auto-merges), ADR-021 (multi-trace, GIN indexes).

**Advances.** BRD Epic 9 (sync substrate, all 5 scripts), Epic 4 (territory + contribution — schema portion), Epic 5 (decision durability — schema portion + mirror), Epic 10 (adapter interface + first concrete adapter — see §7 Q5).

**Bootstrap function.** **The dogfooding ignition point.** From M1 exit onward, every contribution toward Atelier is tracked in the four-table schema. Every doc edit propagates through the sync scripts without manual reconciliation. M2 coordinates against persistence that already exists rather than scaffolding it.

**Demoable.** Commit a BRD edit; `publish-docs` overwrites the published-doc page with a banner. Transition a contribution row to `claimed`; `publish-delivery` upserts the delivery-tracker issue. Run `reconcile`; report enumerates every divergence between repo and external. Post a comment on a published-doc page; `triage` classifies and drafts a contribution with the proposed change's discipline and `requires_owner_approval=true` (per ADR-033) that requires human merge.

**Exit criteria.** All 5 scripts green in CI on this repo's own corpus. Schema migration applied; the four indexes exist. Round-trip integrity test passes against the new tables (markdown to datastore to projector to markdown is byte-identical for the canonical doc classes per scripts/README.md round-trip integrity contract). The adapter interface (`scripts/sync/adapters/types.ts`) is defined; an in-memory mock implementation passes contract tests; the GitHub Issues + GitHub Discussions adapter ships and passes integration tests. Remaining adapters (Jira, Linear, Confluence, Notion, Figma) are deferred to M1.5 per the section 16 resolution. The extended traceability validator (`scripts/traceability/validate-refs.mjs`) ships with the per-PR check classes from scripts/README.md "Extended cross-doc consistency"; `.github/workflows/atelier-audit.yml` runs the validator on every PR; first milestone-exit drift sweep runs at M1 exit per METHODOLOGY section 11.3.

---

### M1.5 -- Remaining external adapters

**Status:** Deferred to v1.x (decision recorded 2026-05-03 by this drift sweep; no separate ADR — the deferral is sequence hygiene, not an architectural reversal of ADR-008/ADR-011, since the adapter *interface* + GitHub adapter shipped at M1 and the remaining providers are concrete implementations of an unchanged interface).

**What did NOT ship at v1.** Concrete adapters for Jira, Linear, Confluence, Notion, Figma; integration tests against live or recorded fixtures; per-provider runbooks under `docs/user/integrations/`. The directory `docs/user/integrations/` exists as an empty slot per the operational-completeness map; `scripts/sync/adapters/` was never authored as a separate directory (the GitHub adapter lives at `scripts/sync/lib/github.ts` against the interface in `scripts/sync/lib/adapters.ts`).

**Why deferred.** No adopter-signal materialized during M2-M7 indicating which non-GitHub providers were on the critical path. ADR-011 governs *feature scope*, not *which concrete vendor implementations of an unchanged capability ship at v1*; under ADR-012 the architecture is capability-level and the GitHub adapter satisfies the adapter-interface contract. Shipping five additional adapters with credentials, recorded fixtures, and per-provider runbooks ahead of any adopter request would have been speculative implementation work — exactly the discipline-tax pattern the methodology warns against.

**v1.x activation trigger.** First adopter request for a specific non-GitHub provider with named integration. Each adapter ships independently against the existing interface; no batched M1.5 milestone. The M7-exit operational-completeness check (`integrations: docs/user/integrations/`) will populate as adopters drive provider selection.

**Operationalizes (now).** Nothing additional at v1. The capability is unchanged; only the concrete implementations are deferred.

**Original spec (preserved for provenance).** The intent at sequencing time was that all five non-GitHub adapters land before the endpoint (M2) so any interface drift surfaced before endpoint coordination went live. M2 shipped without driving such drift, so the rationale for batching them ahead of M2 collapsed; the rationale for shipping all five at v1 (in any order) collapsed when no adopter signaled a need for any specific provider during M2-M7.

**Produces.** Concrete adapter implementations for the four remaining external systems against the adapter interface that landed at M1: Jira and Linear (delivery trackers, US-10.3), Confluence and Notion (published-doc systems, US-10.4), Figma (design tool, US-10.5). Each ships with integration tests against a live or recorded fixture for the external service.

**Operationalizes.** ADR-008 in full (the five sync scripts now have full provider coverage, not just GitHub).

**Advances.** BRD Epic 10 (US-10.3, US-10.4, US-10.5).

**Bootstrap function.** Dogfooding remains on GitHub since this repo lives there; the additional adapters become testable for downstream Atelier adopters who use other providers. M1.5 is sequenced before M2 so any adapter surface changes that would affect the endpoint surface are caught before the endpoint lands.

**Demoable.** Configure `.atelier/config.yaml: integrations.delivery_tracker.kind: jira` (or linear); publish-delivery upserts a real Jira issue. Configure `published_docs.kind: confluence`; publish-docs writes a Confluence page with the canonical banner. Configure `design_tool.kind: figma`; triage picks up Figma comments and routes them to proposal contributions.

**Exit criteria.** All five non-GitHub adapters pass their integration tests in CI against either live test instances or recorded HTTP fixtures. Each adapter's setup runbook lands in `docs/user/integrations/<provider>.md` (the user-docs layer fills in here for the first time).

**Why this is M1.5 not M2.** Per the section 16 resolution: shipping all five non-GitHub adapters at M1 would significantly expand M1 scope and require procuring credentials for five external services before M1 could exit. The interface plus the GitHub adapter is sufficient to validate the substrate and unblock M2 dogfooding (which lives on GitHub). The M1.5 epic is real v1 scope per ADR-011 -- all adapters ship before public release -- but its order of construction is decoupled from M2's endpoint work.

---

### M2 -- 12-tool endpoint + fenced locks + remaining schema

**Status:** Done (~2026-04-30). No per-milestone exit audit; backfilled by `../architecture/audits/milestone-M7-exit.md` which sweeps the M2-M7 substrate as one. Recommendation for v1.x: when the methodology mandates per-milestone exit drift sweeps (METHODOLOGY 11.3), honor that even when milestones close fast — the wide retroactive sweep loses per-milestone evidence even when the substrate is correct.

**Produces.** The five remaining tables on top of M1's four — `composers`, `sessions`, `locks`, `contracts`, `telemetry` (per ARCHITECTURE §5.1). The 12-tool agent endpoint per ADR-013, with find_similar returning `unknown` (real find_similar arrives in M5). Locks with fencing tokens from day one. The `BroadcastService` interface (per ADR-029) lands here — default impl Supabase Realtime, documented migration impl Postgres NOTIFY/LISTEN — though the broadcast substrate goes live at M4. `atelier datastore init` ships in raw form here (Epic 1 partial; polished at M7).

Per-composer attribution kicks in: M1's service-role internal writes are joined by per-session attributed writes through the endpoint.

**Operationalizes.** ADR-002, ADR-003, ADR-004, ADR-013 (12 tools, MCP reference), ADR-014, ADR-015, ADR-022 (claim atomic-create), ADR-023 (remote-surface committer), ADR-024 (transcript schema field), ADR-026 (own-impl lock+fencing), ADR-027 (Supabase + Vercel reference stack), ADR-028 (Supabase Auth default), ADR-029 (GCP-portability constraint; `BroadcastService` interface lands here).

**Advances.** BRD Epic 2 (endpoint), Epic 4 (territory + contribution — endpoint surface), Epic 5 (decision durability — endpoint write path), Epic 7 (locks + fencing), Epic 8 (territory contracts).

**Bootstrap function.** Coordination substrate goes live. Agents register sessions, claim contributions through the endpoint, acquire fenced locks. The contributions table (already populated by M1's sync scripts) gains its endpoint write path so M3 onward composes through the protocol rather than direct DB writes.

**Demoable.** Two `claim_scope` calls on the same scope; second rejected with stale-fencing-token error. `log_decision` appends to `../architecture/decisions` and the datastore mirror reflects within one sync cycle.

**Exit criteria.** All 12 tools respond with real (non-stub) values except `find_similar`. Fencing tokens enforced in CI integration tests. The build of M3 onward registers contributions through the endpoint, not direct DB writes.

---

### M3 — Prototype shell + `/atelier` route + 5 lenses

**Status:** Done (~2026-04-30). No per-milestone exit audit; backfilled by `../architecture/audits/milestone-M7-exit.md`.

**Produces.** Prototype web app with six routes (`/`, `/strategy`, `/design`, `/slices/[id]`, `/atelier`, `/traceability`). The `/atelier` route renders the five role-aware lenses (analyst, dev, PM, designer, stakeholder) per ADR-017, backed by M2's endpoint. `atelier deploy` ships in raw form here (Epic 1 partial; polished at M7).

**Operationalizes.** ADR-001 (prototype is canonical artifact + dashboard), ADR-017 (5 lenses), ADR-019 (Figma is feedback only), ADR-025 (review routing via territory.review_role).

**Advances.** BRD Epic 3 (canonical artifact prototype), Epic 15 (role-aware lenses).

**Bootstrap function.** From M4 on, every build session is observed through `/atelier`. The dashboard you are building is the dashboard you are using to coordinate building it.

**Demoable.** Open `/atelier` as analyst — see in-flight `research_artifact` contributions. Switch to dev lens — see file-level claims and locks. Switch to PM lens — see the contribution queue grouped by trace ID.

**Exit criteria.** All five lenses render against M2's data. Role-based auth gates the lenses correctly. The team's own work on M4 is visible in `/atelier` in real time.

---

### M4 — Multi-composer concurrency

**Status:** Done (~2026-05-01). No per-milestone exit audit; backfilled by `../architecture/audits/milestone-M7-exit.md`.

**Produces.** Pub/sub broadcast (the second of ADR-016's two substrates), live presence indicators, real-time conflict surfacing in `/atelier`.

**Operationalizes.** ADR-009, ADR-016 (broadcast substrate lit up).

**Advances.** BRD Epic 14 (composer lifecycle), Epic 4 (concurrency aspects).

**Bootstrap function.** Two or more composers (human or agent) can now author concurrently with each other observable in `/atelier`. The multi-composer coordination capability is fully active.

**Demoable.** Two remote agents author against the same `research_artifact`; the second is fenced out; both are visible to each other in the analyst lens with live presence.

**Exit criteria.** Concurrent claim/release flows pass under load. Presence is accurate within 2 seconds. The team is using M4 to coordinate building M5.

---

### M5 — find_similar + eval harness + CI gate

**Status:** Done (2026-05-01). No per-milestone exit audit; backfilled by `../architecture/audits/milestone-M7-exit.md`. The calibration sequence is captured in ADR-042 (hybrid retrieval + RRF thresholds + multi-author seed expansion); the gate-tier framing is captured in ADR-043 (advisory/blocking split); the wider-eval finding that reframed the wedge is captured in ADR-047.

**Produces.** Find_similar scoring service backed by an OpenAI-compatible embedding adapter per ADR-041 (default `text-embedding-3-small`, 1536-dim). Hybrid retrieval (vector kNN + Postgres BM25, fused via RRF k=60) per ADR-042. Eval harness with a 111-seed multi-author set drawn from this repo's decision/contribution corpus. Keyword-search fallback with explicit UI degraded banner per US-6.5.

**Operationalizes.** ADR-006 (find_similar + eval harness + keyword fallback) — but with the gate-tier framing of ADR-043 + ADR-047, not the original ≥75%/≥60% blocking gate ADR-006 specified.

**Advances.** BRD Epic 6 (find_similar + eval harness).

**Bootstrap function.** Find_similar is available on every PR as an *advisory* signal against the corpus from M5-exit forward. The dogfood inflection point per ADR-044 happens at this milestone exit (M6 is the first fully self-coordinating milestone).

**Demoable.** A potentially-misaligned contribution surfaces find_similar matches at PR time; the operator decides whether to act on the signal. Aligned contributions pass cleanly. Eval-set precision/recall reported on every push (informational).

**Exit criteria (as actually met).** Eval set committed and versioned (`atelier/eval/find_similar/seeds.yaml`, 111 multi-author seeds). Precision/recall metrics published per-run. Internal-corpus measurement cleared the ADR-043 *advisory* tier (P=0.672, R=0.626 against P≥0.60 / R≥0.60). Gate ships *informational* in CI (continue-on-error) per the ADR-045-companion eval-gate flip; *blocking* tier was reversed by ADR-047 after the wider-eval (claude-agent-sdk corpus) measured P=0.5540 / R=0.5423 — below advisory.

**Original ADR-006 framing (preserved for provenance).** ADR-006 specified a CI gate at ≥75% precision and ≥60% recall, mandatory on `main`, with find_similar pitched as the wedge that prevents duplicate work hands-off. ADR-042/043/047 sequenced the actual calibration: ADR-042 found the right retrieval architecture; ADR-043 split the gate into advisory + blocking tiers preserving ADR-006's ambition without overclaiming; ADR-047 reversed the blocking tier when the wider eval failed to clear it. The advisory tier IS the v1 wedge; blocking-tier remains a v1.x opt-in gated on a cross-encoder reranker per BRD-OPEN-QUESTIONS §27.

---

### M6 — Remote-principal composers + triage

**Status:** Done (2026-05-02; see `../architecture/audits/milestone-M6-exit.md`)

**Produces.** External web-agent composers (Claude Code, Cursor, custom MCP clients) as first-class actors per ADR-009. Triage queue requiring human approval for all external-sourced content per ADR-018. Auth/authz scoped to remote-principal class.

**Operationalizes.** ADR-009, ADR-018 (triage never auto-merges), ADR-024 (transcript ingestion runtime — schema field landed at M2, capture path lights up here with the analyst case).

**Advances.** BRD Epic 16 (remote composer support), Epic 10 (external integrations), Epic 13 (security — auth/authz path for remote composers). Ships `atelier invite` in raw form (Epic 1 partial; polished at M7).

**Bootstrap function.** The end-to-end analyst case from `BRD-OPEN-QUESTIONS §1` is now executable. M7 itself can be built largely by external agents under triage supervision, which is the strongest stress test of the whole substrate.

**Demoable.** An external Claude Code session claims a `research_artifact`, authors it, runs find_similar, queues it for triage; PM principal approves via `/atelier`; decision is logged; release_scope completes — all observable end-to-end.

**Reference chat-app bot (deferred from v1).** A reference Slack and Discord bot ships under `apps/reference-bots/` implementing the chatbot pattern from `../user/connectors/chatbot-pattern.md`. Per-platform runbook + smoke tests + identity flow (Model B per the pattern doc) demonstrate the chat-surface coordination path end-to-end. The pattern itself is documented at v1; the reference implementation lands here at M6 alongside other AI-coordination concentrations (auto-reviewers per BRD-OPEN-QUESTIONS section 21, annotation surface per section 23).

**Exit criteria.** Analyst-week-1 scenario passes. Triage gate cannot be bypassed. Remote composer auth tokens are scoped, revocable, and audited. Reference chat-bot scaffold runs end-to-end against a staging endpoint with at least one human-in-chat flow exercised (claim + log_decision via Slack).

---

### M7 — Hardening + open-ADR resolution

**Status:** Done (2026-05-03; see `../architecture/audits/milestone-M7-exit.md`). The Playwright IA/UX suite that was the remaining exit gate per PR #40 landed in two layers:

- **PR #43** — static layer: `prototype/__smoke__/iaux.smoke.ts`. Source-text contract assertions on data modules + Refresher + lens panels (LIMIT requires ORDER BY; recency-DESC requires LIMIT; Refresher poll declared at 30_000; baseline absence of client-side filter/sort controls; no client-side `.sort()` on rendered lists). 23 assertions; runs in <1s; wired to CI.
- **PR #44** — DOM layer: `prototype/__smoke__/iaux.dom.spec.ts`. Render-time assertions against a moderate-scale fixture (100 contributions, 50 locks, 200 contribution-telemetry, 30 lock-telemetry rows). 5 tests covering render-ceiling enforcement, lens-weighting at scale, server-side LIMIT enforcement at the network layer, and live freshness (Refresher tick observation). 5 passing; ~38s; local-only at v1 (CI integration filed as v1.x polish requiring supabase-in-CI).

v1 substrate is now publication-ready per the no-announcement-ceremony principle (PR #40): README + repo description state shipped status; the substrate validates itself through automated flows; adoption discovery is organic.

**Produces.** D24 (embedding model default) resolved by ADR-041 prior to M5; D22 resolved as ADR-026; D23 resolved as ADR-028. Observability stack (telemetry table populated, `/atelier/observability` route at v1; out-of-band alerting deferred to v1.x per BRD-OPEN-QUESTIONS §30). 12 v1 CLI commands per NORTH-STAR §10 — split per §9 below into 6 working at v1 (sync, reconcile, eval, audit, review, dev) and 7 pointer-stubs to v1.x (init, datastore, deploy, invite, territory, doctor, upgrade). Reference-implementation technology choices documented (ADR-027 + ADR-046 deploy strategy). Lint rule banning proprietary imports outside named adapters per ADR-029 (PR #28). `docs/migration-to-gcp.md` runbook **NOT delivered** at v1 — the portability lint operationalizes the constraint at code level, but the per-capability migration runbook is filed as M7-exit follow-up F7.2 in the M7-exit audit and held until first adopter signal requests an actual GCP migration. ADR-029's promise-to-author at M2 was never honored; the M7-exit drift sweep surfaced it cleanly through validator link-integrity (broken link in `docs/developer/fork-and-customize.md`).

**Operationalizes.** New ADR for D24. ADR-012 (capability-level architecture) reaffirmed by labeling all reference choices as "one valid implementation." ADR-029 hardened with lint discipline.

**Advances.** BRD Epic 1 (scaffolding & lifecycle), Epic 11 (CLI tooling), Epic 12 (observability), Epic 13 (security model).

**Bootstrap function.** Closes the loop. A fresh `atelier init` on an empty directory produces a working coordination substrate with one command.

**Demoable.** `atelier init demo-project && cd demo-project && atelier deploy` produces a live prototype + endpoint with the five lenses working out of the box.

**Exit criteria.** All 35 design decisions in `../functional/PRD-COMPANION.md` are DECIDED (no OPEN). `atelier init` round-trips clean. Automated IA/UX validation suite (Playwright) covers the prototype's dynamic surfaces (`/atelier` lenses + `/atelier/observability`) per the IA/UX scope rule. No announcement ceremony — the README + repo description state shipped status; the substrate validates itself through automated flows. Adoption discovery is organic.

---

## 6. How this document evolves

- **Editable in place.** Re-ordering within a milestone, refining exit criteria, adjusting demoable artifacts, or redistributing scope between adjacent milestones to honor an existing dependency happens via PR to this file. The rationale lives inline (or in `../architecture/walks/` if it grows).
- **Reorders log an ADR only when load-bearing.** A reorder warrants an ADR only when it reflects a load-bearing architectural choice with real alternatives — for example, swapping which capability arrives first when both orderings are coherent. Tightening the sequence to honor a dependency that already exists in the design is not architectural; it is sequence hygiene, and it lives in this file.

  Apply the test from `../methodology/METHODOLOGY.md §6.1`: *if we'd done this right from the start, would the ADR survive?* If the answer is no — the reorder would simply be how this doc was authored — it is not ADR-worthy.
- **Status transitions** (`Planned` → `In progress` → `Done`) are PR-tracked. Mark a milestone Done only when its exit criteria are met.
- **No phase tags in design docs.** This file holds all sequencing language. `NORTH-STAR.md` / `../functional/PRD.md` / `../functional/BRD.md` / `../architecture/ARCHITECTURE.md` remain phase-free per ADR-011.

---

## 7. Open questions about the sequence itself

These are sequence-specific open items distinct from `../functional/BRD-OPEN-QUESTIONS.md`.

1. **Should find_similar arrive earlier than M5?** Pulling it forward to M3 means the eval signal arrives before UI ships and could shape lens design. Cost: M3 grows substantially and may slip M4. Trade-off worth surfacing once M2 lands and M3 estimates harden.
2. **Should M4 (concurrency) precede M3 (UI)?** Demoing concurrency without a UI is harder, but demoing UI without real concurrency makes M3 partly fake. The current order assumes thin UI on top of stubbed concurrency is acceptable for one milestone; revisit if M3 dogfooding feels hollow.
3. **D24 (embedding model default) must resolve before M5 starts.** M5 ships find_similar; find_similar needs a chosen model. Recommend resolving D24 during M3/M4 (benchmark ≥3 candidates against the seed eval set) so M5 can begin without blocking. Currently the only OPEN ADR-relevant decision (D22, D23 already resolved as ADR-026 and ADR-028).
4. **What is the smallest M2 that still unblocks M3?** If the 12-tool endpoint can be split into a "coordination subset" (claim/release/log_decision) shipped first, M3 could begin in parallel. Investigate at M1 exit.
5. **Adapter sequencing within M1.** RESOLVED 2026-04-27. M1 ships the adapter interface (US-10.2) plus the GitHub Issues + GitHub Discussions adapter as the reference. Jira, Linear, Confluence, Notion, Figma adapters land at M1.5 (new milestone added between M1 and M2). All five non-GitHub adapters remain v1 scope per ADR-011; only their order of construction is sequenced after M1's substrate validation.
6. **Round-trip whitelist surface.** The M1 round-trip integrity test ("markdown → datastore → projector → markdown is byte-identical") needs a precise contract for what counts as permissible normalization (trailing newline, YAML key ordering, etc.) versus drift. Tracked in `../functional/BRD-OPEN-QUESTIONS.md §17`.
7. **publish-delivery trigger model.** publish-delivery fires on contribution state transitions. Pre-M2, those transitions are direct DB writes from the sync library; pre-M4, there is no broadcast substrate. Open question: does M1's publish-delivery use polling, post-commit hooks on the write library, or does this dependency pull the broadcast substrate forward? Tracked in `../functional/BRD-OPEN-QUESTIONS.md §18`.

---

## 8. Provenance

The 8-milestone shape was derived from a "destination-first build sequencing" exercise, validated against the 32 ADRs, and structured to make the recursion check (§3) the central organizing principle.

---

## 9. CLI surface sequencing convention

This repo is **hand-bootstrapped** — it is the artifact that `atelier init` will eventually produce. The full v1 CLI surface (12 commands per NORTH-STAR §10, plus `atelier dev` per US-11.13 added during M7) ships across milestones in two phases per command -- raw form (the underlying capability works via direct script invocation) and polished form (CLI wrapper with `--help`, exit codes, end-to-end test).

The v1 polished-form scope review at PR #37 surfaced an honest split: 6 commands ship working polished form at v1; 7 ship as pointer-stubs that print the v1 raw equivalent and exit 0, with the polished implementation deferred to v1.x. The table below records which.

| Command | Group | Raw form (functional, hand-invokable) | v1 polished form |
|---|---|---|---|
| `atelier init` | Lifecycle (Epic 1) | M0 (this repo's structure) + M2 (guided handshake protocol per US-1.8) | **v1 polished** (D5) — clones the reference repo, customizes `.atelier/config.yaml` + README, strips discovery docs to template skeletons, optionally delegates to `atelier datastore init` + `atelier invite`. Cloud-mode auto-provisioning + the guided handshake protocol per US-1.8 (credential-handover surface) remain v1.x scope |
| `atelier datastore init` | Lifecycle (Epic 1) | M2 (raw SQL migration scripts) | **v1.x stub** — prints `supabase db reset` pointer |
| `atelier deploy` | Lifecycle (Epic 1) | M3 (raw deploy script for prototype + endpoint) | **v1 polished** (D6) — preflight (vercel CLI, login, project link, env vars), pre-deploy validation (typecheck + portability lint + yaml lint; --skip-checks), build (--skip-build), `vercel deploy [--prod]`, post-deploy verify (discovery + /api/mcp dispatch). Per ADR-046 Vercel + Supabase Cloud + rootDirectory=prototype. Operator-driven `vercel link` + env-var setup remain one-time per `docs/user/tutorials/first-deploy.md` |
| `atelier invite` | Lifecycle (Epic 1) | M6 (token issuance for remote-principal composers) | **v1.x stub** — prints Supabase Auth invite + bearer-rotation pointer |
| `atelier territory add` | Lifecycle (Epic 1) | M2 (manual `.atelier/territories.yaml` edit pattern) | **v1.x stub** — prints YAML edit pointer + audit invocation |
| `atelier doctor` | Lifecycle (Epic 1) | M2 (raw script invocation of the ARCH 6.1.1 self-verification flow) | **v1.x stub** — prints `atelier dev` + smoke pointer (overlaps with `atelier dev` at v1) |
| `atelier upgrade` | Lifecycle (Epic 1) | -- | **v1.x stub** (no v1 raw form; semver-aware migration system is v1.x scope per BRD-OPEN-QUESTIONS §29) |
| `atelier dev` | Lifecycle (Epic 1; US-11.13) | M7 (PR #35; one-command local substrate bringup) | **v1 polished** (PR #35) |
| `atelier sync` | Sync substrate (Epic 9) | M1 (direct invocation of underlying script) | **v1 polished** (PR #37) |
| `atelier reconcile` | Sync substrate (Epic 9) | M1 (direct invocation of `scripts/sync/reconcile.ts`) | **v1 polished** (PR #37) |
| `atelier eval find_similar` | Eval (Epic 6) | M5 (direct invocation of eval harness) | **v1 polished** (PR #37) |
| `atelier audit` | Process (Epic 11) | M1 (raw script invocations of the extended validator) | **v1 polished** (PR #37) |
| `atelier review` | Process (Epic 11) | M1 (raw script computing required reviewers from territories.yaml + config.yaml) | **v1 polished** (PR #37) |

**Why this honest split:** the original M7 plan was to wrap all 12 commands into polished form. PR #37's scope review found that 7 of the 12 either had no v1 raw form (`upgrade`), or had raw forms that overlap a different polished command (`doctor` overlaps `dev`), or required substantive new infrastructure (`init`'s US-1.8 handshake; `deploy`'s vercel-and-supabase orchestration; `datastore init`'s migration runner; `invite`'s Auth bridge; `territory add`'s YAML editor) that wasn't in scope. Rather than ship six commands as half-implementations, the polished-form pointer-stub pattern was adopted: each stub prints the v1 raw-equivalent path (so the underlying capability is reachable via documented escape hatch) and exits 0. The stubs DO satisfy `--help`, exit-code, and smoke-test contracts; they just don't wrap a polished v1 capability the substrate doesn't have yet.

**Acceptance for "raw form":** the underlying capability works end-to-end via direct script invocation.
**Acceptance for "v1 polished":** US-11.x story passes — exit-code contract, `--help` output, end-to-end smoke.
**Acceptance for "v1.x stub":** prints v1 raw-equivalent pointer with link to runbook; exits 0; smoke asserts the pointer matches documented path.
