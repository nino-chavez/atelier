# Build Sequence: Atelier reference implementation

**Companion to:** `NORTH-STAR.md`, `PRD.md`, `BRD.md`
**Status:** Draft v1.0
**Owner:** Nino Chavez
**Last updated:** 2026-04-24
**Related:** `DECISIONS.md`, `PRD-COMPANION.md`, `BRD-OPEN-QUESTIONS.md`

---

## 1. Purpose

This document specifies the **order** in which the v1 destination defined in `NORTH-STAR.md` is built. It is the answer to "we cannot phase the design; how do we sequence the implementation?"

It is explicitly **not** a roadmap, a phased rollout, or a feature-deferral plan. The v1 scope is locked (per ADR-011). Every capability in `NORTH-STAR.md` is in v1. This document only governs the order of construction.

---

## 2. Relationship to other docs

| Doc | Concern | Mutability |
|---|---|---|
| `NORTH-STAR.md`, `PRD.md`, `BRD.md`, `ARCHITECTURE.md` | What is built (destination scope) | Append/edit; locked v1 scope |
| `PRD-COMPANION.md` | Why design decisions were made | Editable; rationale record |
| `DECISIONS.md` | Append-only canonical decision log | Append-only |
| **`BUILD-SEQUENCE.md` (this doc)** | **Order of construction** | **Editable; major reorders log an ADR** |

This doc is **not** in the canonical-state precedence list in `CLAUDE.md`. If it conflicts with any design doc, the design doc wins.

---

## 3. The recursion check

Atelier dogfoods itself. From **M2** onward, every contribution toward building Atelier is tracked *in* Atelier. From **M5** onward, every contribution is fit-checked against the corpus. By **M6**, the analyst case from `BRD-OPEN-QUESTIONS §1` is not a hypothetical — it is the artifact that produces M7.

**At each milestone, ask:** "Did we use the previous milestone to coordinate building this one?" If the answer is no, dogfooding has drifted and the milestone is suspect.

This is also the strongest disconfirming test available before public release. A reference implementation that cannot run its own development is unlikely to run anyone else's.

---

## 4. Milestone summary

| ID | Title | Bootstrap function | Status |
|---|---|---|---|
| **M0** | Methodology | Repo + git + markdown is the starting substrate | **Done** (2026-04-24) |
| **M1** | SDLC sync substrate (5 scripts) | Markdown↔datastore↔projector consistency | Planned |
| **M2** | Schema + 12-tool endpoint stub + fenced locks | Coordination substrate goes live; contributions become trackable | Planned |
| **M3** | Prototype shell + `/atelier` + 5 lenses | The dashboard you build is the dashboard you use | Planned |
| **M4** | Multi-composer concurrency (real broadcast) | Concurrent authoring is observable and conflict-safe | Planned |
| **M5** | fit_check + eval harness + CI gate | Disconfirming test on the commercial wedge fires | Planned |
| **M6** | Remote-principal composers + triage | Analyst case executes through Atelier itself | Planned |
| **M7** | Hardening + open-ADR resolution | Reference implementation is publication-ready | Planned |

---

## 5. Milestone details

---

### M0 — Methodology

**Status:** Done (2026-04-24)

**Produces.** Repo conventions, 20 ADRs, `traceability.json` registry, `.atelier/territories.yaml`, `.atelier/config.yaml`, `CLAUDE.md` agent constitution, complete v1 design corpus.

**Operationalizes.** ADR-005, ADR-011, ADR-012, ADR-014, ADR-015, ADR-018, ADR-025.

**Advances.** Pre-BRD; this is methodology setup, not a BRD epic.

**Bootstrap function.** Establishes the substrate every later milestone runs on: markdown is canonical, decisions are append-only, scope is destination-first, architecture is capability-level. Without M0 the rest is unprincipled.

**Demoable.** This repo, https://github.com/Signal-x-Studio-LLC/atelier.

**Exit criteria.** Met: design scope locked, all 20 ADRs landed, scaffolding complete, `HANDOFF.md` written.

---

### M1 — SDLC sync substrate

**Status:** Planned

**Produces.** All five sync scripts (per ADR-008): markdown→datastore, datastore→projector, traceability validation, decisions mirror, territories mirror.

**Operationalizes.** ADR-005, ADR-008, ADR-016.

**Advances.** BRD Epic 9 (sync substrate).

**Bootstrap function.** Once consistent, every doc edit from M2 onward propagates without manual reconciliation. This is the layer that makes "repo is canonical, datastore mirrors" actually true.

**Demoable.** Edit `DECISIONS.md` and watch the datastore mirror update; edit `traceability.json` and watch BRD links resolve in CI; rename a territory in `.atelier/territories.yaml` and watch downstream references reconcile.

**Exit criteria.** All 5 scripts green in CI on this repo's own corpus. Round-trip integrity test passes (markdown → datastore → projector → markdown is byte-identical).

---

### M2 — Schema + 12-tool endpoint stub + fenced locks

**Status:** Planned

**Produces.** Relational schema with `contributions`, `decisions`, `scopes`, `locks`, `composers`, `sessions`, `contracts` tables. The 12-tool agent endpoint per ADR-013, with fit_check returning `unknown` (real fit_check arrives in M5). Locks with fencing tokens from day one.

**Operationalizes.** ADR-002, ADR-003, ADR-004, ADR-013, ADR-014, ADR-015, ADR-019.

**Advances.** BRD Epic 2 (endpoint), Epic 4 (territory + contribution), Epic 5 (decision durability — write path), Epic 7 (locks + fencing), Epic 8 (territory contracts).

**Bootstrap function.** **The dogfooding ignition point.** Every contribution toward M3+ is itself a tracked contribution. Every decision goes into `DECISIONS.md` first (per ADR-005), then mirrors via M1's scripts.

**Demoable.** Two `claim_scope` calls on the same scope; second rejected with stale-fencing-token error. `log_decision` appends to `DECISIONS.md` and the datastore mirror reflects within one M1 sync cycle.

**Exit criteria.** All 12 tools respond with real (non-stub) values except `fit_check`. Fencing tokens enforced in CI integration tests. The build of M3 onward registers contributions in this datastore.

---

### M3 — Prototype shell + `/atelier` route + 5 lenses

**Status:** Planned

**Produces.** Prototype web app with five routes (`/`, `/strategy`, `/design`, `/slices/[id]`, `/atelier`, `/traceability`). The `/atelier` route renders the five role-aware lenses (analyst, dev, PM, designer, stakeholder) per ADR-018, backed by M2's endpoint.

**Operationalizes.** ADR-001, ADR-017, ADR-018, ADR-021.

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

**Bootstrap function.** Two or more composers (human or agent) can now author concurrently with each other observable in `/atelier`. The "hackathon-hive" capability is fully active.

**Demoable.** Two remote agents author against the same `research_artifact`; the second is fenced out; both are visible to each other in the analyst lens with live presence.

**Exit criteria.** Concurrent claim/release flows pass under load. Presence is accurate within 2 seconds. The team is using M4 to coordinate building M5.

---

### M5 — fit_check + eval harness + CI gate

**Status:** Planned

**Produces.** Fit_check scoring service backed by an embedding model (default selected per D24 resolution in M7 prep), eval harness with a labeled seed set drawn from this repo's own decisions corpus, CI gate enforcing ≥75% precision at ≥60% recall per ADR-006.

**Operationalizes.** ADR-006.

**Advances.** BRD Epic 6 (fit_check + eval harness).

**Bootstrap function.** Every PR merging into Atelier from this point is fit-checked against Atelier's own corpus. **This is the disconfirming test the entire commercial wedge depends on.** Failure here does not stop the project (every other capability still ships), but it does scope the commercial story.

**Demoable.** A deliberately-misaligned contribution (e.g., one that violates ADR-007 by introducing SaaS coupling) is rejected at PR time with a fit_check explanation. An aligned contribution passes. Eval-set precision/recall reported on every push.

**Exit criteria.** CI gate is mandatory on `main`. Eval set is committed and versioned. Precision/recall metrics published per-run. The disconfirming test has fired at least once.

---

### M6 — Remote-principal composers + triage

**Status:** Planned

**Produces.** External web-agent composers (Claude Code, Cursor, custom MCP clients) as first-class actors per ADR-009. Triage queue requiring human approval for all external-sourced content per ADR-020. Auth/authz scoped to remote-principal class.

**Operationalizes.** ADR-009, ADR-020.

**Advances.** BRD Epic 16 (remote composer support), Epic 10 (external integrations), Epic 13 (security — auth/authz path for remote composers).

**Bootstrap function.** The end-to-end analyst case from `BRD-OPEN-QUESTIONS §1` is now executable. M7 itself can be built largely by external agents under triage supervision, which is the strongest stress test of the whole substrate.

**Demoable.** An external Claude Code session claims a `research_artifact`, authors it, runs fit_check, queues it for triage; PM principal approves via `/atelier`; decision is logged; release_scope completes — all observable end-to-end.

**Exit criteria.** Analyst-week-1 scenario passes. Triage gate cannot be bypassed. Remote composer auth tokens are scoped, revocable, and audited.

---

### M7 — Hardening + open-ADR resolution

**Status:** Planned

**Produces.** Resolutions to D22 (Switchman as dependency vs. own-impl), D23 (identity service default), D24 (embedding model default) — each landed as a new ADR. Observability stack. `atelier init` and `atelier deploy` polished. Reference-implementation technology choices documented (per Option D in `HANDOFF.md`).

**Operationalizes.** New ADRs for D22, D23, D24. ADR-012 (capability-level architecture) reaffirmed by labeling all reference choices as "one valid implementation."

**Advances.** BRD Epic 1 (scaffolding & lifecycle), Epic 11 (CLI tooling), Epic 12 (observability), Epic 13 (security model).

**Bootstrap function.** Closes the loop. A fresh `atelier init` on an empty directory produces a working coordination substrate with one command.

**Demoable.** `atelier init demo-project && cd demo-project && atelier deploy` produces a live prototype + endpoint with the five lenses working out of the box.

**Exit criteria.** All 25 design decisions in `PRD-COMPANION.md` are DECIDED (no OPEN). `atelier init` round-trips clean. Public reference implementation is announced.

---

## 6. How this document evolves

- **Editable in place.** Re-ordering within a milestone, refining exit criteria, or adjusting demoable artifacts happens via PR to this file.
- **Major reorders log an ADR.** Moving a milestone (e.g., bringing fit_check forward to M3) is consequential and warrants an entry in `DECISIONS.md` referencing the prior sequence. The ADR explains *why* the order changed; this doc reflects the *current* order.
- **Status transitions** (`Planned` → `In progress` → `Done`) are PR-tracked. Mark a milestone Done only when its exit criteria are met.
- **No phase tags in design docs.** This file holds all sequencing language. `NORTH-STAR.md` / `PRD.md` / `BRD.md` / `ARCHITECTURE.md` remain phase-free per ADR-011.

---

## 7. Open questions about the sequence itself

These are sequence-specific open items distinct from `BRD-OPEN-QUESTIONS.md`.

1. **Should fit_check arrive earlier than M5?** Pulling it forward to M3 means the eval signal arrives before UI ships and could shape lens design. Cost: M3 grows substantially and may slip M4. Trade-off worth surfacing once M2 lands and M3 estimates harden.
2. **Should M4 (concurrency) precede M3 (UI)?** Demoing concurrency without a UI is harder, but demoing UI without real concurrency makes M3 partly fake. The current order assumes thin UI on top of stubbed concurrency is acceptable for one milestone; revisit if M3 dogfooding feels hollow.
3. **What is the smallest M2 that still unblocks M3?** If the 12-tool endpoint can be split into a "coordination subset" (claim/release/log_decision) shipped first, M3 could begin in parallel. Investigate at M1 exit.
4. **Does M7's Switchman decision (D22) need to land before M2 ships locks?** If Switchman is adopted, the locks subsystem in M2 changes shape. Recommend resolving D22 *during* M1 to derisk M2.

---

## 8. Provenance

The 8-milestone shape was derived from `HANDOFF.md` Option C ("destination-first build sequencing"), validated against the 20 ADRs, and structured to make the recursion check (§3) the central organizing principle.
