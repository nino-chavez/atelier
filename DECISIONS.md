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
