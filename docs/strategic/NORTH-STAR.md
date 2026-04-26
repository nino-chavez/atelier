# Atelier — North Star Design

**Status:** v1.0 locked
**Owner:** Nino Chavez
**Last updated:** 2026-04-24
**Related:** `STRATEGY.md` (why), `../functional/PRD.md` (what), `../functional/BRD.md` (stories), `../architecture/ARCHITECTURE.md` (how), `../functional/PRD-COMPANION.md` (decisions), `../architecture/decisions` (log)

---

## The one-line destination

**A self-hostable OSS project template where mixed teams of humans + agents concurrently author a single canonical artifact (the prototype) from any surface, without drift.**

Build order and design scope are separate. What follows is the complete design scope. Every capability below is present from v1. No "Phase 2," no "coming soon." Design-for-full is the explicit counter-move to feature-at-a-time drift.

---

## 1. Project identity

Every Atelier project has exactly:

- One `project_id` (stable UUID, persisted in `.atelier/config.yaml`)
- One **versioned file store** — canonical state for everything file-shaped (repo)
- One **coordination datastore** — blackboard for coordination state (relational + pub/sub + identity + vector index)
- One **deployed prototype web app** — the artifact + the dashboard
- One **agent-facing endpoint** — implements an agent interop protocol (e.g. MCP)
- N linked external tools (delivery tracker, published-doc system, design tool, messaging)
- N composers with M sessions

No project is multi-tenant. No composer spans projects implicitly. Invites are explicit. All infrastructure is self-hosted by the team.

---

## 2. Composer and session model

**Composer** = a human principal.
**Session** = composer × project × time × surface.

| Surface | Surface (examples of) | Agent client (examples of) |
|---|---|---|
| `ide` | Editor / terminal | In-editor agent clients |
| `web` | Browser | Browser-based agent clients with remote protocol support |
| `terminal` | Bare shell | Any protocol-capable CLI |
| `passive` | Browser (observer) | None; humans-only view |

Every session authenticates via a signed token issued by the coordination datastore's identity service. Every agent-endpoint call validates the token. Every write carries the session ID. Every lock carries a monotonic fencing token.

---

## 3. Territory and contribution model

Projects declare **territories** in `.atelier/territories.yaml`. A territory is:

```yaml
- name: strategy
  owner_role: analyst
  scope_kind: doc_region
  scope_pattern: "BRD.md#*, research/**/*"
  contracts_published: [personas, opportunity-statements, success-metrics]

- name: auth
  owner_role: dev
  scope_kind: files
  scope_pattern: "src/auth/**"
  contracts_published: [AuthService, SessionToken]
  contracts_consumed: [PersonaModel]
```

`scope_kind` is one of: `files`, `doc_region`, `research_artifact`, `design_component`, `slice_config`. Generalized from day one — no "files first, extend later."

**Contribution** is the atomic unit. It subsumes tasks, decisions, PRs, drafts, and proposals under one schema:

```
contributions {
  id, project_id, author_session_id, trace_id,
  territory, artifact_scope,
  state: "open" | "claimed" | "in_progress" | "review" | "merged" | "rejected" | "blocked",
  kind: "implementation" | "decision" | "research" | "design" | "proposal",
  content_ref (path to file/region/artifact),
  fencing_token,
  created_at, updated_at
}
```

A task is a contribution in `open`. A decision is a `kind:decision` contribution that writes a new ADR file under `docs/architecture/decisions/` on merge (per ADR-030). A triaged external comment is a `kind:proposal` contribution. One state machine governs all.

---

## 4. Canonical artifact — the prototype as both product and dashboard

The prototype web app has six routes, all present from v1:

| Route | Purpose |
|---|---|
| `/` | Project home — slices index, demo reel, project status at a glance |
| `/strategy` | Strategy panels (BRD/PRD rendered, opportunity statements, personas, success metrics) |
| `/design` | Design views (component library, flows, linked external design frames) |
| `/slices/[id]` | Individual slice prototype + its three panels + its `/atelier` mini-panel |
| `/atelier` | Live coordination view — role-aware lenses over sessions/contributions/decisions/locks |
| `/traceability` | Bidirectional link registry |

`/atelier` renders role-aware lenses over shared state:

- **Analyst lens**: strategy contributions, research artifacts, proposals needing review, decisions affecting strategy
- **Dev lens**: contributions in territory, active locks, recent impl decisions, contract changes from other territories
- **PM lens**: phase progress, priority flow, story states, delivery mirror
- **Designer lens**: design components in review, visual contracts, feedback queue from design tool
- **Stakeholder lens**: read-only, public decisions + demo reel

Same canonical state, different first-view cuts. Same freshness contract. Same server-side filter/sort. Same scale budget (paginate at 50, virtualize at 500).

**Review routing.** Contributions transitioning to `state=review` surface in the lens whose role matches the contribution's territory `review_role` (ADR-025). For example, a research artifact in the `strategy-research` territory (`review_role=pm`) appears in the PM lens; a protocol contribution (`review_role=dev`) appears in the dev lens for peer review.

---

## 5. Agent-facing endpoint — the protocol surface

Twelve tools, grouped by concern. All present on day one. Exposed via whatever agent interop protocol the ecosystem consolidates on (MCP is the likely reference).

| Category | Tool | Purpose |
|---|---|---|
| Session | `register` | Register composer × project × surface |
| Session | `heartbeat` | Keep session alive |
| Session | `deregister` | End session, release held resources |
| Context | `get_context` | Charter + recent decisions + territory state + traceability registry |
| Context | `find_similar` | Semantic search: is this already done or in flight? |
| Contribution | `claim` | Claim an open contribution. Atomic create-and-claim when called with `contribution_id=null` + `kind`, `trace_ids`, `territory_id`, optional `content_stub` (ADR-022) |
| Contribution | `update` | Transition contribution state |
| Contribution | `release` | Release a claimed contribution |
| Lock | `acquire_lock` | Lock artifact_scope with fencing token |
| Lock | `release_lock` | Release lock |
| Decision | `log_decision` | Write to decisions.md + broadcast |
| Contract | `publish_contract` / `get_contracts` | Territory interface declarations |

**Write path for non-code artifacts** (the analyst case, first-class):

- Web agent calls `claim(null, kind="research", trace_ids, territory_id)` to atomic-create-and-claim a `research_artifact` contribution (ADR-022)
- Agent authors research; content lands in `research/US-X.Y-<slug>.md` via `update`. For remote-surface composers, the endpoint commits on their behalf per ADR-023 / ARCH §7.8
- Optionally, the agent-session transcript is captured as a sidecar (`research/US-X.Y-<slug>.transcript.jsonl`) when `transcripts.capture=true` per ADR-024
- `log_decision` captures the research conclusion (with `trace_ids` array per ADR-021), written to `decisions.md`
- `release` transitions the contribution to `review`; the lens that surfaces it is determined by `territory.review_role` (ADR-025)
- Other composers are notified via pub/sub broadcast

Same flow, different artifact kind. The protocol is surface-agnostic.

---

## 6. Decision durability

Decisions are written to `decisions.md` in the versioned file store first, mirrored to the coordination datastore for query, indexed in the vector index for find_similar, broadcast via pub/sub. All four happen on every `log_decision` call.

If the coordination datastore is down, `decisions.md` still gets committed. If pub/sub is down, mirror still runs. If vector index is down, keyword-fallback search for find_similar. Graceful degradation is real — designed in, not aspirational.

`decisions.md` structure is deterministic (one append per decision, YAML frontmatter with trace_id + category + session + timestamp). A CI check validates that every datastore decision has a corresponding commit and vice versa.

---

## 7. Find_similar — the irreducible technical bet

**Not deferred. Ships at v1.**

- Vector-index-backed semantic search over decisions + merged contributions + BRD/PRD sections + research artifacts
- Embedding model committed up front, swappable via config
- Eval harness ships with the template — labeled eval set in `atelier/eval/find_similar/*.yaml`
- `atelier eval find_similar` runs precision/recall against the eval set
- CI gate: PRs that touch find_similar logic must maintain ≥75% precision at ≥60% recall
- Runtime: composers can accept/reject matches, feedback loops back to the eval set
- Triggered automatically on: contribution creation, research artifact upload, BRD section drafting
- Degrades to keyword search if embeddings unavailable — explicit banner in UI, not silent

This is the load-bearing capability. Designed, evaluated, and monitored from v1. If precision drops below target, the system reports it honestly — it doesn't hide.

---

## 8. Sync substrate (all five, concurrent)

All five substrate scripts ship together:

| Script | Direction | Trigger | Contract |
|---|---|---|---|
| `publish-docs` | repo → published-doc system | On BRD/PRD commit | Full page overwrite + banner |
| `publish-delivery` | repo → delivery tracker | On contribution state transition to `claimed` or later | Create + update (status, assignee, sprint) |
| `mirror-delivery` | delivery tracker → registry | Scheduled | Read-only mirror of delivery fields |
| `reconcile` | bidirectional drift detector | Scheduled | Reports only; never auto-writes |
| `triage` | external comments → repo | Webhook | Classifier → drafter → proposal contribution (never auto-merge) |

Same contract for all: **publishes are full overwrites with visible banners; pulls are probabilistic and human-gated**. Comments from published-docs, delivery, design systems all flow through `triage` and land as `kind:proposal` contributions, awaiting merge.

---

## 9. External system integration (all from v1)

| System class | Role | How we integrate |
|---|---|---|
| Versioned file store | Canonical code + docs | Git protocol + webhooks for triage |
| Delivery tracker | Delivery-field canonical store | REST/API for publish + mirror |
| Published-doc system | Public BRD/PRD projection | REST/API for publish; webhook for comment triage |
| Visual design tool | Design feedback surface | API for read; webhook for comment triage |
| Messaging system | Notifications only (no authoring) | Webhooks for contribution state, decisions, find_similar hits |
| IDE agent client | In-editor agent | Protocol client connects to project's agent endpoint |
| Web agent client | Browser agent | Remote protocol connector connects to same endpoint |

Every system remains canonical for its thing. Atelier is the spine that makes them cohere around one project.

---

## 10. CLI — the complete surface

```
atelier init <name>               # scaffold repo + .atelier + prototype + agent endpoint
atelier datastore init            # provision coordination datastore
atelier deploy                    # ship prototype + agent endpoint
atelier invite <email> --role <r> # create composer invite + scoped token
atelier territory add <name>      # declare new territory
atelier sync <target>             # run one sync script
atelier reconcile                 # drift report
atelier eval find_similar            # run eval set, report precision/recall
atelier doctor                    # diagnose health: sessions, locks, drift, find_similar status
```

All present at v1.

---

## 11. Observability (designed in)

Every action emits telemetry to a dedicated observability table. An admin-gated sub-route shows:

- Session heartbeat health (active, idle, stale, reaped)
- Contribution state transition audit log
- Lock acquisition + release + fencing token ledger
- Decision find_similar match rate
- Triage classifier accuracy (human accept/reject rate on proposals)
- Sync lag per external system
- Vector-index health + query p95

This is how you know the system is working, not just that it isn't throwing errors.

---

## 12. Security model (day one)

| Concern | Mitigation |
|---|---|
| Agent impersonation | Signed session tokens, validated on every endpoint call |
| State tampering | Row-level authorization scoped to project membership + session ownership |
| Decision revision | Append-only contract at the datastore level; reversals are new decisions referencing old |
| Lock hijacking | Fencing tokens on every locked write; monotonic, per-project |
| Stale sessions | Reaper job releases locks + contributions on heartbeat timeout |
| Triage injection | External comments sandboxed; drafter output requires human merge |
| Credential leakage | Datastore-admin credentials server-side only; per-composer tokens for clients |

---

## 13. Capability requirements (not vendor choices)

The system needs these capabilities from whatever stack implements it:

| Capability | What it must provide |
|---|---|
| **Versioned file store** | Commit history, branches, webhooks, OAuth |
| **Relational datastore** | ACID writes, row-level authorization, structured schema |
| **Pub/sub broadcast** | Real-time push of row changes to connected clients |
| **Identity service** | Signed tokens, per-user scoping, role claims |
| **Vector index** | Nearest-neighbor search on embeddings, refreshable |
| **Serverless runtime** | Stateless HTTP function execution, environment config |
| **Static/edge hosting** | Deploy the prototype web app with server-side rendering |
| **Agent interop protocol** | Standardized tool-call surface usable by IDE + web agent clients |
| **Cron / scheduled jobs** | Session reaping, mirror sync, reconcile |
| **Observability sink** | Append telemetry events, query them |

Any stack that provides these, all behind a single self-hostable deploy command, is a valid implementation. Vendor choice is an implementation decision, not a design decision.

---

## 14. Scope boundaries — what's OUT so we don't drift IN

- **Not a SaaS.** Teams self-host.
- **Not an agent framework.** Agent clients stay in their lanes.
- **Not a workflow engine.** External workflow tools stay in their lanes.
- **Not a delivery tracker.** External delivery systems remain canonical.
- **Not a chat app.** External agent chat surfaces remain canonical for conversations.
- **Not a code editor.** External editors remain canonical for editing.
- **Not a design tool.** External design tools remain canonical for visual work.
- **Not a doc editor.** External doc systems remain canonical for published long-form docs.
- **Not a wiki.** Repo markdown is the knowledge base.
- **Not a messaging platform.** External messaging remains canonical.

Atelier is the **spine that connects all of the above around one project**. Not a replacement for any of them.

---

## 15. Vocabulary — locked

| Term | Meaning |
|---|---|
| **Atelier** | The product. The shared studio. |
| **Hive** | An Atelier deployment hosting one or more projects (one team's instance — datastore + endpoint + deploys). Per ADR-015. |
| **Project** | One repo + one datastore + one deployed prototype + linked tools. A hive contains N projects. |
| **Composer** | The role-bearing participant — a human (or their authorized agent) authoring canonical state in coordination contexts. |
| **Principal** | The security-identity layer — the signed identity a composer authenticates as. A composer participates as a principal. |
| **Session** | A composer's active connection to a project from a specific surface. |
| **Surface** | Where a composer interacts from: `ide`, `web`, `terminal`, `passive`. |
| **Territory** | Named domain with owner, scope kind, scope pattern, published contracts. |
| **Contribution** | Atomic unit of work; one schema covers tasks/decisions/proposals/PRs. |
| **`scope_kind`** | One of: `files`, `doc_region`, `research_artifact`, `design_component`, `slice_config` — the five kinds of artifact a contribution or lock can target (per ADR-003). |
| **Slice** | A vertical product feature with strategy, design, and current-state views; one unit of dual-track-agile authoring (the `/slices/[id]` route). |
| **Contract** | Typed interface published by one territory for consumption by others. |
| **Blackboard** | Coordination state (sessions, contributions, decisions, locks, contracts). |
| **Charter** | Repo-resident files governing agent behavior: `CLAUDE.md`, `AGENTS.md`, `.atelier/*`. The canonical decision log at `docs/architecture/decisions/` (per ADR-030) is read by agents as context but is not itself part of the charter. |
| **Prototype** | The web app that is both the canonical artifact and the dashboard. |
| **Trace ID** | `US-X.Y`, `BRD:Epic-N`, etc. — join key across all surfaces. |
| **`find_similar`** | The semantic-search primitive: "is this already done or in flight?" Operates over decisions, contributions, BRD/PRD sections, research artifacts. |
| **Triage** | Classifier + drafter pipeline that turns external comments into proposal contributions. |

---

## 16. The find_similar threshold

Find_similar ships with an eval harness and CI gate enforcing ≥75% precision at ≥60% recall on a labeled eval set drawn from this repo's own decisions corpus (per ADR-006).

The threshold is part of the spec. Whether the threshold can actually be hit by current embedding models is a strategic bet tracked separately in [`risks.md`](./risks.md). The spec stands regardless of how the bet resolves.

---

## 17. Why this is the destination

The methodological counter-move to feature-at-a-time drift is destination-first design. Atelier exists because feature-at-a-time building — even of its own components — produces incoherent systems. The whole is specified up front so that every implementation decision has a target to measure against.

If this doc and any subordinate doc disagree, `NORTH-STAR.md` wins and the subordinate doc needs an update.
