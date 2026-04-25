---
# DECISIONS.md — Append-only canonical decision log
#
# This file is the canonical log that Atelier writes to at runtime (per NORTH-STAR.md §6).
# Every `log_decision` call appends an entry below.
#
# Format per entry:
#   - YAML frontmatter: id, trace_id, category, session, composer, timestamp, (optional) reverses
#   - Body: summary + rationale
#   - Horizontal rule separator
#
# This file is append-only. Reversals are new entries with `reverses: <prior-id>` frontmatter.
# CI validates: no modifications to prior entries, no reordering, datastore mirror in sync.
---

---
id: ADR-001
trace_id: BRD:Epic-1
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:00:00Z
---

# Prototype is the canonical artifact AND coordination dashboard

**Summary.** The prototype web app serves as both the product artifact (strategy + design + current-state panels) and the coordination dashboard (`/atelier` route with role-aware lenses).

**Rationale.** Eliminates a second dashboard surface. Forces artifact and coordination to co-evolve under one design system, one nav, one deploy. Makes the analyst case work — they already visit the prototype to see strategic context; coordination is right there. Avoids the duplication cost of a separate hive-dashboard app.

**Consequences.** Every feature that would have lived in a separate dashboard gets a route or component inside the prototype. Role-based auth affects what renders at `/atelier`. Five routes total: `/`, `/strategy`, `/design`, `/slices/[id]`, `/atelier`, `/traceability`.

---

---
id: ADR-002
trace_id: BRD:Epic-4
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:10:00Z
---

# Contribution is the atomic unit

**Summary.** Tasks, decisions, PRs, proposals, and drafts all live in one `contributions` table. Distinguished by `kind` (implementation | decision | research | design | proposal). Governed by one state machine with 7 states.

**Rationale.** Simpler queries, simpler UI, one set of RLS policies, one set of lifecycle rules. A task is a contribution in `open`. A decision is a contribution with `kind=decision`. A triaged comment is a contribution with `kind=proposal`. The domain model collapses cleanly.

**Consequences.** Database schema has one `contributions` table instead of 3–4. Coordination primitives (claim, release, update) apply uniformly across all kinds. UI renders contributions through kind-specific views but shares lifecycle components.

---

---
id: ADR-003
trace_id: BRD:Epic-4
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:15:00Z
---

# scope_kind generalized from day one

**Summary.** Territory `scope_kind` is one of five values at v1: `files`, `doc_region`, `research_artifact`, `design_component`, `slice_config`. Not "files first, extend later."

**Rationale.** The analyst case and the designer case require non-file scopes at v1. Retrofitting the schema is more expensive than shipping generality on day one. Non-code territories are first-class.

**Consequences.** Territories table has `scope_kind` column with enum at creation. Lock and contribution code branches on `scope_kind` for artifact resolution. Documentation and eval set cover all five kinds.

---

---
id: ADR-004
trace_id: BRD:Epic-7
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:20:00Z
---

# Fencing tokens mandatory on all locks from v1

**Summary.** Every lock acquisition returns a monotonic per-project fencing_token. Every write to a locked artifact validates the token server-side. Stale tokens rejected unconditionally.

**Rationale.** Hackathon-hive ships without fencing; Kleppmann's critique of Redlock applies literally — a GC pause past TTL causes silent overwrite. Known data-loss risk. Retrofitting fencing is an API break and a migration; shipping at v1 is cheap.

**Consequences.** Every write path in the endpoint validates fencing. Lock table includes `fencing_token bigint`. Per-project monotonic counter in a dedicated table with advisory-lock isolation. Documentation explains fencing to users.

---

---
id: ADR-005
trace_id: BRD:Epic-5
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:25:00Z
---

# Decisions write to decisions.md first, datastore second

**Summary.** `log_decision` is a four-step atomic operation: (1) append to `decisions.md` in repo, (2) insert row in datastore decisions table, (3) generate embedding and upsert to vector index, (4) broadcast via pub/sub. Step 1 is the sole success criterion. Steps 2–4 are retried on failure.

**Rationale.** Makes graceful degradation real. Datastore outage cannot lose decision rationale. Vector-index outage cannot lose the decision either — keyword fallback continues to work. The repo is the canonical source of truth; the datastore is a read-model.

**Consequences.** `log_decision` implementation enforces ordering. CI check validates repo/datastore sync on every push. Reversals are new decisions with `reverses` frontmatter.

---

---
id: ADR-006
trace_id: BRD:Epic-6
category: product
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:30:00Z
---

# fit_check ships at v1 with eval harness and CI gate

**Summary.** Fit_check is the semantic-search primitive that detects "is this already done or in flight?" It ships at v1 with a labeled eval set in `atelier/eval/fit_check/*.yaml` and a CI gate at ≥75% precision at ≥60% recall.

**Rationale.** Fit_check is the single most differentiated primitive in Atelier. Shipping without it would remove the defensible commercial wedge. Shipping keyword-only would not test the semantic hypothesis. The CI gate ensures precision doesn't drift as the codebase evolves.

**Consequences.** Vector index is part of the v1 datastore. Eval set + runner + CI job all ship at v1. Accept/reject feedback loop feeds eval improvements. Keyword fallback exists with explicit UI banner when vector index is unavailable.

---

---
id: ADR-007
trace_id: BRD:Epic-1
category: product
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:35:00Z
---

# No multi-tenant SaaS; self-hosted OSS only

**Summary.** Atelier ships as an OSS template that teams self-host. No central Atelier service, no tenant database, no billing infrastructure at v1. Commercial surface (e.g., managed fit_check) is conditional on ADR-006's disconfirming test.

**Rationale.** Two red-team rounds converged. SDLC sync substrate is commoditized by GitHub Spec-Kit, Linear Agents, Atlassian Rovo Dev. Coordination substrate has Anthropic Agent Teams and Switchman closing file-level coordination. Production SaaS year-1 cost ~$750k–$1.2M against free incumbents is wrong math.

**Consequences.** Deployment model assumes self-host. CLI installs to team's own infrastructure. Documentation focuses on self-host recipes. Go-to-market is OSS-first with no marketing funnel until fit_check precision confirms commercial viability.

---

---
id: ADR-008
trace_id: BRD:Epic-9
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:40:00Z
---

# All 5 sync substrate scripts ship together

**Summary.** `publish-docs`, `publish-delivery`, `mirror-delivery`, `reconcile`, and `triage` all ship at v1. No phased rollout.

**Rationale.** Destination-first design (ADR-011). Teams adopting a phase-1 substrate develop usage patterns that phase-2 adds may not fit. Shipping all five at v1 means teams see the full shape from the beginning.

**Consequences.** v1 scope is larger than a phased rollout. Testing and documentation cover all five. Adapter interface must be ready for all externally-connected scripts at v1.

---

---
id: ADR-009
trace_id: BRD:Epic-16
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:45:00Z
---

# Remote-principal actor class (web agents as first-class composers)

**Summary.** The actor model has six classes at v1 (was five in bc-subscriptions). Principal + IDE harness and Principal + web harness are distinct. Web-principals authenticate with per-composer tokens and call the same 12-tool endpoint via remote protocol transport.

**Rationale.** The mixed-team thesis (analyst + devs + PM + designer) requires that analysts in browsers with web agents are first-class composers, not second-class reviewers. Forcing analysts into terminals defeats the thesis.

**Consequences.** Session `locus` enum includes `web`. Endpoint supports remote protocol transport. Auth flow works via browser-safe token delivery. Non-code territory primitives (doc_region, research_artifact) are required for web-principals' work.

---

---
id: ADR-010
trace_id: BRD:Epic-1
category: product
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:50:00Z
---

# Explicit exclusions enforce scope boundaries

**Summary.** Atelier is explicitly NOT: a SaaS, an agent framework, a workflow engine, a task tracker UI, a chat app, a code editor, a design tool, a doc editor, a wiki, a messaging platform. Each external tool remains canonical for its thing.

**Rationale.** Without explicit scope boundaries, products drift into adjacent categories as users request features. Drift destroys the destination. Atelier is the spine that connects tools, not a replacement for any.

**Consequences.** Feature requests are rejected when they would push Atelier into an adjacent category. Documentation makes the boundaries explicit. Integration work respects the "remains canonical" principle — external tools' own primitives are not duplicated in Atelier.

---

---
id: ADR-011
trace_id: BRD:Epic-1
category: convention
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:55:00Z
---

# Destination-first design; no feature deferral

**Summary.** The complete v1 design scope is specified in `NORTH-STAR.md`. No phasing in the design docs. No "Phase 2" or "coming soon." Build order is separate from design scope.

**Rationale.** Feature-at-a-time building creates drift. Big-blueprint's methodology exists specifically to counter this. Atelier applies its own methodology to itself.

**Consequences.** `NORTH-STAR.md` covers every capability at v1. Subordinate docs (`PRD.md`, `BRD.md`, `ARCHITECTURE.md`) expand but do not scope-reduce. Build sequencing is planning-level; it doesn't appear in design docs.

---

---
id: ADR-012
trace_id: BRD:Epic-1
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:00:00Z
---

# Capability-level architecture; no vendor lock-in

**Summary.** All architecture documents describe capabilities (versioned file store, relational datastore, pub/sub broadcast, identity service, vector index, serverless runtime, static hosting, agent interop protocol). Vendor choice is an implementation decision.

**Rationale.** Self-hosted OSS means teams have heterogeneous compliance constraints, hosting preferences, and existing stacks. Architecture that presumes specific vendors (e.g., Supabase, Vercel) excludes teams that can't use them. Capability-level architecture allows any conforming stack.

**Consequences.** Documentation uses capability terms, not vendor names. Reference implementation will pick a specific stack but document it as one valid choice. Adapter interfaces exist for every external system class.

---

---
id: ADR-013
trace_id: BRD:Epic-2
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:05:00Z
---

# 12-tool agent endpoint surface

**Summary.** The agent-facing endpoint exposes exactly 12 tools at v1: register, heartbeat, deregister, get_context, fit_check, claim, update, release, acquire_lock, release_lock, log_decision, publish_contract+get_contracts.

**Rationale.** Minimum viable surface for the full coordination protocol. Every tool maps to a BRD story. No over-engineering (e.g., no `hive/notify` as a tool — messaging is an external integration).

**Consequences.** Documentation enumerates all 12. Client libraries (if any) expose 12 methods. Protocol version is tracked; additions post-v1 require version bump.

---

---
id: ADR-014
trace_id: BRD:Epic-8
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:10:00Z
---

# Territory + contract model, extended to non-code

**Summary.** Territories are named domains with owner_role, scope_kind, scope_pattern, contracts_published, contracts_consumed. Contracts are typed interfaces published by territory owners and consumed by downstream territories. Cross-territory work routes through proposals.

**Rationale.** Inherits ai-hive's department/contract model. Extended so that non-code territories (strategy, research, design) are first-class. Contracts make cross-territory interfaces explicit and monitorable for breaking changes.

**Consequences.** Territories table + contracts table in datastore. Publish/get contract endpoints. Cross-territory work goes through the proposal flow. Breaking-change heuristics drive automatic proposal creation.

---

---
id: ADR-015
trace_id: BRD:Epic-1
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:15:00Z
---

# One hive, many projects

**Summary.** A "hive" is one team's deployed infrastructure (one datastore + one endpoint + one set of deploys). A hive hosts multiple projects. Schema includes `projects` table from v1.

**Rationale.** Hackathon-hive treats the hive as a singleton implicitly. Breaks as teams add projects. Plural-projects at v1 is cheap; retrofit is expensive.

**Consequences.** `atelier init` registers a project in an existing hive or creates a new hive. `projects` table is first-class. RLS scopes everything to project_id. Single hive can host dev, analyst, design projects independently.

---

---
id: ADR-016
trace_id: BRD:Epic-1
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:20:00Z
---

# Two orthogonal substrates: SDLC sync + coordination

**Summary.** SDLC sync substrate (5 scripts, repo ↔ external tools, hours-to-days timescale) and coordination substrate (blackboard + 12-tool endpoint, seconds-to-minutes timescale) are independently deployable. They share trace IDs as cross-reference but are not conflated.

**Rationale.** Different timescales, different failure modes, different competitive landscapes. Conflating them caused red-team findings about one to be misapplied to the other.

**Consequences.** Documentation keeps them separate. Deploy order can differ (e.g., sync substrate without coordination, or vice versa). Competitive analysis treats them independently.

---

---
id: ADR-017
trace_id: BRD:Epic-15
category: design
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:25:00Z
---

# Five role-aware lenses at /atelier

**Summary.** The `/atelier` coordination route has five lenses at v1: analyst, dev, PM, designer, stakeholder. Each is a default-view configuration — same canonical state, different first-view cuts, sort orders, and which panels expand by default.

**Rationale.** Each persona has a different first-view question. Role-specific defaults minimize friction. Composers can switch lenses via a selector.

**Consequences.** Lens config lives in `.atelier/lenses.yaml` (or similar). UI renders the lens matching the composer's role claim by default. Role-based default filters are server-side-enforced for scale.

---

---
id: ADR-018
trace_id: BRD:Epic-9
category: product
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:30:00Z
---

# Triage never auto-merges

**Summary.** External-sourced content (comments from published-doc system, delivery tracker, design tool) is classified and drafted into `kind=proposal` contributions. Proposals cannot transition to `merged` without explicit human approval recorded in the datastore.

**Rationale.** External input is unsanitized. Auto-merging violates the authority model. Proposals are the safe channel for external voices.

**Consequences.** Triage pipeline exits at proposal-created state. Merge check (both datastore policy and CI) requires human approval flag. Messaging alerts notify appropriate role when high-confidence proposals await.

---

---
id: ADR-019
trace_id: BRD:Epic-10
category: design
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:35:00Z
---

# Figma is feedback surface, not design source

**Summary.** Design components live in the prototype (repo-canonical). Figma receives projections of components. Comments on Figma projections flow back through triage.

**Rationale.** Repo-as-canonical applies to design. Figma is to design as Confluence is to BRDs — feedback surface, not authority. Avoids the "design lives in two places" drift.

**Consequences.** `publish-design.mjs` ships components to Figma with trace-ID metadata. Figma webhook triages comments to proposals. Designers author in the prototype (component primitives) with Figma as a review companion.

---

---
id: ADR-020
trace_id: BRD:Epic-1
category: convention
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:40:00Z
---

# Naming: Atelier

**Summary.** The product is named `Atelier`. Vocabulary: the place is `atelier`, the verb is `contribute`, the unit is `contribution`, the inhabitants are `composers`.

**Rationale.** Atelier names the actual thing — a shared studio where contributors work on one canonical artifact. Avoids "OS/platform" framing that fights scope boundaries (ADR-010). Rejected alternatives: `Hivemind OS` (OS/platform-coded; Hive is the existing project), bare `Hive` (too narrow), `Commons` (too generic), `Loom` (considered; Atelier was a closer metaphor).

**Consequences.** All documentation, CLI command, package name, and template naming follow. Marketing copy uses the studio metaphor consistently.

---

---
id: ADR-021
trace_id: BRD:Epic-4
category: architecture
session: walk-analyst-week-1-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T16:00:00Z
---

# Multi-trace-ID support on contributions and decisions

**Summary.** `contributions.trace_id` and `decisions.trace_id` become `trace_ids text[]`. Singular case is a one-element array. GIN indexes replace btree on the trace columns. Endpoint tools accept either `trace_ids: string[]` or a singular `trace_id: string` (treated as one-element).

**Rationale.** Surfaced by the analyst-week-1 walk (`walks/analyst-week-1.md` Gap #4). Cross-cutting work — research on US-1.3 that reveals implications for US-1.5, an architectural decision that affects two epics — must be modelable as a single contribution or decision. Forcing splits into separate rows fragments rationale; a "primary trace_id with mentions in body" pattern breaks `WHERE trace_id='X'` queries. An array is the smallest schema change that supports the real shape of work without compromising query semantics.

**Consequences.** ARCH §5.1 schema updates. ARCH §5.2 changes the trace_id indexes to GIN. NORTH-STAR §5 endpoint signatures accept both forms. Reversal cost is bounded: drop the array, keep the first element.

---

---
id: ADR-022
trace_id: BRD:Epic-2
category: architecture
session: walk-analyst-week-1-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T16:05:00Z
---

# Claim atomic-creates open contributions

**Summary.** `claim` overloads to support atomic create-and-claim when invoked with `contribution_id=null` plus `kind`, `trace_ids`, `territory_id`, and optional `content_stub`. Tool surface stays at 12 — ADR-013 is unaffected.

**Rationale.** Surfaced by the analyst-week-1 walk (`walks/analyst-week-1.md` Gap #1). Ad-hoc analyst research has no pre-existing `open` contribution to claim, but the 12-tool surface has no `create_contribution`. Adding one would push to 13 tools and require amending ADR-013. Overloading `claim` keeps the surface stable, makes the create+claim transaction atomic at the datastore boundary, and matches the way analyst-locus work actually flows — the act of starting research is the act of claiming it.

**Consequences.** NORTH-STAR §5 documents the dual-mode signature. ARCH §6.2 contribution lifecycle adds the create-and-claim path. A scaffold row (state=open, author_session_id=null, content_ref=null, transcript_ref=null) is inserted and immediately transitioned to claimed in one transaction. ADR-013 stands.

---

---
id: ADR-023
trace_id: BRD:Epic-16
category: architecture
session: walk-analyst-week-1-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T16:10:00Z
---

# Remote-locus commits via per-project endpoint committer

**Summary.** Remote-locus composers (locus=web; terminal sessions without repo access) write to the repo via a per-project endpoint git committer. Commits authored as `<composer.display_name> via Atelier <atelier-bot@<project>>` with `Co-Authored-By: <composer email>`. `update` blocks until commit succeeds; on failure, datastore is not updated and tool returns a retry-safe error. Audit log captures `(commit_sha, composer_id, session_id)`.

**Rationale.** Surfaced by the analyst-week-1 walk (`walks/analyst-week-1.md` Gap #2). ARCH §6.2 implies agents write to artifacts, but a web-locus analyst has no local filesystem — the endpoint must commit on their behalf. Identity, signing, failure handling, and sync timing were unspecified, leaving both a security gap and a durability gap. Synchronous commit by a per-project committer with composer co-authorship preserves attribution, keeps repo-first semantics (ADR-005), and bounds failure to retry-safe states.

**Consequences.** New ARCH §7.8 — Remote-locus write attribution. Endpoint holds a project-scoped deploy key, rotatable via `atelier rotate-committer-key`. Audit log queryable in `/atelier/observability`. Datastore mirror only follows successful commit. CLI gains the rotation subcommand.

---

---
id: ADR-024
trace_id: BRD:Epic-4
category: architecture
session: walk-analyst-week-1-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T16:15:00Z
---

# Transcripts as repo-sidecar files, opt-in by config

**Summary.** Agent-session transcripts are stored as sidecar files in the repo (e.g., `research/US-1.3-deploy-research.transcript.jsonl`). Schema gains `contributions.transcript_ref text` (nullable). Capture is opt-in via `.atelier/config.yaml: transcripts.capture: false` (default). Sidecars are gitignored by default; opt-in commits them under a documented PII review.

**Rationale.** Surfaced by the analyst-week-1 walk (`walks/analyst-week-1.md` Gap #3). Transcripts carry provenance, eval-feedback, and audit value but also size and PII risk. Repo-sidecar with config opt-in keeps repo-first semantics (ADR-005), lets teams choose, and avoids forcing an external blob-store dependency on every Atelier deploy.

**Consequences.** ARCH §5.1 contributions table gains `transcript_ref text`. `.atelier/config.yaml` gains a `transcripts:` section. METHODOLOGY documents size + PII implications and the opt-in review flow. Captured transcripts contribute to fit_check eval feedback only when explicitly tagged for inclusion.

---

---
id: ADR-025
trace_id: BRD:Epic-15
category: design
session: walk-analyst-week-1-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T16:20:00Z
---

# Review routing keyed by territory.review_role

**Summary.** Contributions transitioning to `state=review` are routed to lenses by `territories.review_role`. Default mappings: `strategy-research → pm`, `protocol → dev` (peer), `requirements → pm`, `prototype-app → dev` (peer), `prototype-design → designer` (peer), `methodology/architecture/decisions → architect`. Lenses query the union of (territories owned by composer's role) and (territories with review_role matching composer's role).

**Rationale.** Surfaced by the analyst-week-1 walk (`walks/analyst-week-1.md` Gap #5). NORTH-STAR §4 lens definitions partially covered review surfaces but did not specify which lens picks up which `kind × state` combination. Per-territory `review_role` is the smallest change that resolves it cleanly, reuses the existing territory-as-config pattern, and avoids global rule tables that would compete with territory ownership.

**Consequences.** `.atelier/territories.yaml` schema gains a `review_role` field per territory entry. NORTH-STAR §4 lens descriptions reference territory.review_role. Default values committed in this repo's territories.yaml serve as a reference example for projects scaffolded by `atelier init`.

---

---
id: ADR-026
trace_id: BRD:Epic-7
category: architecture
session: d22-switchman-eval-2026-04-25
composer: nino-chavez
timestamp: 2026-04-25T09:30:00Z
---

# Atelier owns the lock + fencing implementation; Switchman not adopted

**Summary.** Atelier ships its own lock-and-fencing implementation in M2 of `BUILD-SEQUENCE.md` rather than integrating Switchman. Resolves D22 (`PRD-COMPANION.md`) and BRD-OPEN-QUESTIONS §2.

**Rationale.** Evaluation of `github.com/switchman-dev/switchman` (2026-04-25) showed Switchman is MIT-licensed and MCP-native — promising — but its lock model is lease-based with `scope_pattern + subsystem_tags`, with no fencing-token (monotonic per-resource counter) exposed in the public API. ADR-004 makes fencing tokens mandatory on every lock from v1 specifically to handle the stale-holder-comeback case: a partitioned session whose lease was reassigned can still write to the artifact unless the storage layer rejects on a stale token. A lease-only model is not fencing-equivalent. Integrating Switchman would either require layering fencing on top (defeating the integration's value) or accepting the gap (violating ADR-004).

Additional concerns reinforced the decision: Switchman is at v0.1.28 with no semver commitment after 6 weeks of active churn, effectively solo-maintained (`seanwessmith` + automation), and ships a 15+ tool surface centered on file-write helpers (`switchman_write_file`, `_append_file`, …) that competes with Atelier's repo-first principle (ADR-005).

Switchman's `scope_pattern + subsystem_tags` model is independent confirmation that the territory-as-scope-pattern shape works in practice (validates ADR-014). We borrow validation, not code.

**Consequences.** M2 lock subsystem in `BUILD-SEQUENCE.md` proceeds as own-implementation. BRD-OPEN-QUESTIONS §2 → RESOLVED. Re-evaluation trigger: if Switchman ships 1.0 with explicit fencing-token API and a semver commitment, re-open D22 with a new ADR that references this one.

---

---
id: ADR-027
trace_id: BRD:Epic-1
category: architecture
session: stack-pick-2026-04-25
composer: nino-chavez
timestamp: 2026-04-25T10:00:00Z
---

# Reference implementation stack: GitHub + Supabase + Vercel + MCP

**Summary.** The Atelier reference implementation uses GitHub (versioned file store), Supabase (Postgres + Realtime + Auth + pgvector for relational datastore + pub/sub + identity + vector index), Vercel (Functions + Hosting + Cron for serverless runtime + static hosting + scheduled jobs), and MCP (agent interop protocol). This is **one valid implementation**, not the architecture (per ADR-012). Each capability remains capability-level in `NORTH-STAR.md` §13 and `ARCHITECTURE.md`.

**Capability mapping:**

| Capability (NORTH-STAR §13) | Reference choice | Why |
|---|---|---|
| Versioned file store | GitHub | Existing repo; deploy keys for ADR-023 endpoint committer; widest agent-client compatibility |
| Relational datastore | Supabase Postgres | RLS-native (matches ARCH §5.3), GIN indexes for ADR-021 trace_ids, hosts the next three capabilities as extensions |
| Pub/sub broadcast | Supabase Realtime | Built on Postgres NOTIFY/LISTEN; no extra service; client SDKs already MCP-friendly |
| Identity service | Supabase Auth | Resolves D23 — see ADR-028. Bundled with datastore, OIDC federation, RLS integration |
| Vector index | pgvector on Supabase | No extra service; sufficient for documented scale envelope (BRD-OPEN-QUESTIONS §7) |
| Serverless runtime | Vercel Functions | Bundled with static hosting; Node runtime matches the inherited hackathon-hive code; GitHub integration |
| Static hosting | Vercel | CI/CD from GitHub push; edge network; one provider for hosting + functions |
| Protocol | MCP (streamable-http) | ADR-013, ADR-019 |
| Cron / scheduled | Vercel Cron Jobs | Per-script schedule for reaper, mirror-delivery, reconcile (ARCH §6.5); keeps Postgres lean |
| Observability sink | OpenTelemetry → local `telemetry` table (default) | Schema-resident default per ARCH §5.1; pluggable external (Honeycomb/Datadog/etc.) |

**Rationale.** The "evolve hackathon-hive in place" approach (strategic-direction conversation, 2026-04-24) already implies Supabase + Vercel + MCP — hackathon-hive runs on this stack today, with the fencing-token, fit_check, and `decisions.md` writer gaps that Atelier's v1 fixes. Adopting hackathon-hive's stack for the reference impl avoids an unnecessary stack-rewrite cost on top of the methodology fix-up cost. The stack also consolidates four NORTH-STAR §13 capabilities (datastore + pub/sub + identity + vector) into a single managed Postgres surface, which matches Atelier's "self-hosted, low operational burden" goal.

The reference stack is **not** privileged in any architecture doc. ADR-012 (capability-level architecture, no vendor lock-in) is reaffirmed: any of the 10 capabilities can be swapped without architectural change. This ADR documents the choice for the reference impl only.

**Consequences.** `BUILD-SEQUENCE.md` M2 onward implements against this stack. `.atelier/config.yaml` env-var bindings get reference comments naming the default vendor. M7 hardening tasks (D22, D23, D24) collapse: D22 resolved (own-impl, ADR-026), D23 resolved (Supabase Auth, ADR-028), D24 still OPEN until M5 prep. `atelier init` deploy story targets this stack as the one-command default.

**Re-evaluation triggers.**
- Supabase pricing or RLS-policy ceiling materially changes: re-pick datastore.
- Vercel runtime / pricing ceiling: re-pick serverless + hosting.
- pgvector p95 degrades past the documented scale envelope: re-pick vector index.

---

---
id: ADR-028
trace_id: BRD:Epic-13
category: architecture
session: stack-pick-2026-04-25
composer: nino-chavez
timestamp: 2026-04-25T10:15:00Z
---

# Identity service default: Supabase Auth (BYO supported)

**Summary.** Atelier's reference identity service is Supabase Auth. Resolves D23 (`PRD-COMPANION.md`) and BRD-OPEN-QUESTIONS §5. Teams can override with any OIDC-compliant identity provider (Auth0, Clerk, self-hosted Keycloak, etc.) via `.atelier/config.yaml: identity.provider`.

**Rationale.** Sub-decision of ADR-027 (reference stack). Once Supabase is the datastore choice, Supabase Auth is the path of least operational resistance: it ships with the datastore, issues signed JWTs that match ARCH §7.1 token semantics, integrates natively with row-level security (matches ARCH §5.3 and §7.2), and supports OIDC federation for SSO-having teams. Alternatives (Auth0, Clerk) are equally capable but add a second managed dependency on every deploy. Self-hosted OIDC (Keycloak, Hydra) is a heavier operational commitment than a v1 reference should impose.

The "BYO" framing matters: Atelier is template-and-protocol-first. A team may already run Auth0 or Keycloak — Atelier should not force a swap. The default is what `atelier init` provisions; the override is a config switch.

**Consequences.** `.atelier/config.yaml` gains `identity:` section with `provider: supabase-auth` default. ARCH §7.1 references this default explicitly while keeping the identity-service capability vendor-neutral. CLI gains `atelier identity provision` for first-run setup. Token rotation flow uses Supabase's session-management primitives. M2/M3 auth wiring proceeds against this default.

**Re-evaluation triggers.**
- Supabase Auth deprecation or breaking JWT-claim change.
- Adoption pattern shifts: if >50% of `atelier init` users override identity, reconsider whether the default is worth carrying.

---

---
id: ADR-029
trace_id: BRD:Epic-1
category: architecture
session: portability-constraint-2026-04-25
composer: nino-chavez
timestamp: 2026-04-25T11:00:00Z
---

# Reference impl preserves GCP-portability; migration mapping documented

**Summary.** The Atelier reference implementation (per ADR-027: Supabase + Vercel) is constrained at v1 to use only features with documented GCP equivalents. Any deviation (Supabase Realtime, Vercel-specific runtime APIs, Supabase Edge Functions, Vercel KV, etc.) is wrapped in a thin abstraction so a future GCP migration is mechanical, not architectural. ADR-027 is reaffirmed; this ADR adds a constraint, not a reversal.

**Rationale.** The stack-pick conversation (2026-04-25) settled on Vercel + Supabase for v1 ergonomics with an explicit forward-looking constraint: GCP migration must remain a viable future option. Without portability discipline, the reference impl accumulates Supabase/Vercel-specific code (Realtime channels, Vercel KV, Edge Config, Supabase Edge Functions, RPC helpers) that compounds migration tax. Constraining now keeps migration cost bounded — the cost is one small abstraction layer in M2 around the two amber capabilities (Realtime, Auth claim helpers) and a "no proprietary imports" discipline elsewhere.

**Per-capability portability mapping:**

| Capability | Supabase/Vercel feature | GCP equivalent | Portability | Action for v1 |
|---|---|---|---|---|
| Relational datastore | Supabase Postgres (standard PG 15+) | Cloud SQL for Postgres | Direct | Use standard Postgres only; no Supabase RPC functions outside `BroadcastService` |
| RLS | Postgres RLS policies | Postgres RLS policies | Direct | RLS SQL is portable as-is |
| Identity | Supabase Auth (signed JWTs) | Identity Platform (signed OIDC JWTs) | Partial | Atelier verifies JWT via OIDC standard; reads `sub`/`email`/`role` only. No Supabase claim helpers. User re-import is a one-time migration step |
| Pub/sub | Supabase Realtime | NOTIFY/LISTEN + WebSocket adapter | Wrappable | Wrap in `BroadcastService` interface; reference impl uses Realtime; migration impl uses NOTIFY-based handler on Cloud Run |
| Vector | pgvector on Supabase | pgvector on Cloud SQL | Direct | pgvector is the abstraction |
| Serverless runtime | Vercel Functions (Node) | Cloud Run (Node container) | Direct (with constraint) | No `@vercel/edge`, `@vercel/kv`, Edge Config, or Vercel-specific globals. Node-standard only. Cloud Run packaging is one Dockerfile away |
| Static hosting | Vercel | Cloud Storage + Cloud CDN | Direct | Static output is framework-portable |
| Cron | Vercel Cron | Cloud Scheduler → HTTPS endpoints | Direct | Cron handlers are HTTPS endpoints; same shape under both |
| Observability | OpenTelemetry → telemetry table | Cloud Logging via OTEL collector | Direct | OTEL is the abstraction; sink swap is config |

**Consequences.**
- M2 introduces a `BroadcastService` interface. Default impl: Supabase Realtime. Documented migration impl: Postgres NOTIFY/LISTEN with a WebSocket adapter suitable for Cloud Run.
- M2/M3 code uses standard Node + OIDC JWT verification. Imports from `@vercel/*` (other than the framework's own) and Supabase RPC helpers are banned outside named adapters. A lint rule enforces this in M7 hardening.
- Migration runbook ships with v1 as `docs/migration-to-gcp.md` once M2 lands (or earlier if useful for testing the constraint).
- ADR-027 stack pick stays. This ADR adds the rule that keeps that pick reversible.

**Re-evaluation triggers.**
- GCP discontinues Cloud SQL Postgres or Identity Platform.
- Atelier's user base shows zero migration interest after 12 months in production (then this constraint may be paying carrying cost for no benefit).
- Vercel or Supabase ships a feature so compelling that its absence breaks the v1 value prop (re-open and weigh).

---
