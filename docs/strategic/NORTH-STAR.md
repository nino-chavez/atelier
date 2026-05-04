# Atelier — North Star Design

**Status:** v1.0 locked
**Owner:** Nino Chavez
**Last updated:** 2026-04-28
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

All infrastructure is self-hosted by the team — one guild = one team's deployment, never SaaS-style shared infra across unrelated teams. Within a guild, multiple projects coexist with strict `project_id` isolation: no project's contributions, locks, contracts, or trace IDs leak into another. A composer can hold membership in multiple projects within the same guild, but every membership is explicit (granted per-project via invite) — there is no implicit cross-project access. A composer authenticates as one principal against the guild's identity service and then carries separate sessions per project (`Session = composer × project × time × surface` per §2).

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

A task is a contribution in `open`. Decisions are recorded via `log_decision` directly to the `decisions` table and a new ADR file under `docs/architecture/decisions/` (per ADR-030 and ADR-033 -- decisions don't flow through the contributions table). A triaged external comment becomes a contribution carrying the discipline of the proposed change (implementation/research/design) with `requires_owner_approval=true` per ADR-033; the merge gate per ARCH 7.5 reads that flag. One state machine governs all contributions.

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
| Context | `find_similar` | Semantic search aid (advisory): "have we discussed this kind of thing before?" across decisions, contributions, BRD/PRD sections, and research artifacts. Per ADR-006/042/043: hybrid retrieval (vector + BM25 RRF), advisory tier at v1, blocking tier opt-in at v1.x via cross-encoder reranker. NOT a pre-claim file-overlap surface — that's `get_context(scope_files)` per ADR-045. |
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

## 7. Find_similar — auxiliary advisory search aid

**Ships at v1 as an advisory-tier semantic search aid (per ADR-006 + ADR-042 + ADR-043 + ADR-047).** find_similar is one capability within the coordination substrate; it answers "have we discussed this before?" across decisions, contributions, BRD/PRD sections, and research artifacts. It is not the load-bearing wedge — the substrate as a whole (territories + contracts + atomic claim + fenced locks + broadcast + repo-canonical decisions + per-project committer + the methodology) is. find_similar's measured precision/recall on Atelier's own corpus (P=0.672, R=0.626) clears advisory tier; blocking-tier (hands-off duplicate prevention) is v1.x opt-in gated on the cross-encoder reranker per BRD-OPEN-QUESTIONS §27.

What ships at v1:

- Hybrid retrieval (vector + BM25 via Reciprocal Rank Fusion per ADR-042) over decisions + merged contributions + BRD/PRD sections + research artifacts
- OpenAI-compatible embedding adapter (per ADR-041), default OpenAI text-embedding-3-small (1536-dim), swappable via `find_similar.embeddings.base_url` + `api_key_env` to vLLM / Ollama / LocalAI / self-hosted Voyage without adapter code change
- Eval harness in `atelier/eval/find_similar/`; `atelier eval find_similar` runs precision/recall against the seed corpus
- **Advisory tier** (P >= 0.60 AND R >= 0.60 per ADR-043; cleared by M5 measurement) is the v1 default — warnings surface in claim flows, PR comments, and `/atelier` panels but do not block. The CI eval gate is informational at v1 (per ADR-045): runs, produces `last-run.json` + log output, but does not fail the workflow. Adopters wanting strict gating set `find_similar.ci_gate.enabled: true` + remove `continue-on-error` in the audit workflow.
- **Blocking tier** (P >= 0.85, R >= 0.70) is v1.x opt-in gated on the cross-encoder reranker per BRD-OPEN-QUESTIONS section 27
- Composers accept/reject matches; feedback informs eval set evolution
- Triggered automatically on contribution creation (claim) + log_decision; explicitly callable as a search tool from `/atelier`
- Degrades to keyword search if embeddings unavailable — explicit `degraded: true` flag in the response (per US-6.5)

What find_similar does NOT do at v1: pre-claim file-overlap awareness. That capability lives on `get_context(scope_files)` per ADR-045 — different question (file-overlap, not semantic similarity), different implementation (SQL array intersection, not vector kNN), different cost (single SQL query, no external API). The two are siblings, not alternatives.

If precision/recall drops below target, the system reports it honestly via the eval artifact — it doesn't hide. The threshold itself is calibrated to what's empirically achievable at v1 quality (per ADR-043), not to an aspirational number that the implementation cannot meet.

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

Same contract for all: **publishes are full overwrites with visible banners; pulls are probabilistic and human-gated**. Comments from published-docs, delivery, design systems all flow through `triage` and land as contributions tagged with the discipline of the proposed change and `requires_owner_approval=true` (per ADR-033), awaiting merge.

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
# Lifecycle (Epic 1 -- raw form ships across M0/M2/M3/M6, polished at M7 per BUILD-SEQUENCE 9)
atelier init <name>                  # scaffold repo + .atelier + prototype + agent endpoint
atelier datastore init               # provision coordination datastore
atelier deploy                       # ship prototype + agent endpoint
atelier invite <email> --role <r>    # create composer invite + scoped token
atelier territory add <name>         # declare new territory
atelier doctor                       # diagnose health: sessions, locks, drift, find_similar status
atelier upgrade                      # apply template upgrades to existing project per ARCH 9.7

# Sync substrate (Epic 9 -- ships at M1 alongside the underlying scripts)
atelier sync <target>                # run one sync script (publish-docs, publish-delivery, mirror-delivery, reconcile, triage)
atelier reconcile                    # drift report
atelier eval find_similar            # run eval set, report precision/recall (raw at M5, polished at M7)

# Process (operationalizes METHODOLOGY 11 -- raw form at M1, polished at M7)
atelier audit                        # run cross-doc consistency + data-model audits per METHODOLOGY 11.3 / 11.5; supports --per-pr, --milestone-entry, --milestone-exit, --quarterly
atelier review                       # compute required reviewers from territories.yaml + config.yaml per METHODOLOGY 11.2
```

All 12 present at v1. See `BUILD-SEQUENCE.md §9` for the per-command raw-vs-polished sequencing.

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
| **Guild** | A team and the shared Atelier instance they coordinate through — composers + one datastore + one endpoint + one prototype deploy. Hosts one or more projects. Per ADR-015. |
| **Project** | One repo + linked external tools (issue tracker, design tool, etc.), scoped within a guild via `project_id`. Projects share their guild's datastore and endpoint with `project_id` isolation. A composer is a member of a project only via explicit per-project invite; multi-project composers carry one principal and N project-scoped sessions (per §1, §2). |
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

## 16. The find_similar gate tiers

find_similar ships with two gate tiers (per ADR-043 + ADR-045 + ADR-047):

1. **Advisory tier (v1 default):** P ≥ 0.60 AND R ≥ 0.60. Warnings surface in claim flows, PR comments, and `/atelier` panels but do not block. The CI eval gate is informational at v1: runs, produces `last-run.json` + log output, but does not fail the workflow. Adopters wanting strict gating set `find_similar.ci_gate.enabled: true` + remove `continue-on-error` in the audit workflow.
2. **Blocking tier (v1.x opt-in):** P ≥ 0.85 AND R ≥ 0.70. Activation gated on the cross-encoder reranker per BRD-OPEN-QUESTIONS §27 with documented criteria (≤15pp gap from advisory; reranker measurably lifts; <200ms p95 added latency).

Advisory-tier clearance is corpus-dependent — Atelier's own corpus clears at v1 defaults; some adopter corpora may not. The eval harness (`atelier eval find_similar`) is the diagnostic adopters run against their own corpus to learn whether they sit above or below the tier. The spec stands regardless of how the bet resolves; the wedge framing is the substrate-as-a-whole (per §7), not find_similar standalone.

---

## 17. Why this is the destination

The methodological counter-move to feature-at-a-time drift is destination-first design. Atelier exists because feature-at-a-time building — even of its own components — produces incoherent systems. The whole is specified up front so that every implementation decision has a target to measure against.

If this doc and any subordinate doc disagree, `NORTH-STAR.md` wins and the subordinate doc needs an update.
