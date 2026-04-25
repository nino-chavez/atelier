# PRD Companion: Decisions Log

**Status:** Draft v1.0
**Owner:** Nino Chavez
**Last updated:** 2026-04-24
**Related:** `PRD.md`, `../strategic/NORTH-STAR.md`, `BRD.md`, `../architecture/ARCHITECTURE.md`, `../architecture/decisions`, `../strategic/STRATEGY.md`

---

## Purpose

This document captures the **decisions made during design** with their rationale, alternatives considered, and status. It is the working record of how the north-star shape was arrived at.

Each decision is tagged **OPEN**, **PROPOSED**, or **DECIDED**. Once decided, the change is landed in the downstream spec (`PRD.md`, `BRD.md`, `../architecture/ARCHITECTURE.md`, or `../strategic/NORTH-STAR.md`) and the entry stays here as the rationale record.

`../architecture/decisions` is a different artifact — it is the append-only canonical log Atelier writes to as the product operates (per `../strategic/NORTH-STAR.md` §6). This document (`PRD-COMPANION.md`) is the design-time decisions log; `../architecture/decisions` is the runtime decisions log.

---

## Decision summary

| ID | Decision | Area | Impact | Recommendation | Status |
|---|---|---|---|---|---|
| D1 | Prototype is the canonical artifact AND coordination dashboard | Core model | High | Adopt | **DECIDED** (2026-04-24) |
| D2 | Contribution is the atomic unit — subsumes tasks, decisions, proposals, PRs | Data model | High | Adopt | **DECIDED** (2026-04-24) |
| D3 | `scope_kind` generalized from day one (files, doc_region, research_artifact, design_component) | Data model | High | Adopt | **DECIDED** (2026-04-24) |
| D4 | Fencing tokens mandatory on all locks from v1 | Security | High | Adopt | **DECIDED** (2026-04-24) |
| D5 | Decisions write to `decisions.md` first, datastore second | Durability | High | Adopt | **DECIDED** (2026-04-24) |
| D6 | Fit_check ships at v1 with eval harness + CI gate (≥75% precision at ≥60% recall) | Product | High | Adopt | **DECIDED** (2026-04-24) |
| D7 | No multi-tenant SaaS; self-hosted OSS only | Product scope | High | Adopt | **DECIDED** (2026-04-24) |
| D8 | All 5 sync substrate scripts ship together; no phasing | Scope | Medium | Adopt | **DECIDED** (2026-04-24) |
| D9 | Remote-principal actor class (web-agent composers as first-class) | Actor model | High | Adopt | **DECIDED** (2026-04-24) |
| D10 | Explicit exclusions: not agent framework, workflow engine, chat app, tracker UI, code editor, design tool, doc editor, wiki, messaging | Product scope | High | Adopt | **DECIDED** (2026-04-24) |
| D11 | Destination-first design; no feature deferral to avoid feature-at-a-time drift | Methodology | High | Adopt | **DECIDED** (2026-04-24) |
| D12 | Capability-level architecture; no vendor lock-in | Architecture | Medium | Adopt | **DECIDED** (2026-04-24) |
| D13 | 12-tool agent endpoint surface (session×3, context×2, contribution×3, lock×2, decision×1, contract×1) | Protocol | High | Adopt | **DECIDED** (2026-04-24) |
| D14 | Territory + contract model inherited from ai-hive; extended to non-code artifacts | Coordination | High | Adopt | **DECIDED** (2026-04-24) |
| D15 | One hive, many projects (plural projects schema from v1) | Data model | Medium | Adopt | **DECIDED** (2026-04-24) |
| D16 | Separate orthogonal substrates: SDLC sync + coordination/blackboard | Architecture | High | Adopt | **DECIDED** (2026-04-24) |
| D17 | `/atelier` coordination route inside the prototype; no separate dashboard app | UX | High | Adopt | **DECIDED** (2026-04-24) |
| D18 | Five role-aware lenses: analyst, dev, PM, designer, stakeholder | UX | Medium | Adopt | **DECIDED** (2026-04-24) |
| D19 | MCP as likely agent interop protocol (but specify protocol-agnostically) | Protocol | Medium | Adopt | **DECIDED** (2026-04-24) |
| D20 | Triage never auto-merges; all external-sourced content requires human approval | Security | High | Adopt | **DECIDED** (2026-04-24) |
| D21 | Figma is feedback surface, not design source-of-truth | UX | Medium | Adopt | **DECIDED** (2026-04-24) |
| D22 | Switchman evaluated as dependency for file-level locks (rejected: no fencing-token API) | Architecture | Medium | Own-implementation | **DECIDED** (2026-04-25) |
| D23 | Identity-service default (self-hosted OIDC vs external provider vs BYO) | Architecture | Medium | BYO with a default | **OPEN** |
| D24 | Embedding model default for fit_check | Architecture | Medium | Benchmark 3+ options | **OPEN** |
| D25 | Naming: `Atelier` over `Hivemind OS` / `Hive` / `Commons` / `Loom` | Product | Medium | Adopt `Atelier` | **DECIDED** (2026-04-24) |
| D26 | Multi-trace-ID support on contributions and decisions (`text[]` with GIN index) | Data model | High | Adopt | **DECIDED** (2026-04-24) |
| D27 | `claim` atomic-creates open contributions when called with `contribution_id=null` | Protocol | High | Adopt | **DECIDED** (2026-04-24) |
| D28 | Remote-locus commits via per-project endpoint git committer | Architecture | High | Adopt | **DECIDED** (2026-04-24) |
| D29 | Transcripts as repo-sidecar files, opt-in by config | Architecture | Medium | Adopt | **DECIDED** (2026-04-24) |
| D30 | Review routing keyed by `territory.review_role` | Coordination | Medium | Adopt | **DECIDED** (2026-04-24) |
| D31 | Reference implementation stack: GitHub + Supabase + Vercel + MCP | Architecture | High | Adopt as reference (not architecture) | **DECIDED** (2026-04-25) |
| D32 | Reference impl preserves GCP-portability; thin abstraction around Realtime; no proprietary Vercel/Supabase imports outside named adapters | Architecture | High | Adopt | **DECIDED** (2026-04-25) |
| D33 | Per-ADR file split — `DECISIONS.md` becomes `docs/architecture/decisions/ADR-NNN-<slug>.md` directory | Methodology | Medium | Adopt | **DECIDED** (2026-04-25) — see ADR-030 |
| D34 | Three-tier consumer model — Specification / Reference Implementation / Reference Deployment | Strategy | High | Adopt with standards-body labels in formal docs and action labels (Deploy / Extend / Implement) in README routing | **DECIDED** (2026-04-25) — see ADR-031 |
| D35 | Adopt extended documentation structure (claude-docs-toolkit seven layers + Atelier extensions: `methodology/`, `architecture/protocol/`, `architecture/schema/`) | Methodology | High | Adopt; commit to upstreaming refinements to claude-docs-toolkit | **DECIDED** (2026-04-25) — see ADR-032 |

D26–D30 were surfaced by the analyst-week-1 walk (`../architecture/walks/analyst-week-1.md`) and landed as ADR-021 through ADR-025 respectively in `../architecture/decisions/`. D22, D23, D31, D32 landed as ADR-026, ADR-028, ADR-027, ADR-029 on 2026-04-25. D33–D35 landed as ADR-030, ADR-031, ADR-032 on 2026-04-25 as part of the doc-organization cleanup.

---

## Decision details

---

### D1 — Prototype is the canonical artifact AND coordination dashboard

**Status:** DECIDED (2026-04-24)

**Context.** Throughout design, we separated "the product/artifact" from "the coordination surface." Initial framing had a dedicated hive dashboard (from hackathon-hive + ai-hive architecture's Phase 3 dashboard) alongside a big-blueprint-style prototype. Mid-session user correction: "the point of big-blueprint is to be the prototype so we would enhance it for collaboration capabilities."

**Alternatives considered:**
1. Separate dashboard app (rejected — duplication of nav, design system, and deploy surface).
2. Prototype as the dashboard with `/atelier` route (adopted).
3. Dashboard embedded as widget inside the prototype (rejected — less cohesion, more chrome).

**Decision.** The prototype web app has a `/atelier` route that is the role-aware coordination dashboard. Same deploy, same design system, same navigation model as the product artifact. The prototype IS the dashboard.

**Rationale.** Eliminates a whole second surface. Forces the artifact and the coordination to co-evolve. Makes the analyst case work (they already visit the prototype to see strategy — coordination is right there).

**Impact on downstream docs:**
- `../strategic/NORTH-STAR.md` §4 — five routes, `/atelier` is the fifth
- `BRD.md` Epic 3 — stories US-3.1 to US-3.7
- `../architecture/ARCHITECTURE.md` §4 — prototype web app is both canonical artifact and coordination surface

---

### D2 — Contribution is the atomic unit

**Status:** DECIDED (2026-04-24)

**Context.** Initial design separated tasks, decisions, proposals, and PRs as distinct entities. Red-team feedback: simpler to collapse into one schema with state + kind fields.

**Alternatives considered:**
1. Distinct entities (tasks, decisions, proposals as separate tables, each with own lifecycle) — rejected for complexity.
2. Contributions as the atom, with `state` and `kind` distinguishing (adopted).

**Decision.** `contributions` is one table. `kind` distinguishes implementation/decision/research/design/proposal. `state` is one of 7 values with deterministic transitions.

**Rationale.** One state machine. One set of lifecycle queries. One set of RLS policies. Simpler UI (one dashboard component renders all). Decisions and PRs share most of their lifecycle anyway.

**Impact:**
- `BRD.md` Epic 4 — unified contribution schema
- `../architecture/ARCHITECTURE.md` §5 — contributions table spec

---

### D3 — `scope_kind` generalized from day one

**Status:** DECIDED (2026-04-24)

**Context.** Hackathon-hive scopes work to `file_scope` (files on a codebase). Breaks the moment an analyst wants to claim "the personas section of BRD.md" or a designer wants to claim "the button component."

**Alternatives considered:**
1. Files-only at v1, extend later — rejected (forces schema migration and rework).
2. `scope_kind` enum from v1 (adopted).

**Decision.** `scope_kind` is one of: `files`, `doc_region`, `research_artifact`, `design_component`, `slice_config`. All five kinds supported at v1.

**Rationale.** Analyst and designer personas cannot be first-class otherwise. Adding new kinds later is additive (new enum values) rather than schema migration.

**Impact:**
- `BRD.md` US-4.4 — scope_kind test cases
- `../architecture/ARCHITECTURE.md` §5.1 — territories.scope_kind column

---

### D4 — Fencing tokens on all locks from v1

**Status:** DECIDED (2026-04-24)

**Context.** Hackathon-hive's lock implementation is Redlock-style distributed mutex without fencing tokens. Kleppmann's critique: GC pause past TTL causes silent overwrite. Known bug, unpatched as of 2026-04-24.

**Alternatives considered:**
1. Ship v1 without fencing, patch later — rejected (known data-loss risk, breaks the "graceful degradation" claim).
2. Ship fencing at v1 (adopted).

**Decision.** Every lock carries a monotonic per-project fencing token. Every write to a locked artifact validates the token server-side. Stale tokens rejected unconditionally.

**Rationale.** Can't ship with known data-loss risk. Fencing is a one-time design choice that's cheap at v1 and expensive to retrofit.

**Impact:**
- `BRD.md` US-7.1, US-7.2 — fencing-token stories
- `../architecture/ARCHITECTURE.md` §5.1, §7.4 — fencing tokens in schema and security

---

### D5 — Decisions write to `decisions.md` first, datastore second

**Status:** DECIDED (2026-04-24)

**Context.** Ai-hive architecture claimed "graceful degradation via decisions.md" but hackathon-hive stores decisions only in Postgres. If the DB goes away, rationale vanishes. The "graceful degradation" was aspirational.

**Alternatives considered:**
1. Datastore-first with async repo writer — rejected (repo write is the one that's not allowed to fail for graceful degradation).
2. Repo-first with datastore mirror (adopted).

**Decision.** `log_decision` writes to `decisions.md` first (commit to repo), then mirrors to datastore, then indexes into vector, then broadcasts. The repo write is the sole success criterion. Downstream failures are retried.

**Rationale.** Makes graceful degradation real. Datastore outage cannot lose decision rationale. Repo survives everything.

**Impact:**
- `BRD.md` US-5.1, US-5.3 — repo-first + CI sync check
- `../architecture/ARCHITECTURE.md` §6.3 — four-step atomic operation

---

### D6 — Fit_check ships at v1 with eval harness + CI gate

**Status:** DECIDED (2026-04-24)

**Context.** Fit_check is specified in ai-hive architecture but not implemented in hackathon-hive MVP. It's the single most differentiated primitive. Red team: "if you ship without it, there's no moat."

**Alternatives considered:**
1. Defer fit_check to post-v1 — rejected (destination-first; see D11).
2. Ship keyword-only at v1 — rejected (doesn't test the semantic hypothesis).
3. Ship full vector-index-backed fit_check with eval harness and CI gate (adopted).

**Decision.** Fit_check ships at v1. Eval harness in `atelier/eval/fit_check/*.yaml` with labeled positive pairs + negatives + adversarials. CI gate at ≥75% precision and ≥60% recall. Accept/reject feedback loop.

**Rationale.** The disconfirming test. If precision holds, commercial wedge exists; if not, Atelier is methodology + template. Either way, every other feature ships — fit_check performance doesn't gate them.

**Impact:**
- `BRD.md` Epic 6 — US-6.1 through US-6.6
- `../architecture/ARCHITECTURE.md` §5.4, §6.4 — vector index + fit_check flow
- `../strategic/STRATEGY.md` §7 — the disconfirming test

---

### D7 — No multi-tenant SaaS; self-hosted OSS only

**Status:** DECIDED (2026-04-24)

**Context.** Two red-team rounds converged on "not a SaaS." SDLC sync substrate: commoditized by GitHub spec-kit + Linear Agents + Atlassian Rovo Dev. Coordination substrate: Anthropic Agent Teams and Switchman close file-level. Production SaaS year-1 cost ~$750k–$1.2M against free incumbents.

**Alternatives considered:**
1. Managed SaaS — rejected (math doesn't work).
2. OSS + optional managed services — considered; kept optional for commercial surface conditional on D6's disconfirming test.
3. OSS-only, self-hosted, no managed anything (adopted for v1).

**Decision.** Atelier ships as OSS template. Teams self-host. No central Atelier service, no tenant database, no billing. Commercial surface (managed fit_check) is conditional on D6 outcome and not part of v1.

**Rationale.** Consulting incumbents win SaaS distribution fights. Methodology + template + protocol is the credible play. Commercial wedge stays narrow and conditional.

**Impact:**
- `../strategic/STRATEGY.md` §6, §7 — product-scope verdict
- `PRD.md` §2, §8 — market positioning + go-to-market
- `../architecture/ARCHITECTURE.md` §9 — self-hosted deployment model

---

### D8 — All 5 sync substrate scripts ship together

**Status:** DECIDED (2026-04-24)

**Context.** Earlier design had phased rollout (publish-jira first, publish-confluence Phase 2, reconcile Phase 3, etc.). User rejected phasing: "nothing should be deferred or future state. north star from the start."

**Alternatives considered:**
1. Phased (publish-* first, reconcile/triage later) — rejected.
2. All five concurrent (adopted).

**Decision.** `publish-docs`, `publish-delivery`, `mirror-delivery`, `reconcile`, `triage` all ship at v1.

**Rationale.** Destination-first. Phased substrate scripts create drift because teams adopt in phase-1 shape and then discover phase-2 adds don't fit their usage.

**Impact:**
- `../strategic/NORTH-STAR.md` §8
- `BRD.md` Epic 9 — all 7 stories v1-scope

---

### D9 — Remote-principal actor class

**Status:** DECIDED (2026-04-24)

**Context.** Ai-hive's actor model assumes all composers are on the codebase with IDE agents. Mixed-team case (analyst + devs) requires a composer in a browser with a web agent.

**Alternatives considered:**
1. Force analysts into terminals — rejected (defeats the mixed-team thesis).
2. Extend actor model with `web` locus + remote-protocol transport (adopted).

**Decision.** Actor model has 6 classes (was 5). Principal + IDE harness and Principal + web harness are distinct. Web-principals authenticate with per-composer tokens and call the same 12-tool endpoint via remote protocol.

**Rationale.** Analysts, PMs, some designers are browser-native. Making them first-class composers is the core mixed-team claim.

**Impact:**
- `../methodology/METHODOLOGY.md` §3 — six-class actor model
- `BRD.md` Epic 16 — remote composer stories
- `../architecture/ARCHITECTURE.md` §6.1 — session locus enum includes `web`

---

### D10 — Explicit exclusions (what's OUT of scope)

**Status:** DECIDED (2026-04-24)

**Context.** Without explicit scope boundaries, product will drift into adjacent categories as users request features. Drift destroys the destination.

**Decision.** Explicit non-scope list in `../strategic/NORTH-STAR.md` §14 and `PRD.md` §5: not SaaS, not agent framework, not workflow engine, not tracker UI, not chat app, not code editor, not design tool, not doc editor, not wiki, not messaging.

**Rationale.** Each external tool remains canonical for its thing. Atelier is the spine; it doesn't replace any of the tools it connects.

---

### D11 — Destination-first design (no deferral)

**Status:** DECIDED (2026-04-24)

**Context.** Big-blueprint's methodology is destination-first specifically because feature-at-a-time builds create drift. Atelier applies its own methodology to itself. User: "nothing should be deferred or future state. north star from the start so we understand the full scope of what needs to be designed."

**Alternatives considered:**
1. Phased rollout (M0 → M4 over 17+ weeks) — rejected (feature-at-a-time drift).
2. Destination-first design; build order separate from design scope (adopted).

**Decision.** Every capability in `../strategic/NORTH-STAR.md` is specified and scoped at v1. Implementation sequencing is a delivery concern, not a design concern. No "Phase 2" in the design docs.

**Rationale.** The methodology exists to counter feature-at-a-time drift. Applying it to Atelier's own design is the proof-by-example.

---

### D12 — Capability-level architecture; no vendor lock-in

**Status:** DECIDED (2026-04-24)

**Context.** Initial architecture named specific vendors (Supabase, Vercel, Next.js, pgvector). User: "don't presume specific solutions for the architecture or tech stack. supabase == 'rdbms' or 'persistence layer' etc."

**Decision.** All architecture documents describe capabilities: versioned file store, relational datastore, pub/sub broadcast, identity service, vector index, serverless runtime, static hosting, agent interop protocol, cron, observability sink. Vendor choice is an implementation decision.

**Rationale.** Self-hosted OSS means teams have different compliance constraints, hosting preferences, and existing stacks. Architecture that presumes Supabase/Vercel excludes teams that can't use them. Capability-level architecture allows any conforming stack.

**Impact:**
- All architecture docs rewritten vendor-neutral.
- Reference implementation will pick specific stack but document it as one valid choice.

---

### D13 — 12-tool agent endpoint surface

**Status:** DECIDED (2026-04-24)

**Context.** Ai-hive architecture specified 13 tools. Hackathon-hive implements 12. Reviewed for consolidation.

**Decision.** 12 tools: register/heartbeat/deregister (session), get_context/fit_check (context), claim/update/release (contribution), acquire_lock/release_lock (lock), log_decision (decision), publish_contract+get_contracts (contract, counted as one tool surface).

**Rationale.** Minimum viable surface for full protocol. Every tool maps to a BRD story.

**Impact:**
- `../strategic/NORTH-STAR.md` §5 — complete tool table
- `BRD.md` Epic 2 — 12 stories

---

### D14 — Territory + contract model (extended to non-code)

**Status:** DECIDED (2026-04-24)

**Context.** Ai-hive specifies territories as file/directory domains. Extension required for non-code territories (strategy, research, design).

**Decision.** Territories are named domains with `scope_kind` + `scope_pattern`. Contracts are typed interfaces published by territory owners, consumed by downstream territories. Cross-territory work routes through proposals.

**Rationale.** Non-code territories are first-class. Contracts are the interoperability mechanism between territories.

**Impact:**
- `BRD.md` Epic 4, Epic 8 — territory + contract stories
- `../architecture/ARCHITECTURE.md` §5, §6.6 — territories, contracts, flow

---

### D15 — One hive, many projects (plural schema from v1)

**Status:** DECIDED (2026-04-24)

**Context.** Hackathon-hive treats "the hive" as a singleton — one Supabase DB == one project implicitly. Breaks as teams add projects.

**Decision.** Schema includes `projects` table from v1. Hive = one team's deployed infrastructure. Projects = rows in that hive's `projects` table. Many-projects-per-hive from v1.

**Rationale.** Teams run multiple projects. Retrofit to plural after ship is expensive. Schema cost at v1 is trivial.

**Impact:**
- `../architecture/ARCHITECTURE.md` §5.1 — projects table spec
- `../architecture/ARCHITECTURE.md` §9.2 — one hive, many projects deployment model

---

### D16 — Two orthogonal substrates (SDLC sync + coordination)

**Status:** DECIDED (2026-04-24)

**Context.** Early design conflated SDLC sync substrate (repo ↔ external tools, hours-to-days timescale) with coordination substrate (multi-composer real-time, seconds-to-minutes timescale). Mid-session correction established they are orthogonal.

**Decision.** Two named substrates. SDLC sync = 5 scripts + registry. Coordination = blackboard + 12-tool endpoint. They share trace IDs as cross-reference but are independently deployable.

**Rationale.** Different timescales, different failure modes, different competitive landscapes, different product prospects. Conflating them made red-team findings from one substrate appear to apply to the other.

**Impact:**
- `../methodology/METHODOLOGY.md` §5 — two substrates explicit
- `../strategic/STRATEGY.md` §3 — two competitive analyses

---

### D17 — `/atelier` coordination route inside the prototype

**Status:** DECIDED (2026-04-24)

See D1. This is the implementation consequence: one web app, five routes, `/atelier` is the coordination lens.

---

### D18 — Five role-aware lenses

**Status:** DECIDED (2026-04-24)

**Decision.** Analyst, dev, PM, designer, stakeholder lenses at `/atelier`. Same canonical state, different default filters and sort orders.

**Rationale.** Each persona has a different first-view question they're answering when they visit the coordination route. Role-specific defaults minimize friction.

**Impact:**
- `BRD.md` Epic 15 — 5 lens stories

---

### D19 — MCP as likely agent interop protocol

**Status:** DECIDED (2026-04-24)

**Context.** The industry has consolidated on MCP (Model Context Protocol) through 2025–2026. IDE clients (Claude Code, Cursor, Windsurf, Codex, Aider) and web clients (claude.ai connectors, ChatGPT) support it.

**Decision.** Reference implementation uses MCP. Specification describes protocol-agnostically so that future standards shifts don't orphan the design.

**Rationale.** Standards consolidation means one protocol can reach all composer clients. Future-proofing via abstraction ensures Atelier isn't MCP-specific forever.

---

### D20 — Triage never auto-merges

**Status:** DECIDED (2026-04-24)

**Decision.** External-sourced content (comments from published-doc/delivery/design) never auto-merges to canonical state. Triage produces `kind=proposal` contributions that require explicit human approval.

**Rationale.** External input is unsanitized. Auto-merging it violates the authority model.

**Impact:**
- `BRD.md` US-9.7, US-13.5 — triage sandbox stories
- `../architecture/ARCHITECTURE.md` §7.5 — security

---

### D21 — Figma as feedback surface, not design source

**Status:** DECIDED (2026-04-24)

**Context.** Previous framing treated Figma as design source-of-truth. User corrected: "figma should not own the design, it is just the surface for feedback."

**Decision.** Design components live in the prototype (repo). Figma receives projections; comments on projections flow back through triage.

**Rationale.** Repo-as-canonical applies to design too. Figma is to design as Confluence is to BRDs — feedback surface, not authority.

**Impact:**
- `../methodology/METHODOLOGY.md` §2 — prototype is canonical design
- `PRD.md` §4.10 — Figma as projection target

---

### D22 — Switchman as dependency for file-level locks

**Status:** DECIDED (2026-04-25). Own-implementation. See ADR-026.

**Context.** Switchman (MIT-licensed, MCP-native, supports Claude Code/Cursor/Codex/Windsurf/Aider/Cline) was the leading candidate to satisfy Atelier's lock primitive without own-implementation work. The original assumption — that Switchman exposes fencing tokens — turned out to be false on review of the public source.

**Alternatives:**
1. Integrate Switchman — saves ~2 weeks; inherits roadmap risk (rejected).
2. Build own (adopted).

**Evaluation findings (2026-04-25, against `github.com/switchman-dev/switchman`):**

| Criterion | Result | Notes |
|---|---|---|
| License | ✓ MIT | Compatible with Atelier's OSS distribution |
| MCP-native | ✓ | Native MCP tool surface |
| Fencing tokens in public API | ✗ | Lease + `scope_pattern` + `subsystem_tags` model; no monotonic per-resource counter exposed |
| API stability | ✗ | v0.1.28 (in 6 weeks), no semver commitment, "early access" status |
| Maintainer health | ⚠ | Solo (`seanwessmith` + automation account), created 2026-03-10 |
| Tool surface alignment | ✗ | 15+ tools centered on file-write (`switchman_write_file`, `_append_file`, etc.); competes with ADR-005's repo-first principle |

**Decision.** Atelier owns the lock + fencing implementation in M2 (`../strategic/BUILD-SEQUENCE.md`). Switchman's `scope_pattern + subsystem_tags` model is taken as **validation** of the territory-as-scope-pattern shape (D14/ADR-014); we borrow validation, not code.

**Rationale.** ADR-004 makes fencing tokens mandatory on every lock from v1 — specifically to handle the stale-holder-comeback case where a partitioned session returns and tries to write to an artifact whose lease was reassigned. A lease-only model (TTL + stale-wave recovery) is sophisticated but not equivalent: without a monotonic token enforced at the storage layer, the late writer can still corrupt artifacts. Integrating Switchman would either (a) require layering fencing on top — defeating the integration's value, or (b) accept the gap — violating ADR-004.

**Re-evaluation trigger.** If Switchman ships 1.0 with an explicit fencing-token API and a semver commitment, re-open D22 with a new ADR.

**Impact on downstream docs:**
- `../strategic/BUILD-SEQUENCE.md` M2 — own-implementation of lock subsystem confirmed
- `BRD-OPEN-QUESTIONS.md` §2 — RESOLVED
- `../architecture/decisions` — ADR-026

---

### D23 — Identity service default

**Status:** DECIDED (2026-04-25). Default: **Supabase Auth**, override via `.atelier/config.yaml: identity.provider`. See ADR-028.

**Context.** Atelier requires per-composer signed tokens (ARCH §7.1). Three options on the table per BRD-OPEN-QUESTIONS §5: self-hosted OIDC (heavy ops), external provider default (clean but adds a vendor), BYO with a default. Resolution is a sub-decision of D31/ADR-027 (reference stack pick).

**Alternatives considered:**
1. Self-hosted Keycloak / Hydra (rejected — too heavy for a v1 reference default).
2. Auth0 or Clerk as default (rejected — adds a second managed dependency on every deploy alongside the datastore).
3. Supabase Auth as default; BYO via OIDC federation for SSO-having teams (adopted).

**Decision.** Supabase Auth is the default identity provider. Teams override with any OIDC-compliant provider via `.atelier/config.yaml: identity.provider`.

**Rationale.** Once Supabase is the datastore (D31), Supabase Auth ships with it — signed JWTs match ARCH §7.1, RLS integration is native (ARCH §5.3), OIDC federation supports SSO. A separate identity provider would add operational surface for no v1 benefit. BYO framing preserves the template-and-protocol-first posture: don't force teams to swap a working identity layer.

**Re-evaluation triggers.** Supabase Auth deprecation, JWT-claim breaking change, or >50% of `atelier init` users overriding the default.

**Impact on downstream docs:**
- `../architecture/ARCHITECTURE.md` §7.1 — references the default explicitly; capability stays vendor-neutral
- `.atelier/config.yaml` — `identity:` section with `provider: supabase-auth` default
- `../architecture/decisions` — ADR-028
- CLI gains `atelier identity provision`

---

### D24 — Embedding model default for fit_check

**Status:** OPEN

**Decision pending.** Default model choice for fit_check vector index. Candidates:
- OpenAI `text-embedding-3-small` (adequate, cheap, external API)
- Cohere Embed v3 (adequate, external)
- Self-hostable models (e.g., BGE-large-en) — eliminates external AI dependency for self-host compliance

**Recommendation.** Benchmark ≥3 options on the eval set before default choice. Swappability is the constraint, not the default.

---

### D25 — Naming: Atelier

**Status:** DECIDED (2026-04-24)

**Context.** Alternative names considered: `Hivemind OS` (rejected — OS/platform coding is wrong shape; also Hive is the existing project), `Hive` on its own (serviceable but too narrow-coded), `Commons` (too generic), `Loom`, `Workbench`.

**Decision.** `Atelier`.

**Rationale.** Names the actual thing — a shared studio where contributors work on one canonical artifact. Avoids "platform/OS" vocabulary that fights the scope boundaries. Vocabulary is coherent: the unit is `contribution`, the verb is `contribute`, the place is `atelier`.

**Impact.** All doc headers, CLI command, package name, template naming.

---

### D26 — Multi-trace-ID support on contributions and decisions

**Status:** DECIDED (2026-04-24). See ADR-021.

**Context.** Surfaced by the analyst-week-1 walk (`walks/analyst-week-1.md` Gap #4). `contributions.trace_id` and `decisions.trace_id` were singular; cross-cutting work (research touching US-1.3 and US-1.5, decisions affecting two epics) had no clean representation.

**Alternatives considered:**
1. Convert both columns to `text[]` with GIN index (adopted).
2. Keep singular; force splits into separate rows (rejected — fragments rationale, breaks `WHERE trace_id='X'` query semantics).
3. Many-to-many `contribution_traces` table (rejected — adds a join for marginal benefit).

**Decision.** Both columns become `text[]`. Singular case is one-element. Endpoint tools accept either form.

**Rationale.** Smallest schema change that supports the real shape of work. Reversal cost bounded (drop the array, keep first element).

**Impact on downstream docs:**
- `../architecture/ARCHITECTURE.md` §5.1, §5.2 — schema and indexes
- `../strategic/NORTH-STAR.md` §5 — endpoint signatures
- `../architecture/decisions` — ADR-021

---

### D27 — `claim` atomic-creates open contributions

**Status:** DECIDED (2026-04-24). See ADR-022.

**Context.** Surfaced by the analyst-week-1 walk (`walks/analyst-week-1.md` Gap #1). Ad-hoc analyst research had no pre-existing `open` contribution to claim, but the 12-tool surface (D13/ADR-013) has no `create_contribution`.

**Alternatives considered:**
1. Overload `claim` with `contribution_id=null` for atomic create-and-claim (adopted).
2. Add `create_contribution` (rejected — would push surface to 13 tools, requires amending ADR-013).
3. Repo-commit-only creation (rejected — friction for web-locus composers).
4. Overload `update` instead of `claim` (rejected — less semantically clean).

**Decision.** `claim` overloads to atomic-create-and-claim when called with `contribution_id=null` plus `kind`, `trace_ids`, `territory_id`, optional `content_stub`.

**Rationale.** Keeps the 12-tool surface intact (D13/ADR-013), makes create+claim transactional, matches how analyst-locus work actually flows.

**Impact on downstream docs:**
- `../strategic/NORTH-STAR.md` §5 — `claim` signature note
- `../architecture/ARCHITECTURE.md` §6.2 — contribution lifecycle adds create-and-claim path
- `../architecture/decisions` — ADR-022

---

### D28 — Remote-locus commits via per-project endpoint git committer

**Status:** DECIDED (2026-04-24). See ADR-023.

**Context.** Surfaced by the analyst-week-1 walk (`walks/analyst-week-1.md` Gap #2). ARCH §6.2 implied agents write to artifacts, but a web-locus analyst has no local filesystem — the endpoint must commit on their behalf, with identity, signing, failure handling, and sync timing unspecified.

**Alternatives considered:**
1. Per-project endpoint git committer with composer co-authorship; synchronous commit; failure rolls back datastore (adopted).
2. Async queue: write datastore first, eventual commit (rejected — diverges repo and datastore, violates D5/ADR-005).
3. Browser pushes with composer's GitHub credentials (rejected — collides with the goal of analysts who don't touch the repo).

**Decision.** Endpoint holds a project-scoped deploy key (rotatable). Commits authored as `<composer.display_name> via Atelier <atelier-bot@<project>>` with `Co-Authored-By: <composer email>`. `update` blocks until commit succeeds.

**Rationale.** Preserves attribution, keeps repo-first semantics (D5/ADR-005), bounds failure to retry-safe states.

**Impact on downstream docs:**
- `../architecture/ARCHITECTURE.md` §7.8 — new section
- `../architecture/decisions` — ADR-023
- CLI gains `atelier rotate-committer-key` subcommand

---

### D29 — Transcripts as repo-sidecar files, opt-in by config

**Status:** DECIDED (2026-04-24). See ADR-024.

**Context.** Surfaced by the analyst-week-1 walk (`walks/analyst-week-1.md` Gap #3 / Q3). Transcripts have provenance, eval-feedback, and audit value but carry size and PII risk.

**Alternatives considered:**
1. Sidecar in repo, opt-in via config (adopted).
2. External blob store (rejected — adds infra dependency on every deploy).
3. Don't capture; rely on agent client's own session history (rejected — loses cross-locus story).

**Decision.** Schema gains `contributions.transcript_ref text` (nullable). Capture is opt-in via `.atelier/config.yaml: transcripts.capture: false` (default). Sidecars are gitignored by default; opt-in commits them under a documented PII review.

**Rationale.** Repo-first (D5/ADR-005), team choice on capture, no forced infra dependency.

**Impact on downstream docs:**
- `../architecture/ARCHITECTURE.md` §5.1 — schema gains `transcript_ref`
- `.atelier/config.yaml` — `transcripts:` section
- `../methodology/METHODOLOGY.md` — PII review documentation (pending)
- `../architecture/decisions` — ADR-024

---

### D30 — Review routing keyed by `territory.review_role`

**Status:** DECIDED (2026-04-24). See ADR-025.

**Context.** Surfaced by the analyst-week-1 walk (`walks/analyst-week-1.md` Gap #5 / Q4). `../strategic/NORTH-STAR.md` §4 lens definitions partially covered review surfaces but did not specify which lens picks up which `kind × state` combination.

**Alternatives considered:**
1. Per-territory `review_role` field (adopted).
2. Per-kind global rules in `.atelier/config.yaml` (rejected — competes with territory ownership).
3. Routing as a contract that lenses subscribe to (rejected — heaviest, deferred until needed).

**Decision.** `.atelier/territories.yaml` schema gains `review_role` per territory entry. Lenses query union of (territories owned by composer's role) and (territories with `review_role` matching composer's role).

**Rationale.** Smallest change. Reuses existing territory-as-config pattern. Avoids global rule tables that compete with territory ownership.

**Impact on downstream docs:**
- `../strategic/NORTH-STAR.md` §4 — lens routing note
- `.atelier/territories.yaml` — schema change with defaults
- `../architecture/decisions` — ADR-025

---

### D31 — Reference implementation stack: GitHub + Supabase + Vercel + MCP

**Status:** DECIDED (2026-04-25). See ADR-027.

**Context.** ADR-012 keeps Atelier's architecture capability-level (no vendor lock-in), but the reference implementation needs a concrete stack. The "evolve hackathon-hive in place" direction (strategic conversation, 2026-04-24) implied Supabase + Vercel + MCP since hackathon-hive runs on it today; this decision formalizes that as the v1 reference and resolves the per-capability vendor mapping for all 10 capabilities in `../strategic/NORTH-STAR.md` §13.

**Alternatives considered:**
1. **Adopt hackathon-hive's stack** (Supabase + Vercel + MCP) and fill the v1 gaps in place (adopted).
2. **Greenfield stack pick** (e.g., Cloudflare D1/Workers + Pinecone + Auth0) — rejected; doubles the work (stack rewrite + methodology fix-up) and discards 60%+ of working hackathon-hive code.
3. **Multi-provider matrix** (separate vendors for each capability, no consolidation) — rejected; adds operational surface and contradicts the "self-hosted, low operational burden" posture.

**Decision.** Reference stack:

| Capability | Choice |
|---|---|
| Versioned file store | GitHub |
| Relational datastore | Supabase Postgres |
| Pub/sub broadcast | Supabase Realtime |
| Identity service | Supabase Auth (D23 / ADR-028) |
| Vector index | pgvector on Supabase |
| Serverless runtime | Vercel Functions |
| Static hosting | Vercel |
| Protocol | MCP (streamable-http) |
| Cron / scheduled | Vercel Cron Jobs |
| Observability sink | OpenTelemetry → local `telemetry` table (default), pluggable external |

**Rationale.** Supabase consolidates four §13 capabilities (datastore + pub/sub + identity + vector) into one managed Postgres surface — RLS-native, GIN-supporting, pgvector-ready. Vercel covers serverless + static + cron with one provider and a tight GitHub integration. The reference impl avoids both vendor sprawl (Cloudflare + Pinecone + Auth0 + Vercel + …) and the "ship your own Postgres" trap. ADR-012 stays intact: each capability remains a vendor-neutral interface in the architecture; this ADR governs only the reference-impl choice.

**Re-evaluation triggers.** Supabase / Vercel pricing-or-policy changes; pgvector p95 degrading past the documented scale envelope (BRD-OPEN-QUESTIONS §7); Atelier ecosystem moving off MCP onto a different agent protocol.

**Impact on downstream docs:**
- `../strategic/BUILD-SEQUENCE.md` M2 onward — implementation targets this stack
- `.atelier/config.yaml` — env-var bindings get reference comments (vendor-neutral; reference-named)
- `../architecture/decisions` — ADR-027 (parent), ADR-028 (identity sub-decision), ADR-029 (portability constraint)
- `../strategic/NORTH-STAR.md` §13 unchanged — capabilities remain vendor-neutral

---

### D32 — Reference impl preserves GCP-portability

**Status:** DECIDED (2026-04-25). See ADR-029.

**Context.** D31/ADR-027 picks Vercel + Supabase as the reference stack. Forward-looking constraint from the stack-pick conversation: GCP migration must remain a viable future option. Without portability discipline, the reference impl accumulates Supabase/Vercel-specific code that compounds migration tax.

**Alternatives considered:**
1. Constrain at v1: avoid proprietary features, wrap the unavoidable in adapters, document the migration mapping (adopted).
2. Use the platforms freely; accept rework if migration happens (rejected — migration cost compounds and is hard to estimate later).
3. Build a full vendor-neutral platform abstraction layer (rejected — over-engineering; ADR-012 already keeps the *architecture* vendor-neutral, this is about the reference-impl discipline).

**Decision.** v1 reference impl uses only features with documented GCP equivalents. The two amber capabilities (Pub/sub Realtime, Auth claims) get thin abstractions; everything else stays standard. A `BroadcastService` interface decouples the endpoint from Supabase Realtime. Auth verification is OIDC-standard. No imports from `@vercel/edge`, `@vercel/kv`, Edge Config, or Supabase RPC helpers outside named adapters.

**Per-capability mapping** — see ADR-029 table for the full Supabase/Vercel ↔ GCP equivalents.

**Rationale.** Constraining now keeps migration cost bounded. The cost of constraint (one interface, a lint rule, a runbook) is small relative to the compounding cost of removing Realtime usages or rewriting Vercel-Edge functions later.

**Re-evaluation triggers.** GCP deprecates Cloud SQL Postgres or Identity Platform; zero migration interest after 12 months; or a Vercel/Supabase-only feature becomes load-bearing for the v1 value prop.

**Impact on downstream docs:**
- `../strategic/BUILD-SEQUENCE.md` M2 — `BroadcastService` interface added to "Produces"
- `../architecture/decisions` — ADR-029
- `docs/migration-to-gcp.md` — runbook ships when M2 lands
- M7 hardening — lint rule banning proprietary imports outside adapters

---

## References

- `../architecture/decisions` — append-only canonical runtime decision log (distinct from this doc)
- `../strategic/NORTH-STAR.md` — the destination these decisions collectively define
- `../strategic/STRATEGY.md` — market / competitive / red team context
- `PRD.md` — product requirements
- `BRD.md` — stories with trace IDs
- `../architecture/ARCHITECTURE.md` — capability-level architecture
