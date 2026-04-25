# Methodology

**Status:** v1.0
**Owner:** Nino Chavez
**Last updated:** 2026-04-24
**Related:** `../strategic/NORTH-STAR.md`, `../strategic/STRATEGY.md`, inherits from `big-blueprint` methodology

---

## What this doc is

How this repository itself is organized. Atelier is a self-referential project: it ships the methodology it embodies. This doc declares the conventions this repo follows, which are the same conventions any repo scaffolded by `atelier init` inherits.

> Atelier applies its own methodology to itself. If the conventions here do not work for building Atelier, they don't work for anything.

---

## 1. Inherited foundation — dual-track agile

Atelier inherits the dual-track agile pattern (Marty Cagan / SVPG) as implemented in bc-subscriptions, with one critical reframe: the **prototype is the canonical artifact**, not just a discovery aid.

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

This is the reframe that distinguishes Atelier from bc-subscriptions' approach.

In bc-subscriptions, the prototype was a high-fidelity illustration of the BRD — valuable for stakeholder alignment but not itself canonical. Canonical state lived in the markdown (BRD/PRD/ARCHITECTURE).

In Atelier, **the prototype is both the product artifact and the coordination dashboard.** It renders live from repo + datastore state. Composers interact with project state *through* the prototype. The `/atelier` route is the shared workspace. The `/strategy`, `/design`, `/slices/[id]`, and `/traceability` routes are how every composer sees the same canonical state through their role-specific lens.

Figma is a feedback surface, not a design source of truth. Designs live in the prototype's components. Figma receives projections of those components; comments on those projections flow back through triage.

---

## 3. Actor model — six classes

Extended from bc-subscriptions' five-class model to add the remote-principal case required for mixed-locus teams.

| Class | Locus | Scope | Attribution | Authority |
|---|---|---|---|---|
| **Principal + IDE harness** | Local IDE | Repo + datastore via `ide` session | Human identity | Full — harness inherits principal |
| **Principal + web harness** | Browser + remote protocol | Datastore + repo via proposals | Human identity | Full for their territory; contributes to repo via PRs |
| **Hive collaboration** | Shared coordination layer | Hive-scoped drafts | Per-principal identities | Proposes; repo entry requires PR |
| **Pipeline agent** | CI / scheduled / webhook | External systems, registry mirror | Bot account | Deterministic contract; never authors canonical state |
| **Triage agent** | Server / function | Proposal contributions | Bot account (cites origin) | Proposes; human merge required |
| **App agent** | Product runtime | Product data | Per product's rules | Not SDLC — uses trace IDs for observability only |

**Principle:** authority follows locus + scope, not role. A principal's harness is trusted because the principal is in the loop. A pipeline agent is trusted because its contract is narrow. A triage agent is never trusted to merge because its input is unsanitized external comments. A web-principal is trusted for their territory because they authenticate to the datastore with per-composer tokens.

---

## 4. Authority model

Authority is assigned per field, per artifact, not per actor. The principle: authority follows where the content naturally changes.

- **Discovery fields** (title, AC, phase, priority, effort, persona, dependencies, strategy, research) → **repo-authoritative**. Changed only via PR or `log_decision`.
- **Delivery fields** (status, sprint, points, assignee) → **delivery-tracker-authoritative**. Mirrored into the registry for reporting; never back into canonical BRD.md or PRD.md.
- **Design** → **repo-authoritative** (prototype components). Design-tool projections receive comments that flow through triage.
- **Comments** (anywhere — published-doc system, delivery tracker, design tool) → **source-authoritative, triaged to proposals**. Never merged directly into canonical state.
- **Decisions** → **repo-authoritative** (`decisions.md` is the canonical log; datastore mirror is a read-model).
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
- Append-only decision log (`decisions.md` + datastore mirror)
- Session heartbeats and stale reaper
- Fit_check (semantic duplicate detection with eval harness)
- Territory / department contracts
- Agent-facing endpoint exposing 12 tools

The two substrates share the trace ID as a cross-reference but are independently deployable and serve different scenarios.

---

## 6. Repository organization

```
atelier/
├── README.md                       # Entry point, tier-routing, vocabulary
├── CLAUDE.md / AGENTS.md           # Agent constitution (root — agents look here)
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
│   ├── testing/                    # Eval harness, fit_check methodology (M5)
│   └── user/                       # Diátaxis: tutorials/guides/reference/explanation (v1)
│
├── prototype/                      # Canonical artifact web app
│   ├── src/
│   │   ├── app/                    # Routes: /, /strategy, /design, /slices, /atelier, /traceability
│   │   ├── components/
│   │   └── lib/
│   └── eval/
│       └── fit_check/              # Labeled eval set + runner
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
| `../architecture/decisions` | Architecture / decisions | All | What's the append-only ADR log? |
| `../functional/BRD-OPEN-QUESTIONS.md` | Strategic | Architects, PM | What's unresolved? |
| `../strategic/BUILD-SEQUENCE.md` | Strategic / roadmap | Implementers | What's the order of construction (not feature scope)? |
| `traceability.json` | Cross-cutting registry | Tooling, all | Where is this trace ID referenced? |
| `README.md` | Cold-start entry | New readers | Where do I start? |
| `CLAUDE.md` / `AGENTS.md` | Agent constitution | Agents | What rules govern my behavior in this repo? |

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

### Pre-M2 / post-M2 continuity transition

| Capability | Pre-M2 (now) | Post-M2 |
|---|---|---|
| "What's the current state?" | Read `README.md §Status` + `../strategic/BUILD-SEQUENCE.md` + `git log` | Call `get_context` (US-2.4) |
| "Where did the last session leave off?" | `.atelier/checkpoints/SESSION.md` | Call `get_context` with last `session_id` |
| "What decisions affect my work?" | Read `../architecture/decisions` + `../functional/PRD-COMPANION.md` | `get_context` returns trace-ID-scoped recent decisions |
| "What's open?" | Read `../functional/BRD-OPEN-QUESTIONS.md` | `get_context` returns territory-scoped open contributions |

The pre-M2 path involves human reading. The post-M2 path is a single tool call. Both read from the same canonical state — the path is the only thing that changes.

### Provenance of this organization

- **claude-docs-toolkit** (`/Users/nino/Workspace/dev/tools/claude-docs-toolkit`, since archived) — seven-layer audience model, "continuous documentation" drift discipline, ADRs in their own subdirectory, Diátaxis for user docs (deferred to v1.x when end-user docs ship).
- **big-blueprint** (`/Users/nino/Workspace/dev/wip/big-blueprint`) — root-level `CLAUDE.md` + `prototype/` + `research/` + `docs/` template; no parallel session-handoff doc (because state lives in the artifacts).
- **hackathon-hive** (`/Users/nino/Workspace/dev/tools/hackathon-hive`) — session continuity as a protocol primitive (`hive_checkpoint` / `hive_get_context`), not a markdown surface. This is the model Atelier inherits at M2 via the 12-tool endpoint.

---

## 7. Trace IDs

Single join key across all surfaces. Format:

- `US-<epic>.<story>` — a BRD story (e.g., `US-3.2`)
- `BRD:Epic-<N>` — a BRD epic (e.g., `BRD:Epic-6`)
- `D<N>` — a PRD-COMPANION decision (e.g., `D12`)
- `NF-<N>` — a non-functional requirement
- `ADR-<N>` — an architecture decision record (in `decisions.md`)

Every BRD story, epic, decision, research artifact, slice prototype, design component, and Jira issue carries a trace ID. The traceability registry (`traceability.json`) indexes them bidirectionally.

Agents reading context via `get_context` receive trace-ID-scoped state. Agents writing decisions, proposals, or research artifacts must include a trace ID. Violations are caught by the pre-commit validator in `scripts/traceability/`.

---

## 8. In practice

### Discovery track — solo composer
1. Principal + IDE harness drafts or edits repo directly.
2. Commits include trace IDs.
3. `log_decision` writes to `decisions.md` on architectural choices.
4. Publish-docs and publish-delivery fire on commit.

### Discovery track — multi-composer
1. Coordination substrate is active (sessions registered, blackboard live).
2. Principals claim contributions; locks prevent clobber; `fit_check` catches duplicate proposals before work starts.
3. Decision log captures rationale as work proceeds.
4. Outputs land in repo via normal PR flow; downstream publish unchanged.

### Discovery track — analyst (remote locus)
1. Analyst's web agent authenticates to the agent endpoint with their session token.
2. Analyst claims a `research_artifact` contribution via their web agent.
3. Agent authors research; content is written to `research/<trace-id>-<slug>.md` via `update`.
4. `log_decision` captures conclusions (written to `decisions.md`).
5. `release` transitions the contribution to `review`.
6. Other composers see the research in their `/atelier` lens.

### Delivery track — multi-composer
1. Contribution in `claimed` state publishes to delivery tracker via `publish-delivery`.
2. Engineer branches `feat/US-X.Y-<slug>`, implements, opens PR.
3. `fit_check` runs on branch creation; warns if semantic overlap with prior work.
4. PR merge → trace ID → registry reporter reflects status on next nightly mirror.
5. Status transitions in the delivery tracker are **not** written back to the repo.

---

## 9. What this is not

- **Not a new agile framework.** Dual-track agile is Cagan/SVPG.
- **Not a replacement for Jira, Confluence, Linear, Figma, or Slack.** They remain best-in-class for what they do.
- **Not autonomous.** Every cross-boundary change is either a deterministic publish or a human-reviewed PR/merge.
- **Not a multi-tenant platform.** One team, one hive, many projects within that hive.

---

## 10. The load-bearing claims

Atelier's shape is old (dual-track agile + blackboard coordination). What's new operates at two layers:

**SDLC sync substrate** — lets agents participate in a human-designed SDLC without eroding the authority model.
1. Trace ID (`US-X.Y`) as the single join key across systems.
2. Publish-pull asymmetry — deterministic out, probabilistic in, human-gated merge.
3. Registry as the read-model — cheap to query, rebuilt from canonical state, mirrors delivery-tracker for freshness.

**Coordination substrate (blackboard)** — lets multiple composers + their agents share canonical state without collision.
1. Blackboard over hierarchy — no bottleneck composer, graceful degradation.
2. Fit-check as a first-class primitive — duplication prevention before work starts, not after conflicting PRs.
3. Append-only decision log written repo-first — survives coordination-datastore downtime.
4. Fencing tokens on every lock — prevents Kleppmann-style data loss from GC pauses.

**The prototype as canonical artifact + dashboard** — the reframe that unifies the two substrates into one composer-facing surface. Same web app, different routes, different lenses.

The three together are the Atelier thesis. A team could adopt any one without the others; all three combined are the reference implementation.
