# PRD: Atelier

**Status:** Draft v1.0
**Owner:** Nino Chavez
**Last updated:** 2026-04-28 (cross-reference pass: each summary item now points at the canonical home where it is specified, rather than restating spec inline; reduces parallel-summary drift risk per METHODOLOGY section 6.1)
**Related:** `../strategic/NORTH-STAR.md` (destination), `../strategic/STRATEGY.md` (why), `BRD.md` (stories), `../architecture/ARCHITECTURE.md` (how), `PRD-COMPANION.md` (decisions)

---

## 1. Executive summary

Atelier ships as **three open-source engagement tiers** (per ADR-031): a Specification (methodology + 12-tool open protocol), a Reference Implementation (this codebase, designed for the GitHub + Supabase + Vercel + MCP stack per ADR-027), and a Reference Deployment (`atelier init && atelier deploy` once the reference impl ships). All three let mixed teams of humans and AI agents concurrently author a single canonical artifact (the prototype) across different surfaces (IDE, browser, terminal).

The Reference Implementation comprises:
1. A CLI (`atelier`) that scaffolds and operates projects. CLI surface defined in `../strategic/NORTH-STAR.md` section 10; build-order in `../strategic/BUILD-SEQUENCE.md` section 9 Epic 1 sequencing.
2. A repo template with opinionated structure per `../methodology/METHODOLOGY.md` section 6 and ADR-032, scaffolded with starter content for each canonical document (`../strategic/NORTH-STAR.md`, `PRD.md`, `BRD.md`, `../architecture/ARCHITECTURE.md`, per-ADR files in `../architecture/decisions/`), data files (traceability registry), code directories (prototype app, sync scripts), and charter files (`CLAUDE.md`, `AGENTS.md`, `.atelier/*.yaml`).
3. An agent-facing endpoint implementing an open interop protocol with 12 tools per ADR-013; tool flows specified in `../architecture/ARCHITECTURE.md` section 6.
4. A prototype web app that serves as both canonical artifact and coordination dashboard, per ADR-001; component topology in `../architecture/ARCHITECTURE.md` section 4; six-route surface and role-aware lenses per ADR-017.
5. A coordination datastore schema (relational + pub/sub + vector index) for blackboard state, specified in `../architecture/ARCHITECTURE.md` section 5; reference implementation tables on Supabase per ADR-027.
6. An evaluation harness for find_similar with a labeled eval set and CI gate per ADR-006; threshold semantics in `../architecture/ARCHITECTURE.md` section 6.4.1; benchmark plan for the embedding-model default in `../testing/embedding-model-benchmark-plan.md`.
7. A sync substrate per ADR-008 (five scripts shipping together) for bidirectional coherence with external tools; flows in `../architecture/ARCHITECTURE.md` section 6.5; trigger model and round-trip integrity contract in `../../scripts/README.md`.

Atelier does not replace Jira, Linear, Confluence, Notion, Figma, Slack, Claude Code, Cursor, claude.ai, ChatGPT, or any other best-in-class tool. It is the spine that connects them around one project.

---

## 2. Market context

See `../strategic/STRATEGY.md` for full competitive analysis. Summary:

- **SDLC sync substrate market** is commoditized — GitHub Spec-Kit, Linear Agents, Atlassian Rovo Dev collectively occupy ~80% with distribution Atelier cannot match.
- **Coordination substrate market** has genuine gaps — Anthropic Claude Code Agent Teams and Switchman close file-level coordination but do not address non-code territories or mixed-surface teams.
- **Atelier's wedge** is (a) canonical artifact as prototype, (b) non-code territories as first-class, (c) mixed-surface composer participation via web-agent clients, (d) find_similar as load-bearing duplicate-detection primitive.
- **Commercial scope deliberately narrow.** Atelier ships as OSS. Potential commercial surfaces are tracked in [`../strategic/risks.md`](../strategic/risks.md); none ship at v1.

---

## 3. Personas

### 3.1 Dev Composer
- **Surface:** IDE + terminal
- **Agent client:** Claude Code, Cursor, or equivalent MCP-capable IDE agent
- **Primary jobs:** implement slices, maintain architecture, review proposals, participate in decisions
- **Key needs from Atelier:** project context in agent window without tab-hopping; concurrent safety on shared files; awareness of other composers' in-flight work; find_similar on proposals before coding
- **Access:** full repo read/write; full datastore read; datastore writes via session token

### 3.2 Analyst Composer
- **Surface:** Browser
- **Agent client:** claude.ai with MCP remote connectors, ChatGPT, or equivalent web agent
- **Primary jobs:** research market / problem space / personas, author strategic artifacts, review team proposals, ensure research lands durably
- **Key needs:** durable artifact store for agent-session outputs; trace-linked research; read access to current project state; find_similar on research topics before deep dives
- **Access:** repo write via PR proposals only; datastore write scoped to strategy/research territory

### 3.3 PM Composer
- **Surface:** Browser + delivery-tracker UI
- **Agent client:** Light use, typically web agent for brainstorming
- **Primary jobs:** set priorities, approve scope, see progress, unblock decisions
- **Key needs:** cross-surface roadmap view; phase/priority control; delivery-mirror freshness; proposal triage visibility
- **Access:** repo write via PR proposals for priority/phase changes; datastore write scoped to priority/phase territory; delivery-tracker write

### 3.4 Designer Composer
- **Surface:** Design tool (Figma) + browser
- **Agent client:** Web agent or Figma-embedded agent
- **Primary jobs:** author design components, maintain design system, review design feedback, align design with strategy
- **Key needs:** component-level locks; design-as-contract with dev territory; feedback queue from external design tool; prototype components as canonical output
- **Access:** repo write via PR; datastore write scoped to design territory

### 3.5 Stakeholder (read-only composer)
- **Surface:** Browser
- **Agent client:** None required
- **Primary jobs:** review, comment, approve at milestones
- **Key needs:** read-only view of canonical state; comment flow (triaged to proposals); demo reel access
- **Access:** repo read-only; datastore read-only; comment routes through triage

---

## 4. Feature scope

Complete feature set. All features ship at v1 per `../strategic/NORTH-STAR.md` §17. No phasing.

### 4.1 Project lifecycle (Epic 1)

CLI surface defined in `../strategic/NORTH-STAR.md` section 10; per-command stories enumerated in `BRD.md` Epic 11 (US-11.1 through US-11.9); build-order timing in `../strategic/BUILD-SEQUENCE.md` section 9 Epic 1 sequencing.

**Drift note (2026-04-28).** `BUILD-SEQUENCE.md` section 9 has expanded since the original NORTH-STAR section 10 to include `atelier audit` and `atelier review` (commands that operationalize the METHODOLOGY section 11 review process) plus `atelier upgrade`. Reconciliation between NORTH-STAR section 10, BRD Epic 11, and BUILD-SEQUENCE section 9 on the canonical CLI command list is a tracked follow-up (see BRD Epic 11 cross-reference note).

### 4.2 Agent interop endpoint (Epic 2)
Twelve tools across five categories: Session, Context, Contribution, Lock, Decision, Contract. See `../strategic/NORTH-STAR.md` §5.

### 4.3 Canonical artifact — the prototype (Epic 3)

Per ADR-001 the prototype web app serves as both the product artifact and the coordination dashboard. Six-route surface (`/`, `/strategy`, `/design`, `/slices/[id]`, `/atelier`, `/traceability`); role-aware lenses at `/atelier` per ADR-017; live state via pub/sub broadcast topology defined in `../architecture/ARCHITECTURE.md` section 6.8.

### 4.4 Territory + contribution model (Epic 4)

Territory + contract model per ADR-014; contribution-as-atomic-unit per ADR-002; `scope_kind` generalized to five values from day one per ADR-003 (files, doc_region, research_artifact, design_component, slice_config). Schema in `../architecture/ARCHITECTURE.md` section 5.1; territory declarations in `.atelier/territories.yaml`; contribution lifecycle flows in `../architecture/ARCHITECTURE.md` section 6.2; territory contract flow in section 6.6.

### 4.5 Decision durability (Epic 5)

Repo-first per ADR-005; per-ADR file split per ADR-030; append-only at the directory level (new file per ADR; existing files never edited). Four-step atomic operation flow in `../architecture/ARCHITECTURE.md` section 6.3; operational specifics (slug derivation, ADR-NNN allocation, reversal mechanics, push-retry semantics) in section 6.3.1. Graceful degradation: repo write always succeeds even if datastore unreachable.

### 4.6 Find_similar (Epic 6)

Per ADR-006: vector-index-backed semantic search with eval harness and CI gate at ≥75% precision and ≥60% recall. Execution flow in `../architecture/ARCHITECTURE.md` section 6.4; threshold semantics and two-band response in section 6.4.1; corpus composition and embedding lifecycle in section 6.4.2; trace scoping and cross-project isolation in section 6.4.3. Embedding-model default benchmark plan in `../testing/embedding-model-benchmark-plan.md` (D24 must resolve before M5 entry per BUILD-SEQUENCE section 7 question 3). Keyword-search fallback with explicit UI banner per US-6.5.

### 4.7 Lock + fencing (Epic 7)

Fencing tokens mandatory on all locks from v1 per ADR-004; own-implementation rather than Switchman dependency per ADR-026. Lock + fencing semantics in `../architecture/ARCHITECTURE.md` section 7.4; lock granularity / glob semantics / multi-lock per contribution in section 7.4.1; surface-dependent fencing semantics (web hard-validated; IDE soft-coordination + hard-validated at PR-open) in section 7.4.2.

### 4.8 Territory contracts (Epic 8)

Per ADR-014 the territory + contract model extends to non-code artifacts. Contract flow in `../architecture/ARCHITECTURE.md` section 6.6; breaking-change classifier (conservative defaults, publisher override, semver-style versioning) in section 6.6.1; design contract schemas (`design_tokens`, `component_variants`) in section 6.6.2.

### 4.9 Sync substrate — all 5 scripts (Epic 9)

Per ADR-008 all five sync scripts ship together at v1. Triage never auto-merges per ADR-018. Flows in `../architecture/ARCHITECTURE.md` section 6.5 (`publish-docs`, `publish-delivery`, `mirror-delivery`, `reconcile`, `triage`); Figma projection as explicit non-automation in section 6.5.1 (per ADR-019); Figma triage mechanics in section 6.5.2. Trigger-model evolution across milestones and round-trip integrity contract in `../../scripts/README.md`.

### 4.10 External system integrations (Epic 10)

Adapter interface per US-10.2; concrete provider adapters per US-10.3 (Jira, Linear), US-10.4 (Confluence, Notion), US-10.5 (Figma). Sequencing across M1 / M1.5 per `../strategic/BUILD-SEQUENCE.md` section 5: M1 ships interface + GitHub adapter as reference; M1.5 ships the four remaining provider adapters with per-provider runbooks under `docs/user/integrations/`. Compatibility matrix and per-client setup runbooks for MCP-capable agent clients live under `docs/user/connectors/`.

### 4.11 CLI tooling (Epic 11)

Complete CLI surface defined in `../strategic/NORTH-STAR.md` section 10; per-command stories in `BRD.md` Epic 11; build-order timing in `../strategic/BUILD-SEQUENCE.md` section 9. See section 4.1 above for the noted CLI-list drift between NORTH-STAR / BRD / BUILD-SEQUENCE pending reconciliation.

### 4.12 Observability (Epic 12)

Telemetry events emitted by every endpoint call, state transition, and sync run per `../architecture/ARCHITECTURE.md` section 8.1; admin-gated `/atelier/observability` route per section 8.2 (Sessions, Contributions, Locks, Decisions, Triage, Sync, Vector index, Cost lenses); alerting per section 8.3. Token-usage telemetry payload per the BRD-OPEN-QUESTIONS section 8 v1 commitment landed in section 8.1.

### 4.13 Security (Epic 13)

Authentication and authorization model in `../architecture/ARCHITECTURE.md` section 7 (signed tokens 7.1, RLS 7.2, credential isolation 7.3, fencing 7.4 + 7.4.1 + 7.4.2, triage sandboxing 7.5, append-only decisions 7.6, rate limiting 7.7, remote-surface write attribution 7.8 + transcript capture 7.8.1, web-surface auth flow 7.9).

### 4.14 Composer lifecycle (Epic 14)

Session lifecycle in `../architecture/ARCHITECTURE.md` section 6.1 (register, heartbeat, reaper, deregister); self-verification flow in section 6.1.1; session row cleanup policy in section 6.1.2. Token issuance via `atelier invite` per section 4.1 / Epic 11; token rotation via `atelier invite ... --rotate`.

### 4.15 Role-aware lenses (Epic 15)

Five lenses (analyst, dev, PM, designer, stakeholder) per ADR-017. Lens defaults for `get_context` per `../architecture/ARCHITECTURE.md` section 6.7 (with concrete YAML in `.atelier/config.yaml: get_context.lens_defaults`). Same canonical state, different first-view cuts, different filter presets, different scale budgets.

### 4.16 Remote composer support (Epic 16)

Remote-principal actor class per ADR-009 (web agents as first-class composers). Web-surface auth flow (OAuth 2.1 per MCP spec, Supabase Auth as authorization server, JWT bearer tokens) in `../architecture/ARCHITECTURE.md` section 7.9. Per-project endpoint git committer for remote-surface writes per ADR-023 / section 7.8. Transcript capture as repo-sidecar files per ADR-024 / section 7.8.1. Connector compatibility matrix and per-client setup runbooks in `docs/user/connectors/`.

---

## 5. Scope boundaries — what's OUT

Per `../strategic/NORTH-STAR.md` §14, explicit exclusions so the product does not drift into adjacent categories:

- **Not a SaaS.** Teams self-host.
- **Not an agent framework.** IDE agents and web agents stay in their lanes; Atelier exposes the endpoint, not the agent.
- **Not a workflow engine.** Conductor, LangGraph, CrewAI remain canonical at the workflow layer.
- **Not a task tracker UI.** Jira / Linear remain canonical for delivery tracking.
- **Not a chat app.** claude.ai / ChatGPT remain canonical for agent conversations.
- **Not a code editor.** VS Code / Cursor remain canonical.
- **Not a design tool.** Figma remains canonical for visual design.
- **Not a doc editor.** Confluence / Notion remain canonical for published long-form docs.
- **Not a wiki.** Repo markdown is the knowledge base.
- **Not a messaging platform.** Slack / Teams remain canonical.

---

## 6. Capability requirements (vendor-neutral)

Capability map defined in `../architecture/ARCHITECTURE.md` section 3 (per ADR-012 capability-level architecture; no vendor lock-in). Reference implementation choices (one valid implementation per ADR-027) on Supabase + Vercel + GitHub + MCP; identity default Supabase Auth per ADR-028; GCP-portability constraint per ADR-029.

Summary of required capabilities:

| Capability | Purpose | Example implementations |
|---|---|---|
| Versioned file store | Canonical state for files, branches, webhooks | GitHub, GitLab, Bitbucket |
| Relational datastore with RLS | Blackboard state with per-composer authorization | Postgres-compatible engines |
| Pub/sub broadcast | Real-time push of row changes | Postgres LISTEN/NOTIFY, hosted realtime services |
| Identity service | Signed tokens with role claims | JWT-capable OIDC providers |
| Vector index | Semantic search for find_similar | pgvector, dedicated vector DB |
| Serverless runtime | Stateless HTTP functions | Any FaaS with HTTP ingress |
| Static/edge hosting | Prototype web app | Any CDN with SSR support |
| Agent interop protocol | Standardized tool-call surface | MCP (Model Context Protocol) |
| Cron / scheduled jobs | Reapers, sync, reconcile | Any scheduler |
| Observability sink | Telemetry storage + query | Any append-only store |

Any stack that provides these, deployable behind a single self-hostable command, is a valid Atelier implementation.

---

## 7. Success metrics

### 7.1 Product adoption (leading indicators)
- Projects scaffolded via `atelier init` (target: 50 within 6mo of v1)
- Active sessions per project (target median: ≥2 concurrent composers)
- Contribution state transitions per week per project
- Decisions logged per week per project

### 7.2 Technical health (lagging indicators)
- Find_similar precision ≥75% at ≥60% recall on eval set (CI-gated; red line per ADR-006)
- Sync lag p95 < 60s (publish) / < 24h (mirror) per `BRD.md` Epic 9 NFR
- Lock conflict rate < 2% of acquisition attempts
- Triage accept rate ≥80% (proposals accepted as-is or with minor edits)
- Session reaper rate < 5% (indicates crash recovery, not overload)
- Scale envelope hypotheses in `../testing/scale-ceiling-benchmark-plan.md` section 4 with per-dimension thresholds; benchmark validates incrementally across M2-M6

### 7.3 Commercial
Commercial surfaces are tracked in [`../strategic/risks.md`](../strategic/risks.md), not as v1 PRD scope. None gate v1 features.

---

## 8. Go-to-market

**OSS-first.** Publish the template, protocol, and reference implementation on the primary versioned-file-store platform (likely GitHub). Documentation site hosted on static hosting. Methodology doc published publicly as credibility/consulting artifact.

**No marketing funnel at v1.** Strategic bets that gate any future commercial activity are tracked in [`../strategic/risks.md`](../strategic/risks.md).

**Adoption targets:**
- Solo developers using prototype-as-canonical patterns → drop-in upgrade to Atelier template
- Mixed teams currently suffering from context fragmentation → reference-impl-first adoption
- Enterprise teams with regulated-RTM needs → targeted consultative sales (not self-serve) once managed surface exists

---

## 9. Non-goals

- Replace any existing best-in-class tool in its own domain.
- Build a multi-tenant SaaS platform.
- Provide hosted agent compute.
- Compete with GitHub, Linear, Atlassian, or Microsoft on distribution.
- Ship incomplete feature sets with "Phase 2 coming soon" hedges.

---

## 10. Open questions

See `BRD-OPEN-QUESTIONS.md` for the active list and `PRD-COMPANION.md` for the OPEN/PROPOSED design-decisions staging area. Refer; don't replicate (per the drift-discipline rule in `../methodology/METHODOLOGY.md §6.1`).

---

## 11. References

- `../strategic/NORTH-STAR.md` — complete design scope
- `../strategic/STRATEGY.md` — market + competitive + red team
- `BRD.md` — epics and user stories with trace IDs
- `../architecture/ARCHITECTURE.md` — capability-level architecture
- `PRD-COMPANION.md` — decisions triggered during design
- `../architecture/decisions` — append-only canonical decision log
- `../methodology/METHODOLOGY.md` — how this repo is organized
