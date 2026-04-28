# Methodology

**Status:** v1.0
**Owner:** Nino Chavez
**Last updated:** 2026-04-24
**Related:** `../strategic/NORTH-STAR.md`, `../strategic/STRATEGY.md`

---

## What this doc is

How this repository itself is organized. Atelier is a self-referential project: it ships the methodology it embodies. This doc declares the conventions this repo follows, which are the same conventions any repo scaffolded by `atelier init` inherits.

> Atelier applies its own methodology to itself. If the conventions here do not work for building Atelier, they don't work for anything.

---

## 1. Foundation — dual-track agile

Atelier uses the dual-track agile pattern (Marty Cagan / SVPG), with one critical reframe: the **prototype is the canonical artifact**, not just a discovery aid.

### Discovery track
Frames the problem, shapes the solution, produces the spec.

- **Canonical state:** repo (`../functional/PRD.md`, `../functional/PRD-COMPANION.md`, `../functional/BRD.md`, `../functional/BRD-OPEN-QUESTIONS.md`, `../strategic/NORTH-STAR.md`, `../strategic/STRATEGY.md`, `../architecture/ARCHITECTURE.md`, `../architecture/decisions`, `traceability.json`, slice configs, prototype source).
- **External projections:** published docs (Confluence/Notion), design tool (Figma).
- **Primary artifact:** the prototype web app — strategy + design + current-state panels, traceability route, and the `/atelier` coordination view.

### Delivery track
Turns the spec into shipped code.

- **Canonical state:** delivery tracker (Jira/Linear) for execution state; versioned file store (git) for code.
- **Cross-reference:** the trace ID (`US-X.Y`) is the single join key across all systems.

The **sync substrate** bridges the two tracks. Publishes (repo → external) are deterministic and idempotent. Pulls (external → repo) are probabilistic and human-gated.

---

## 2. The prototype is the canonical artifact

In conventional dual-track-agile setups, the prototype is a high-fidelity illustration of the spec — valuable for stakeholder alignment but not itself canonical. Canonical state lives in the markdown (BRD/PRD/ARCHITECTURE) and the prototype is downstream of it.

In Atelier, **the prototype is both the product artifact and the coordination dashboard.** It renders live from repo + datastore state. Composers interact with project state *through* the prototype. The `/atelier` route is the shared workspace. The `/strategy`, `/design`, `/slices/[id]`, and `/traceability` routes are how every composer sees the same canonical state through their role-specific lens.

Figma is a feedback surface, not a design source of truth. Designs live in the prototype's components. Figma receives projections of those components; comments on those projections flow back through triage.

---

## 2.1 The slice is the unit of authoring

Features ship as **slices**, not as horizontal layers. A slice is a vertical cut through strategy, design, and implementation that crosses every territory the feature needs. The `/slices/[id]` route renders all three layers per slice — strategy panel, design panel, current-state panel — making each slice a single observable artifact that PM, designer, dev, and stakeholder all see through their respective lenses.

**Why vertical.** Building a feature horizontally — all schema first, then all endpoints, then all UI — defers integration and feedback until the end. By then the layers have drifted from each other and from the spec. Building vertically (one tracer bullet through every layer for one slice, then the next slice) keeps the spine integrated continuously and surfaces problems while they're still cheap to fix. This is the walking-skeleton (Cockburn) / tracer-bullet (Hunt & Thomas) discipline applied to mixed human-agent teams.

**Architectural enforcement.** The prototype renders by slice and only by slice. A feature that doesn't appear in a `/slices/[id]` route is invisible to the team. This isn't a soft convention — the route is the canonical viewing surface, so slice-less work has no home in the artifact.

**Boundary discipline.** Slices cross territory boundaries by going through published contracts (per ADR-014), not by reaching into territory internals. A slice can consume contracts from multiple territories; a slice can publish a contract for downstream slices to consume. This preserves Ousterhout-style deep-module discipline: the territory is the deep module, the contract is the simple interface, the slice is the consumer.

**Anti-pattern.** "We'll build the whole schema first, then all the endpoints, then the UI." This works in solo execution; it fails in mixed-team coordination because no one has a working artifact to react to until the end. Designers wait for the UI; PMs wait for the slice; stakeholders wait for everything. Triage backs up. Find_similar can't tell duplicates from in-flight work because nothing has shipped to the slice yet.

**Adopting teams: structure work as slices.** When using Atelier on your project, the unit of authoring is the slice, not the layer. Atelier's prototype enforces this architecturally; the methodology states it as principle so the discipline survives moving to a different reference implementation.

---

## 3. Actor model — six classes

Six actor classes; the sixth is the remote-principal case for mixed-surface teams (web composers without local repo access).

| Class | Surface | Scope | Attribution | Authority |
|---|---|---|---|---|
| **Principal + IDE harness** | Local IDE | Repo + datastore via `ide` session | Human identity | Full — harness inherits principal |
| **Principal + web harness** | Browser + remote protocol | Datastore + repo via proposals | Human identity | Full for their territory; contributes to repo via PRs |
| **Guild collaboration** | Shared coordination layer | Guild-scoped drafts | Per-principal identities | Proposes; repo entry requires PR |
| **Pipeline agent** | CI / scheduled / webhook | External systems, registry mirror | Bot account | Deterministic contract; never authors canonical state |
| **Triage agent** | Server / function | Proposal contributions | Bot account (cites origin) | Proposes; human merge required |
| **App agent** | Product runtime | Product data | Per product's rules | Not SDLC — uses trace IDs for observability only |

**Principle:** authority follows surface + scope, not role. A principal's harness is trusted because the principal is in the loop. A pipeline agent is trusted because its contract is narrow. A triage agent is never trusted to merge because its input is unsanitized external comments. A web-principal is trusted for their territory because they authenticate to the datastore with per-composer tokens.

---

## 4. Authority model

Authority is assigned per field, per artifact, not per actor. The principle: authority follows where the content naturally changes.

- **Discovery fields** (title, AC, phase, priority, effort, persona, dependencies, strategy, research) → **repo-authoritative**. Changed only via PR or `log_decision`.
- **Delivery fields** (status, sprint, points, assignee) → **delivery-tracker-authoritative**. Mirrored into the registry for reporting; never back into canonical BRD.md or PRD.md.
- **Design** → **repo-authoritative** (prototype components). Design-tool projections receive comments that flow through triage.
- **Comments** (anywhere — published-doc system, delivery tracker, design tool) → **source-authoritative, triaged to proposals**. Never merged directly into canonical state.
- **Decisions** → **repo-authoritative** (per-ADR files under `../architecture/decisions/` form the canonical log per ADR-005, ADR-030; datastore mirror is a read-model).
- **Coordination state** (sessions, contribution state, locks, fencing tokens) → **datastore-authoritative** (ephemeral, not committed to repo).

---

## 5. Two substrates, orthogonal

Atelier implements both substrates declared in the methodology. They are not conflated.

### 5.1 SDLC sync substrate
Keeps repo, delivery tracker, published-doc system, design tool in coherent relation across time. Hours-to-days timescale.

Components (all ship at v1):
- `scripts/traceability/` — registry generation and trace-link injection
- `scripts/sync/publish-docs.mjs` — BRD/PRD → published-doc pages
- `scripts/sync/publish-delivery.mjs` — contribution state → delivery tracker issues
- `scripts/sync/mirror-delivery.mjs` — nightly pull of delivery-authoritative fields
- `scripts/sync/reconcile.mjs` — drift detection between repo and external systems
- `scripts/sync/triage/` — comment webhook → classifier → drafter → proposal contribution
- `scripts/sync/publish-design.mjs` — slice/component configs → design tool frames with trace-ID metadata

All sync scripts share one contract: **publishes are full overwrites with visible banners**; **pulls are probabilistic and human-gated**.

### 5.2 Coordination substrate (blackboard)
Keeps multiple composers and their agents from clobbering each other in real time. Seconds-to-minutes timescale.

Components (all ship at v1):
- Contribution board (claim/release across composers)
- File / doc-region / artifact locks with fencing tokens
- Append-only decision log (per-ADR files under `../architecture/decisions/` + datastore mirror)
- Session heartbeats and stale reaper
- Find_similar (semantic duplicate detection with eval harness)
- Territory / department contracts
- Agent-facing endpoint exposing 12 tools

The two substrates share the trace ID as a cross-reference but are independently deployable and serve different scenarios.

---

## 6. Repository organization

```
atelier/
├── README.md                       # Entry point, tier-routing, vocabulary
├── CLAUDE.md / AGENTS.md           # Agent charter (root — agents look here)
├── traceability.json               # Cross-cutting trace-ID registry
│
├── docs/                           # Audience-layered documentation (per ADR-031, ADR-032)
│   ├── methodology/                # Tier-3: adoptable way-of-working
│   │   ├── METHODOLOGY.md          # (this document)
│   │   └── adoption-guide.md
│   ├── strategic/                  # NORTH-STAR.md, STRATEGY.md, BUILD-SEQUENCE.md
│   ├── functional/                 # PRD.md, PRD-COMPANION.md, BRD.md, BRD-OPEN-QUESTIONS.md
│   ├── architecture/
│   │   ├── ARCHITECTURE.md         # Capability-level architecture
│   │   ├── decisions/              # Per-ADR files (per ADR-030)
│   │   ├── protocol/               # Tier-3: 12-tool open spec
│   │   ├── schema/                 # Territory contracts, datastore, config schema
│   │   ├── walks/                  # Scenario validations
│   │   └── diagrams/
│   ├── developer/                  # Tier-2: contributor + extender docs
│   │   └── extending/
│   ├── ops/                        # Tier-1: self-host runbooks (populates at M7)
│   ├── testing/                    # Eval harness, find_similar methodology (M5)
│   └── user/                       # Diátaxis: tutorials/guides/reference/explanation (v1)
│
├── prototype/                      # Canonical artifact web app
│   ├── src/
│   │   ├── app/                    # Routes: /, /strategy, /design, /slices, /atelier, /traceability
│   │   ├── components/
│   │   └── lib/
│   └── eval/
│       └── find_similar/              # Labeled eval set + runner
│
├── scripts/
│   ├── traceability/               # Registry generation + link injection
│   └── sync/                       # publish-*, mirror-*, reconcile, triage
│
├── research/                       # Analyst artifacts (research_artifact kind)
│   └── <trace-id>-<slug>.md
│
└── .atelier/                       # Ephemeral state (per §6.1)
    ├── config.yaml                 # project_id, datastore binding, identity, deploy targets
    ├── territories.yaml            # Territory declarations
    └── checkpoints/                # Pre-M2 session continuity (sunset at M2)
```

Per ADR-031/032: docs are layered by audience-question (toolkit-derived) and by tier (Specification / Reference Implementation / Reference Deployment). Empty layer READMEs cite the BUILD-SEQUENCE milestone where they fill in.

---

## 6.1 Document organization (canonical vs ephemeral, audience layers, drift discipline)

Atelier's doc set is informed by the [claude-docs-toolkit](https://github.com/) seven-layer model (Architecture / Developer / DevOps / Testing / Functional / Strategic / User), but Atelier compresses it because the project is its own first user — there is no separate "developer onboarding" track distinct from the strategic/architectural track at this stage.

### Canonical state (root of repo)

The files at the repo root are the **canonical state precedence list** declared in `CLAUDE.md`. They are append-edit-only via PR; never duplicated; never summarized in a parallel surface. The audience-question mapping:

| File | Toolkit layer analog | Audience | Question |
|---|---|---|---|
| `../strategic/NORTH-STAR.md` | Strategic | Architects, leadership | What is the complete destination? |
| `../strategic/STRATEGY.md` | Strategic | Architects, leadership | Why this shape, what's out of scope, what's the wedge? |
| `../functional/PRD.md` | Functional | PM, stakeholders | What must the product do? |
| `../functional/BRD.md` | Functional | PM, dev, QA | What are the stories with trace IDs? |
| `../architecture/ARCHITECTURE.md` | Architecture | Senior engineers | How is the system designed (capability-level)? |
| `METHODOLOGY.md` | Developer | Contributors | How does this repo work, what conventions apply? |
| `../functional/PRD-COMPANION.md` | Strategic / Architecture | Architects | What design decisions were made and why? |
| `../architecture/decisions/` | Architecture / decisions | All | What's the append-only ADR log? |
| `../functional/BRD-OPEN-QUESTIONS.md` | Strategic | Architects, PM | What's unresolved? |
| `../strategic/BUILD-SEQUENCE.md` | Strategic / roadmap | Implementers | What's the order of construction (not feature scope)? |
| `../strategic/risks.md` | Strategic / risk register | Architects, leadership | What load-bearing strategic bets does the build depend on, and what changes if they don't hold? |
| `traceability.json` | Cross-cutting registry | Tooling, all | Where is this trace ID referenced? |
| `README.md` | Cold-start entry | New readers | Where do I start? |
| `CLAUDE.md` / `AGENTS.md` | Agent charter | Agents | What rules govern my behavior in this repo? |

### Ephemeral state (`.atelier/`)

| Path | Lifetime | Purpose |
|---|---|---|
| `.atelier/config.yaml` | Project-lifetime | Project ID, datastore binding, deploy targets, identity provider, transcripts opt-in |
| `.atelier/territories.yaml` | Project-lifetime | Territory declarations |
| `.atelier/checkpoints/SESSION.md` | Pre-M2 only | Session-to-session continuity; **sunset when `get_context` (US-2.4) ships at M2** |

Checkpoints are **not canonical**. They exist because the protocol primitive that replaces them (`get_context`) does not yet exist. Once M2 lands, `.atelier/checkpoints/` is removed and continuity becomes a tool call.

### Drift discipline (the no-parallel-summary rule)

Per `claude-docs-toolkit`'s "continuous documentation" principle: **a summary doc that repeats canonical content is the predictable failure mode.** Drift is not hypothetical — on 2026-04-25 we found and removed three drifted summaries (an ADR count, a decision count, a route count) from the original `HANDOFF.md` that copied state out of `../architecture/decisions`, `../functional/PRD-COMPANION.md`, and `../functional/PRD.md`. Each was correct when written; each was wrong by the next session.

Rules:

1. **Refer; don't replicate.** If a doc needs to mention "we have N decisions," link to `../functional/PRD-COMPANION.md` rather than embedding the count.
2. **Author at the canonical site.** ADRs are added in `../architecture/decisions`, never in summary surfaces. Open questions live in `../functional/BRD-OPEN-QUESTIONS.md`, with `RESOLVED` markers updated in place — not echoed elsewhere.
3. **CI catches drift, eventually.** ADR-008's traceability validator already checks trace-ID drift. A future check will flag ADR/decision-count duplication outside the canonical sources.
4. **Audit on every milestone exit.** Each `../strategic/BUILD-SEQUENCE.md` milestone exit includes a drift sweep against the canonical-state precedence list.

### Spec vs. contingency separation

Spec docs (`NORTH-STAR`, `PRD`, `BRD`, `ARCHITECTURE`) describe **what gets built** in destination-first present tense per ADR-011. They do not hedge ("if X holds, then Y") — hedging implies the destination depends on a bet, which contradicts destination-first design.

Contingency thinking — "what changes if our load-bearing assumptions don't hold" — lives in `../strategic/risks.md`, not in spec docs. The spec stands regardless of how a bet resolves; what changes is the commercial path forward, not the feature scope.

If you find yourself writing "if it misses..." or "if the bar holds..." in a spec doc, move that thinking to `risks.md` and keep the spec sentence about what's being built.

### ADR hygiene (when *not* to write an ADR)

ADRs record **load-bearing choices with alternatives and ongoing consequences.** Cleanups, principle-application, and corrections of past confusion are *not* ADR-worthy — they're just work.

Test: **"If we'd done this right from the start, would the ADR survive?"**

- ADRs that pass: ADR-030 (per-ADR file split — real alternatives, real consequences), ADR-031 (three-tier consumer model — real alternatives, real consequences), ADR-027 (reference stack pick — real alternatives, real consequences).
- ADRs that would *fail* the test: "ADR for separating contingency from spec" (no alternatives — just applying separation-of-concerns), "ADR for moving doc X to layer Y" (no alternatives — just good organization), "ADR for fixing a stale reference" (no alternatives — just maintenance).

When in doubt, ask: *what's the alternative I'd be rejecting, and what's the consequence if I reverse the choice?* If both are weak, just do the work — don't ADR-document your own oversight.

### Pre-M2 / post-M2 continuity transition

| Capability | Pre-M2 (now) | Post-M2 |
|---|---|---|
| "What's the current state?" | Read `README.md §Status` + `../strategic/BUILD-SEQUENCE.md` + `git log` | Call `get_context` (US-2.4) |
| "Where did the last session leave off?" | `.atelier/checkpoints/SESSION.md` | Call `get_context` with last `session_id` |
| "What decisions affect my work?" | Read `../architecture/decisions` + `../functional/PRD-COMPANION.md` | `get_context` returns trace-ID-scoped recent decisions |
| "What's open?" | Read `../functional/BRD-OPEN-QUESTIONS.md` | `get_context` returns territory-scoped open contributions |

The pre-M2 path involves human reading. The post-M2 path is a single tool call. Both read from the same canonical state — the path is the only thing that changes.

### Provenance of this organization

- **claude-docs-toolkit** — seven-layer audience model, "continuous documentation" drift discipline, ADRs in their own subdirectory, Diátaxis for user docs (deferred to v1.x when end-user docs ship).
- **big-blueprint** — root-level `CLAUDE.md` + `prototype/` + `research/` + `docs/` template; no parallel session-handoff doc (because state lives in the artifacts).

---

## 7. Trace IDs

Single join key across all surfaces. Format:

- `US-<epic>.<story>` — a BRD story (e.g., `US-3.2`)
- `BRD:Epic-<N>` — a BRD epic (e.g., `BRD:Epic-6`)
- `D<N>` — a PRD-COMPANION decision in the OPEN/PROPOSED staging area (e.g., `D24`); once decided, decisions land as ADRs and the D# remains as a redirect pointer
- `NF-<N>` — a non-functional requirement
- `ADR-<N>` — an architecture decision record (one file per ADR under `../architecture/decisions/` per ADR-030)

Every BRD story, epic, decision, research artifact, slice prototype, design component, and Jira issue carries a trace ID. The traceability registry (`traceability.json`) indexes them bidirectionally.

Agents reading context via `get_context` receive trace-ID-scoped state. Agents writing decisions, proposals, or research artifacts must include a trace ID. Violations are caught by the pre-commit validator in `scripts/traceability/`.

---

## 8. In practice

### Discovery track — solo composer
1. Principal + IDE harness drafts or edits repo directly.
2. Commits include trace IDs.
3. `log_decision` writes a new per-ADR file under `../architecture/decisions/` on architectural choices (per ADR-030).
4. Publish-docs and publish-delivery fire on commit.

### Discovery track — multi-composer
1. Coordination substrate is active (sessions registered, blackboard live).
2. Principals claim contributions; locks prevent clobber; `find_similar` catches duplicate proposals before work starts.
3. Decision log captures rationale as work proceeds.
4. Outputs land in repo via normal PR flow; downstream publish unchanged.

### Discovery track — analyst (remote surface)
1. Analyst's web agent authenticates to the agent endpoint with their session token.
2. Analyst claims a `research_artifact` contribution via their web agent.
3. Agent authors research; content is written to `research/<trace-id>-<slug>.md` via `update`.
4. `log_decision` captures conclusions (written as a new per-ADR file under `../architecture/decisions/`).
5. `release` transitions the contribution to `review`.
6. Other composers see the research in their `/atelier` lens.

### Delivery track — multi-composer
1. Contribution in `claimed` state publishes to delivery tracker via `publish-delivery`.
2. Engineer branches `feat/US-X.Y-<slug>`, implements, opens PR.
3. `find_similar` runs on branch creation; warns if semantic overlap with prior work.
4. PR merge → trace ID → registry reporter reflects status on next nightly mirror.
5. Status transitions in the delivery tracker are **not** written back to the repo.

---

## 9. What this is not

- **Not a new agile framework.** Dual-track agile is Cagan/SVPG.
- **Not a replacement for Jira, Confluence, Linear, Figma, or Slack.** They remain best-in-class for what they do.
- **Not autonomous.** Every cross-boundary change is either a deterministic publish or a human-reviewed PR/merge.
- **Not a multi-tenant platform.** One team, one guild, many projects within that guild.

---

## 10. The load-bearing claims

Atelier's shape is old (dual-track agile + blackboard coordination). What's new operates at three layers:

**SDLC sync substrate** — lets agents participate in a human-designed SDLC without eroding the authority model.
1. Trace ID (`US-X.Y`) as the single join key across systems.
2. Publish-pull asymmetry — deterministic out, probabilistic in, human-gated merge.
3. Registry as the read-model — cheap to query, rebuilt from canonical state, mirrors delivery-tracker for freshness.

**Coordination substrate (blackboard)** — lets multiple composers + their agents share canonical state without collision.
1. Blackboard over hierarchy — no bottleneck composer, graceful degradation.
2. find_similar as a first-class primitive — duplication prevention before work starts, not after conflicting PRs.
3. Append-only decision log written repo-first — survives coordination-datastore downtime.
4. Fencing tokens on every lock — prevents Kleppmann-style data loss from GC pauses.

**The prototype as canonical artifact + dashboard** — the reframe that unifies the two substrates into one composer-facing surface. Same web app, different routes, different lenses.

**Slice-based authoring** — the workflow discipline that binds the substrates and the prototype together (per §2.1).
1. The slice is the unit of authoring — vertical cut through strategy + design + implementation, not horizontal layers.
2. The `/slices/[id]` route is the canonical viewing surface — slice-less work is invisible to the team.
3. Slices cross territory boundaries through published contracts only — deep-module discipline preserved at the workflow layer.

The four together are the Atelier thesis. A team could adopt any one without the others; all four combined are the reference implementation.

---

## 11. Review and audit process

A methodology that produces canonical artifacts also needs a discipline for keeping those artifacts honest over time. Spec docs drift; ADRs become stale; walks stop matching the code. The review and audit process is the discipline that catches drift at the cadence each surface needs.

This section is part of the **Atelier specification** (tier 3 per ADR-031). Teams adopting Atelier inherit it through the bundled config defaults (`.atelier/config.yaml: review`) and the validator scripts that ship with M1. Customization happens through the config; the discipline itself is the default.

### 11.1 Four review surfaces, four cadences

Different artifacts need different review rhythms. Conflating them produces either ceremony fatigue or silent rot.

| Surface | Cadence | Trigger | Owner | Output |
|---|---|---|---|---|
| **Per-PR review** | On every PR touching canonical state | PR open | Territory's `review_role` per `.atelier/territories.yaml` | Approval / requested changes; merge gated |
| **Milestone-entry data-model audit** | Before implementation begins on any schema-bearing milestone | Milestone status transition to In Flight | `architect` role | Audit report; ADRs + ARCH updates for HIGH findings; doc tightening for MEDIUM/LOW |
| **Milestone-exit drift sweep** | At each `BUILD-SEQUENCE` milestone exit | Milestone status transition to Done | `architect` role | Sweep report; PRs to fix any drift; sign-off on the milestone |
| **Quarterly destination check** | Every 90 days | Cron (per `.atelier/config.yaml: review.quarterly.cadence_days`) | `architect` + `pm` roles jointly | Re-affirmation or proposed pivot; updates to NORTH-STAR / BUILD-SEQUENCE if priorities shifted |
| **Spec-to-implementation gate** | On every M2+ code PR that implements a spec'd capability | PR open with code changes | Territory's `review_role` plus a generic implementation-checker | PR comment confirming or contesting the cited ARCH section match |

The five are independent. A PR can pass per-PR review while the milestone sweep is overdue; the milestone sweep can pass while the quarterly destination check identifies a strategic shift. The milestone-entry audit gates implementation on schema-bearing work; the milestone-exit sweep gates Done-marking. Decoupling cadences keeps any one surface from becoming a bottleneck for the others.

### 11.2 Per-PR review

Every change to canonical discovery content (per CLAUDE.md "How to propose changes") goes through PR review. The reviewer matrix defaults to `territories.review_role` for the affected territory; teams may extend in `.atelier/config.yaml: review.per_pr.territory_overrides`.

**Change classes and minimum reviewers:**

| Change class | Required reviewers | Notes |
|---|---|---|
| Discovery content (NORTH-STAR, PRD, BRD, ARCHITECTURE, METHODOLOGY) | 1 architect | Architect role gates all spec changes |
| New ADR | 1 architect + 1 territory `review_role` for any cross-cutting trace_ids | ADRs are append-only; rejection means the PR closes, not the ADR file edits |
| ADR reversal | 2 architects | Higher bar because reversal changes load-bearing decisions |
| BRD-OPEN-QUESTIONS entry add or status change | 1 architect | Hygiene check (per the spec-gap-vs-real-question test) happens here |
| `.atelier/territories.yaml` change | 1 architect | Per the territories.yaml header rule |
| `.atelier/config.yaml` change | 1 architect | Project-wide config affects all composers |
| Walk re-write (existing) | 1 architect | Walk content is canonical |
| New walk authoring | 1 architect | New walks must apply the latent-gaps discipline from the start |
| Reference implementation code (post-M2) | 1 territory `review_role` | Standard code review |
| Per-implementation citation (per section 11.5) | Same as above | Citation enforced by validator, not by reviewer |

**Quorum for cross-territory changes.** A PR touching multiple territories' canonical content needs approval from each affected territory's `review_role`. The PR template (added at M1 to `.github/PULL_REQUEST_TEMPLATE.md`) prompts the author to list affected territories.

**Reviewer assignment.** The validator (per scripts/README.md) computes the required reviewer set on PR open and posts a comment listing them. Missing reviewers block merge via branch protection.

### 11.3 Milestone-exit drift sweep

`BUILD-SEQUENCE.md` 6 already calls for this; section 11 operationalizes it.

At each milestone status transition to Done, the `atelier audit --milestone-exit` command runs (or its raw form pre-M7). The sweep covers:

1. **Cross-doc reference integrity** -- every section reference, ADR citation, contract name, walk fold-into reference resolves to a real target. Powered by the extended traceability validator (scripts/README.md "Extended cross-doc consistency").
2. **Walk re-run.** Each composer-surface walk (analyst, dev, designer; eventually pm and stakeholder) is re-walked against the current spec. Any step whose Status row no longer holds is flagged for fold-in.
3. **ADR re-evaluation triggers.** Each ADR with a `Re-evaluation triggers` section is checked: have any triggers fired? If so, an open question or a new ADR is filed.
4. **BRD-OPEN-QUESTIONS hygiene.** Each OPEN entry is examined under the spec-gap-vs-real-question test (METHODOLOGY 6.1). Entries that are spec gaps wearing question costumes get folded into spec; the BRD-OPEN-QUESTIONS list stays tight.
5. **Schema consistency.** Tables in ARCH 5.1 match the implemented schema (post-M2). Indexes in ARCH 5.2 exist. RLS policies match ARCH 5.3.
6. **Traceability coverage.** Every BRD story has at least one resolution path (ADR, contribution, or implementation reference). Coverage threshold defaults to 95 percent (configurable).
7. **Operational completeness.** For each spec'd capability with a user-facing surface (MCP client connectors, external integration adapters, CLI commands), a corresponding user-docs runbook exists under `docs/user/`. Caught by the `operational_completeness` check class per scripts/README.md. This check distinguishes "internally consistent spec" (the other 6 checks) from "actually-usable spec" -- a spec can be perfectly consistent and still leave real users with no setup path. The M0 exit audit on 2026-04-28 added this check after surfacing that the analyst-week-1 walk's Step 1 pre-condition ("composer has configured their MCP client") had no operational runbook.

**Output.** A sweep report (`docs/architecture/audits/milestone-<id>-exit.md`) listing checks, status, and any drift found. Each drift item becomes a PR. The architect role signs off on the milestone by approving the audit PR.

**No silent skip.** If any check fails or any drift goes unaddressed, the milestone is not marked Done. The audit report is the merge-gate artifact.

### 11.4 Quarterly destination check

Every 90 days (configurable), an architect + pm pair re-reads NORTH-STAR.md and asks: are we still building this? Sub-questions:

- Has the strategic context shifted (market, team, technology)?
- Have any in-flight milestones revealed that the destination needs adjustment?
- Are any ADRs whose `Re-evaluation triggers` have fired worth resolving as reversals?
- Does BUILD-SEQUENCE still reflect the current priorities?
- Have adjacent research surfaces (GitHub Next, Anthropic / OpenAI research blogs, comparable industry sources) published patterns that should inform Atelier's direction? File any substantive analysis as a strategy addendum under `docs/strategic/addenda/` per the pattern established by the 2026-04-28 multi-agent-coordination-landscape addendum.

**Output.** Either re-affirmation (a one-line entry under `docs/architecture/audits/quarterly-<YYYY-Q>.md`: "Confirmed direction; no changes recommended") or a proposed pivot (a longer entry plus a PR updating NORTH-STAR / BUILD-SEQUENCE / risks.md as appropriate). Adjacent-research scans land as strategy addenda regardless of whether they trigger updates to the canonical strategy.

**Why quarterly.** Long enough to accumulate signal; short enough to course-correct before too much work goes the wrong direction. Atelier doesn't dictate cadence; the default is 90 days but `review.quarterly.cadence_days` overrides.

### 11.5 Data-model + contract audit (milestone-entry)

A milestone that ships schema, contract surface, or otherwise-encoded design (any milestone where the implementation will create migrations, type definitions, or wire-format contracts) gets a data-model + contract audit BEFORE implementation begins, not after. Encoded schema is materially harder to refactor than spec'd schema; the audit pays for itself by catching semantic conflations and constraint gaps while they're still cheap to fix.

The audit applies five checks to every schema-bearing surface in the milestone's scope:

1. **Field semantic atomicity.** Each column, parameter, or contract field carries exactly one classification axis. Enums whose values mix two axes (e.g., a `kind` enum where some values describe output and others describe origin) are findings.
2. **Derivable vs stored.** Every denormalized field documents what it's derived from and why it's stored rather than computed. Echoes of other fields without a query-perf or constraint justification are findings.
3. **Enum coherence.** Every enum's values share one classification axis. "Other" / "misc" / catchall values that smuggle a second axis are findings.
4. **Constraint surface.** CHECK constraints, FK behaviors (especially ON DELETE semantics), NOT NULL rules, and transition rules are all specified. Invariants enforced only at the API boundary (with no DB-level backstop) are findings.
5. **Lifecycle invariants.** Per-field mutability, permitted state transitions, and FK durability across row deletions are specified. References that may dangle after a referenced row is reaped or deleted are findings.

**Output.** A new audit doc under `docs/architecture/audits/pre-<milestone-id>-data-model-audit.md` listing each finding with severity (HIGH / MEDIUM / LOW) and recommended fix. Each HIGH finding either lands as an ADR + ARCH update in the same commit as the audit, or files as a BRD-OPEN-QUESTIONS entry when the right answer needs a strategic call. MEDIUM and LOW findings land as ARCH documentation tightening + CHECK-constraint adds.

**Worked example.** `docs/architecture/audits/pre-M1-data-model-audit.md` (run 2026-04-28) is the template. It surfaced 18 findings against the v1 schema before M1 encoded it, landing as ADR-033 through ADR-037 (5 HIGH-severity schema corrections), BRD-OPEN-QUESTIONS section 20 (1 strategic call), and a documentation pass on remaining MEDIUM / LOW items.

**Cadence.** Every schema-bearing milestone gets one audit at entry: M1 (datastore tables), M1.5 (per-adapter contracts), M2 (endpoint surface + per-tool wire format), M5 (vector index schema productionization), M7 (upgrade-tooling schema). Pre-existing schema is re-audited if it changes substantially in scope.

**Why milestone-entry, not milestone-exit.** Milestone-exit (section 11.3) catches drift between spec and built artifact -- a different concern. Milestone-entry catches gaps in the spec itself before the built artifact encodes them. Both gates are needed; they're complementary.

**Why this section was added.** The `kind=proposal` semantic conflation surfaced via conversation in 2026-04-28 rather than from a prior audit -- exact evidence the audit pattern was missing. Codifying this section makes the pattern routine instead of incidental.

### 11.6 Spec-to-implementation gate (M2+)

Once M2 is in flight, every code PR that implements a spec'd capability cites the ARCH section it implements. The citation lives in the PR description in a structured block:

```
## Implements
- ARCH section 6.2.1 -- atomic create-and-claim semantics
- ARCH section 7.4.1 -- lock granularity and glob semantics
```

The validator parses this block on PR open and checks:
- Each cited section exists.
- The PR's diff touches code paths plausibly related to those sections (heuristic: the PR's changed-files list overlaps with paths the ARCH section mentions, OR the ARCH section's tagged trace_ids overlap with the PR's branch trace_ids).

A reviewer subsequently confirms the implementation matches the spec. Mismatches surface as either an implementation fix (most common) or a spec update (when implementation revealed the spec was wrong).

**Why this matters.** Without a citation gate, code drifts from spec silently. With it, every code change is a small audit point: implementer reads the spec, reviewer verifies the match. This is what closes the loop between design and code that pure documentation discipline cannot.

### 11.7 Walk re-walking cadence

The three composer-surface walks (analyst, dev, designer) are validation instruments, not historical records. Re-walking surfaces drift the way running tests surfaces regressions. Default cadence: re-walk each at every milestone-exit drift sweep (section 11.3 step 2) plus on demand when a substantial spec change lands in the walk's surface area. Schema-bearing changes (the kind that trigger section 11.5 audits) are a particularly common trigger.

Walks are also the right artifact for new composer scenarios. PM week-1, stakeholder week-1, multi-composer concurrent week-1 are all walks waiting to be authored when their scenarios become relevant. Authoring discipline: the latent-gaps approach from the start, not an after-the-fact sweep (the lesson from analyst-week-1.md section 7).

### 11.8 Post-milestone retrospective

At each milestone exit, the architect convenes a retrospective (sync or async). Three questions:

- What did the spec get right that implementation confirmed?
- What did the spec get wrong that implementation revealed?
- What gap in the methodology itself was surfaced?

Outputs feed back into:
- ADR additions or reversals for spec corrections
- New entries in this section (or this whole methodology) for methodology corrections
- BUILD-SEQUENCE updates for sequencing corrections

The retrospective notes land under `docs/architecture/audits/milestone-<id>-retrospective.md` and are searchable through find_similar from M5 onward.

### 11.9 How this is baked into the Atelier template

Per the three-tier consumer model (ADR-031), this process lives in three places:

**Tier 1 (Reference Deployment)** -- `atelier init` scaffolds:
- `.atelier/config.yaml: review` section with the defaults from this methodology
- `.github/workflows/atelier-audit.yml` running the validator on every PR
- `.github/workflows/atelier-quarterly.yml` running the destination check cron
- `.github/PULL_REQUEST_TEMPLATE.md` with the affected-territories prompt and the spec-citation block (post-M2)
- `docs/architecture/audits/` directory with a placeholder README

**Tier 2 (Reference Implementation)** -- the `scripts/traceability/` validator implements the cross-doc checks specified in scripts/README.md "Extended cross-doc consistency"; `atelier audit` and `atelier review` CLI commands wrap the validator into operational form (raw at M1, polished at M7 per BUILD-SEQUENCE Epic 1 sequencing).

**Tier 3 (Specification)** -- this section (METHODOLOGY 11). Teams adopting just the methodology without the reference impl can implement equivalent gates against their own tooling.

A team that runs `atelier init` gets the discipline by default. A team that wants to customize tunes the config. A team that opts out by removing the workflow files accepts the consequences (faster initial pace, more drift over time). Atelier doesn't enforce -- it makes the disciplined path the easy path.
