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
