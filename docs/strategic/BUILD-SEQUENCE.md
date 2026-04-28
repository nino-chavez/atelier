# Build Sequence: Atelier reference implementation

**Companion to:** `NORTH-STAR.md`, `../functional/PRD.md`, `../functional/BRD.md`
**Status:** Draft v1.0
**Owner:** Nino Chavez
**Last updated:** 2026-04-27
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

Atelier dogfoods itself. From **M1** onward, every contribution toward building Atelier is tracked *in* Atelier — through M1's thin schema and sync substrate. From **M2** onward, those contributions are written through the endpoint rather than directly. From **M5** onward, every contribution is checked via find_similar against the corpus. By **M6**, the analyst case from `BRD-OPEN-QUESTIONS §1` is not a hypothetical — it is the artifact that produces M7.

**At each milestone, ask:** "Did we use the previous milestone to coordinate building this one?" If the answer is no, dogfooding has drifted and the milestone is suspect.

This is also the strongest disconfirming test available before public release. A reference implementation that cannot run its own development is unlikely to run anyone else's.

---

## 4. Milestone summary

| ID | Title | Bootstrap function | Status |
|---|---|---|---|
| **M0** | Methodology | Repo + git + markdown is the starting substrate | **Done** (2026-04-24) |
| **M1** | SDLC sync substrate (5 scripts) + thin schema (4 tables) + adapter interface + GitHub adapter | Sync scripts run against real persistence; dogfooding ignition point | Planned |
| **M1.5** | Remaining external adapters (Jira, Linear, Confluence, Notion, Figma) | Full v1 adapter coverage; sequenced after M1 to avoid blocking dogfooding ignition | Planned |
| **M2** | 12-tool endpoint + fenced locks + remaining schema (5 tables) | Coordination substrate goes live; agents coordinate through the endpoint | Planned |
| **M3** | Prototype shell + `/atelier` + 5 lenses | The dashboard you build is the dashboard you use | Planned |
| **M4** | Multi-composer concurrency (real broadcast) | Concurrent authoring is observable and conflict-safe | Planned |
| **M5** | find_similar + eval harness + CI gate | Disconfirming test on the commercial wedge fires | Planned |
| **M6** | Remote-principal composers + triage | Analyst case executes through Atelier itself | Planned |
| **M7** | Hardening + open-ADR resolution | Reference implementation is publication-ready | Planned |

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

**Exit criteria.** Met: design scope locked, 32 ADRs landed (the doc-organization cleanup added ADR-030/031/032), scaffolding complete, session checkpoint at `.atelier/checkpoints/SESSION.md`, docs structurally organized into the seven-layer tree (per ADR-032).

---

### M1 — SDLC sync substrate + thin schema

**Status:** Planned

**Produces.** All five sync scripts per ADR-008: `publish-docs` (repo → published-doc system, full overwrite + banner), `publish-delivery` (contribution state → delivery tracker), `mirror-delivery` (delivery tracker → registry, nightly), `reconcile` (bidirectional drift detector, reports only), `triage` (external comments → `kind=proposal` contributions, never auto-merges).

Plus the four schema tables the sync scripts read or write — `projects`, `territories`, `contributions`, `decisions` — with their `ARCHITECTURE.md §5.2` indexes (`contributions(project_id, state)`, GIN on `contributions.trace_ids`, GIN on `decisions.trace_ids`, `decisions(project_id, created_at DESC)`). Row-level authorization scaffolding scoped to `project_id`; append-only enforcement on `decisions`. An internal library `scripts/sync/lib/datastore.ts` wraps writes; no public endpoint surface yet.

The traceability validator under `scripts/traceability/` (separate concern from the five sync scripts) lands here too, since CI gates depend on it.

**Why the four tables land here, not at M2.** Three of the five sync scripts (`publish-delivery`, `mirror-delivery`, `triage`) write to or read from `contributions`. Without the table, ADR-008's "all 5 ship together" cannot be honored against real persistence — only against stubs. Landing the four tables here is the smallest change that makes ADR-008 executable. The remaining five tables (`composers`, `sessions`, `locks`, `contracts`, `telemetry`) stay at M2 because the endpoint is what needs them.

**Operationalizes.** ADR-005, ADR-008, ADR-016, ADR-018 (triage never auto-merges), ADR-021 (multi-trace, GIN indexes).

**Advances.** BRD Epic 9 (sync substrate, all 5 scripts), Epic 4 (territory + contribution — schema portion), Epic 5 (decision durability — schema portion + mirror), Epic 10 (adapter interface + first concrete adapter — see §7 Q5).

**Bootstrap function.** **The dogfooding ignition point.** From M1 exit onward, every contribution toward Atelier is tracked in the four-table schema. Every doc edit propagates through the sync scripts without manual reconciliation. M2 coordinates against persistence that already exists rather than scaffolding it.

**Demoable.** Commit a BRD edit; `publish-docs` overwrites the published-doc page with a banner. Transition a contribution row to `claimed`; `publish-delivery` upserts the delivery-tracker issue. Run `reconcile`; report enumerates every divergence between repo and external. Post a comment on a published-doc page; `triage` classifies and drafts a `kind=proposal` row that requires human merge.

**Exit criteria.** All 5 scripts green in CI on this repo's own corpus. Schema migration applied; the four indexes exist. Round-trip integrity test passes against the new tables (markdown to datastore to projector to markdown is byte-identical for the canonical doc classes per scripts/README.md round-trip integrity contract). The adapter interface (`scripts/sync/adapters/types.ts`) is defined; an in-memory mock implementation passes contract tests; the GitHub Issues + GitHub Discussions adapter ships and passes integration tests. Remaining adapters (Jira, Linear, Confluence, Notion, Figma) are deferred to M1.5 per the section 16 resolution.

---

### M1.5 -- Remaining external adapters

**Status:** Planned

**Produces.** Concrete adapter implementations for the four remaining external systems against the adapter interface that landed at M1: Jira and Linear (delivery trackers, US-10.3), Confluence and Notion (published-doc systems, US-10.4), Figma (design tool, US-10.5). Each ships with integration tests against a live or recorded fixture for the external service.

**Operationalizes.** ADR-008 in full (the five sync scripts now have full provider coverage, not just GitHub).

**Advances.** BRD Epic 10 (US-10.3, US-10.4, US-10.5).

**Bootstrap function.** Dogfooding remains on GitHub since this repo lives there; the additional adapters become testable for downstream Atelier adopters who use other providers. M1.5 is sequenced before M2 so any adapter surface changes that would affect the endpoint surface are caught before the endpoint lands.

**Demoable.** Configure `.atelier/config.yaml: integrations.delivery_tracker.kind: jira` (or linear); publish-delivery upserts a real Jira issue. Configure `published_docs.kind: confluence`; publish-docs writes a Confluence page with the canonical banner. Configure `design_tool.kind: figma`; triage picks up Figma comments and routes them to proposal contributions.

**Exit criteria.** All five non-GitHub adapters pass their integration tests in CI against either live test instances or recorded HTTP fixtures. Each adapter's setup runbook lands in `docs/user/integrations/<provider>.md` (the user-docs layer fills in here for the first time).

**Why this is M1.5 not M2.** Per the section 16 resolution: shipping all five non-GitHub adapters at M1 would significantly expand M1 scope and require procuring credentials for five external services before M1 could exit. The interface plus the GitHub adapter is sufficient to validate the substrate and unblock M2 dogfooding (which lives on GitHub). The M1.5 epic is real v1 scope per ADR-011 -- all adapters ship before public release -- but its order of construction is decoupled from M2's endpoint work.

---

### M2 -- 12-tool endpoint + fenced locks + remaining schema

**Status:** Planned

**Produces.** The five remaining tables on top of M1's four — `composers`, `sessions`, `locks`, `contracts`, `telemetry` (per ARCHITECTURE §5.1). The 12-tool agent endpoint per ADR-013, with find_similar returning `unknown` (real find_similar arrives in M5). Locks with fencing tokens from day one. The `BroadcastService` interface (per ADR-029) lands here — default impl Supabase Realtime, documented migration impl Postgres NOTIFY/LISTEN — though the broadcast substrate goes live at M4. `atelier datastore init` ships in raw form here (Epic 1 partial; polished at M7).

Per-composer attribution kicks in: M1's service-role internal writes are joined by per-session attributed writes through the endpoint.

**Operationalizes.** ADR-002, ADR-003, ADR-004, ADR-013 (12 tools, MCP reference), ADR-014, ADR-015, ADR-022 (claim atomic-create), ADR-023 (remote-surface committer), ADR-024 (transcript schema field), ADR-026 (own-impl lock+fencing), ADR-027 (Supabase + Vercel reference stack), ADR-028 (Supabase Auth default), ADR-029 (GCP-portability constraint; `BroadcastService` interface lands here).

**Advances.** BRD Epic 2 (endpoint), Epic 4 (territory + contribution — endpoint surface), Epic 5 (decision durability — endpoint write path), Epic 7 (locks + fencing), Epic 8 (territory contracts).

**Bootstrap function.** Coordination substrate goes live. Agents register sessions, claim contributions through the endpoint, acquire fenced locks. The contributions table (already populated by M1's sync scripts) gains its endpoint write path so M3 onward composes through the protocol rather than direct DB writes.

**Demoable.** Two `claim_scope` calls on the same scope; second rejected with stale-fencing-token error. `log_decision` appends to `../architecture/decisions` and the datastore mirror reflects within one sync cycle.

**Exit criteria.** All 12 tools respond with real (non-stub) values except `find_similar`. Fencing tokens enforced in CI integration tests. The build of M3 onward registers contributions through the endpoint, not direct DB writes.

---

### M3 — Prototype shell + `/atelier` route + 5 lenses

**Status:** Planned

**Produces.** Prototype web app with six routes (`/`, `/strategy`, `/design`, `/slices/[id]`, `/atelier`, `/traceability`). The `/atelier` route renders the five role-aware lenses (analyst, dev, PM, designer, stakeholder) per ADR-017, backed by M2's endpoint. `atelier deploy` ships in raw form here (Epic 1 partial; polished at M7).

**Operationalizes.** ADR-001 (prototype is canonical artifact + dashboard), ADR-017 (5 lenses), ADR-019 (Figma is feedback only), ADR-025 (review routing via territory.review_role).

**Advances.** BRD Epic 3 (canonical artifact prototype), Epic 15 (role-aware lenses).

**Bootstrap function.** From M4 on, every build session is observed through `/atelier`. The dashboard you are building is the dashboard you are using to coordinate building it.

**Demoable.** Open `/atelier` as analyst — see in-flight `research_artifact` contributions. Switch to dev lens — see file-level claims and locks. Switch to PM lens — see the contribution queue grouped by trace ID.

**Exit criteria.** All five lenses render against M2's data. Role-based auth gates the lenses correctly. The team's own work on M4 is visible in `/atelier` in real time.

---

### M4 — Multi-composer concurrency

**Status:** Planned

**Produces.** Pub/sub broadcast (the second of ADR-016's two substrates), live presence indicators, real-time conflict surfacing in `/atelier`.

**Operationalizes.** ADR-009, ADR-016 (broadcast substrate lit up).

**Advances.** BRD Epic 14 (composer lifecycle), Epic 4 (concurrency aspects).

**Bootstrap function.** Two or more composers (human or agent) can now author concurrently with each other observable in `/atelier`. The multi-composer coordination capability is fully active.

**Demoable.** Two remote agents author against the same `research_artifact`; the second is fenced out; both are visible to each other in the analyst lens with live presence.

**Exit criteria.** Concurrent claim/release flows pass under load. Presence is accurate within 2 seconds. The team is using M4 to coordinate building M5.

---

### M5 — find_similar + eval harness + CI gate

**Status:** Planned

**Produces.** Find_similar scoring service backed by an embedding model (default selected per D24 resolution, which must land before M5 begins — see §7 Q3), eval harness with a labeled seed set drawn from this repo's own decisions corpus, CI gate enforcing ≥75% precision at ≥60% recall per ADR-006, keyword-search fallback with explicit UI degraded banner per US-6.5.

**Operationalizes.** ADR-006 (find_similar + eval harness + keyword fallback).

**Advances.** BRD Epic 6 (find_similar + eval harness).

**Bootstrap function.** Every PR merging into Atelier from this point is checked via find_similar against Atelier's own corpus. **This is the disconfirming test the entire commercial wedge depends on.** Failure here does not stop the project (every other capability still ships), but it does scope the commercial story.

**Demoable.** A deliberately-misaligned contribution (e.g., one that violates ADR-007 by introducing SaaS coupling) is rejected at PR time with a find_similar explanation. An aligned contribution passes. Eval-set precision/recall reported on every push.

**Exit criteria.** CI gate is mandatory on `main`. Eval set is committed and versioned. Precision/recall metrics published per-run. The disconfirming test has fired at least once.

---

### M6 — Remote-principal composers + triage

**Status:** Planned

**Produces.** External web-agent composers (Claude Code, Cursor, custom MCP clients) as first-class actors per ADR-009. Triage queue requiring human approval for all external-sourced content per ADR-018. Auth/authz scoped to remote-principal class.

**Operationalizes.** ADR-009, ADR-018 (triage never auto-merges), ADR-024 (transcript ingestion runtime — schema field landed at M2, capture path lights up here with the analyst case).

**Advances.** BRD Epic 16 (remote composer support), Epic 10 (external integrations), Epic 13 (security — auth/authz path for remote composers). Ships `atelier invite` in raw form (Epic 1 partial; polished at M7).

**Bootstrap function.** The end-to-end analyst case from `BRD-OPEN-QUESTIONS §1` is now executable. M7 itself can be built largely by external agents under triage supervision, which is the strongest stress test of the whole substrate.

**Demoable.** An external Claude Code session claims a `research_artifact`, authors it, runs find_similar, queues it for triage; PM principal approves via `/atelier`; decision is logged; release_scope completes — all observable end-to-end.

**Exit criteria.** Analyst-week-1 scenario passes. Triage gate cannot be bypassed. Remote composer auth tokens are scoped, revocable, and audited.

---

### M7 — Hardening + open-ADR resolution

**Status:** Planned

**Produces.** Resolution to D24 (embedding model default) landed as a new ADR — D22 already resolved as ADR-026 and D23 as ADR-028. Observability stack (telemetry table populated, `/atelier/observability` route, alerting). Full Epic 1 CLI polish: `atelier init`, `atelier datastore init`, `atelier deploy`, `atelier invite`, `atelier territory add`, `atelier doctor`, `atelier upgrade`. Reference-implementation technology choices documented (per ADR-027). `docs/migration-to-gcp.md` runbook finalized per ADR-029. Lint rule banning proprietary imports outside named adapters (per ADR-029).

**Operationalizes.** New ADR for D24. ADR-012 (capability-level architecture) reaffirmed by labeling all reference choices as "one valid implementation." ADR-029 hardened with lint discipline.

**Advances.** BRD Epic 1 (scaffolding & lifecycle), Epic 11 (CLI tooling), Epic 12 (observability), Epic 13 (security model).

**Bootstrap function.** Closes the loop. A fresh `atelier init` on an empty directory produces a working coordination substrate with one command.

**Demoable.** `atelier init demo-project && cd demo-project && atelier deploy` produces a live prototype + endpoint with the five lenses working out of the box.

**Exit criteria.** All 35 design decisions in `../functional/PRD-COMPANION.md` are DECIDED (no OPEN). `atelier init` round-trips clean. Public reference implementation is announced.

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

## 9. Epic 1 (CLI lifecycle) sequencing convention

This repo is **hand-bootstrapped** — it is the artifact that `atelier init` will eventually produce. That means Epic 1's CLI surface ships across milestones in two phases:

| Command | Raw form (functional, hand-invokable) | Polished form (exit-code-tested, `--help`, end-to-end tested) |
|---|---|---|
| `atelier init` | M0 (this repo's structure) | M7 |
| `atelier datastore init` | M2 (raw SQL migration scripts) | M7 |
| `atelier deploy` | M3 (raw deploy script for prototype + endpoint) | M7 |
| `atelier invite` | M6 (token issuance for remote-principal composers) | M7 |
| `atelier territory add` | M2 (manual `.atelier/territories.yaml` edit pattern) | M7 |
| `atelier doctor` | — | M7 |
| `atelier upgrade` | — | M7 |

**Why split:** the destination-first rule (ADR-011) governs feature scope, not packaging. Ergonomics polish (CLI commands, `--help` text, exit-code contracts, end-to-end tests) is correctly batched into M7 once all the underlying capabilities exist. The earlier milestones use the underlying scripts directly; M7 wraps them.

**Acceptance for "raw form":** the underlying capability works end-to-end via direct script invocation. Acceptance for "polished form": US-1.1 through US-1.7 all pass.
