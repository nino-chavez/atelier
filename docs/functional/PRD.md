# PRD: Atelier

**Status:** Draft v1.0
**Owner:** Nino Chavez
**Last updated:** 2026-04-24
**Related:** `../strategic/NORTH-STAR.md` (destination), `../strategic/STRATEGY.md` (why), `BRD.md` (stories), `../architecture/ARCHITECTURE.md` (how), `PRD-COMPANION.md` (decisions)

---

## 1. Executive summary

Atelier ships as **three open-source engagement tiers** (per ADR-031): a Specification (methodology + 12-tool open protocol), a Reference Implementation (this codebase, designed for the GitHub + Supabase + Vercel + MCP stack per ADR-027), and a Reference Deployment (`atelier init && atelier deploy` once the reference impl ships). All three let mixed teams of humans and AI agents concurrently author a single canonical artifact (the prototype) across different surfaces (IDE, browser, terminal).

The Reference Implementation comprises:
1. A CLI (`atelier`) that scaffolds and operates projects.
2. A repo template with opinionated structure (`../strategic/NORTH-STAR.md`, `PRD.md`, `BRD.md`, `../architecture/ARCHITECTURE.md`, per-ADR files in `../architecture/decisions/`, traceability registry, prototype app, sync scripts, charter files).
3. An agent-facing endpoint implementing an open interop protocol with 12 tools (per ADR-013).
4. A prototype web app that serves as both canonical artifact and coordination dashboard.
5. A coordination datastore schema (relational + pub/sub + vector index) for blackboard state.
6. An evaluation harness for find_similar with a labeled eval set and CI gate.
7. A sync substrate (per ADR-008) for bidirectional coherence with external tools.

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
- `atelier init <name>` — scaffold repo with full structure, prototype, charter files, traceability registry seed
- `atelier datastore init` — provision coordination datastore with schema
- `atelier deploy` — ship prototype + agent endpoint to serverless runtime + static hosting
- `atelier invite <email> --role <role>` — issue per-composer token with scoped claims
- `atelier territory add <name>` — declare new territory in `.atelier/territories.yaml`
- `atelier doctor` — diagnose project health

### 4.2 Agent interop endpoint (Epic 2)
Twelve tools across five categories: Session, Context, Contribution, Lock, Decision, Contract. See `../strategic/NORTH-STAR.md` §5.

### 4.3 Canonical artifact — the prototype (Epic 3)
Six routes: `/`, `/strategy`, `/design`, `/slices/[id]`, `/atelier`, `/traceability`. Role-aware lenses at `/atelier` (per ADR-017). Live state via pub/sub broadcast from coordination datastore.

### 4.4 Territory + contribution model (Epic 4)
- Territory declaration in `.atelier/territories.yaml`
- Contribution schema with 6 states × 5 kinds
- Per-territory contracts published to datastore and queryable by other territories
- `scope_kind` generalized: files, doc_region, research_artifact, design_component, slice_config

### 4.5 Decision durability (Epic 5)
- `log_decision` writes a new per-ADR file under `../architecture/decisions/` in repo first (per ADR-005, ADR-030), datastore mirror second
- Append-only at directory level (new file per ADR; existing files never edited)
- CI check validates repo/datastore sync on every push
- Graceful degradation: repo write always succeeds even if datastore unreachable

### 4.6 Find_similar (Epic 6)
- Vector-index-backed semantic search over decisions, contributions, BRD/PRD sections, research artifacts
- Labeled eval set at `atelier/eval/find_similar/*.yaml`
- `atelier eval find_similar` reports precision/recall
- CI gate at ≥75% precision, ≥60% recall (per ADR-006)
- Composer accept/reject feeds back to eval
- Keyword-search fallback with explicit UI banner

### 4.7 Lock + fencing (Epic 7)
- `acquire_lock` returns monotonic fencing token per lock
- Every write to locked artifact must include token
- Token validated server-side; stale tokens rejected
- TTL default 2h, extendable via heartbeat
- Reaper releases expired locks and reassigns contributions

### 4.8 Territory contracts (Epic 8)
- `publish_contract(territory, schema)` — territory declares typed interface
- `get_contracts(territory)` — consumers read current contracts
- Pub/sub broadcasts contract changes to subscribed territories
- Contract-breaking changes require cross-territory proposal + human approval

### 4.9 Sync substrate — all 5 scripts (Epic 9)
- `publish-docs` — repo → published-doc system
- `publish-delivery` — repo → delivery tracker
- `mirror-delivery` — delivery tracker → registry (nightly)
- `reconcile` — bidirectional drift detector (reports only)
- `triage` — external comments → proposal contributions (never auto-merge)

### 4.10 External system integrations (Epic 10)
- Git-provider webhook handlers
- Delivery-tracker REST client
- Published-doc REST client
- Design-tool API client + webhook
- Messaging webhook publisher

### 4.11 CLI tooling (Epic 11)
Complete CLI surface per `../strategic/NORTH-STAR.md` §10.

### 4.12 Observability (Epic 12)
Admin-gated `/atelier/observability` sub-route. Telemetry for every action: session heartbeats, contribution transitions, lock ledger, find_similar match rate, triage accuracy, sync lag, vector-index health.

### 4.13 Security (Epic 13)
Per-composer signed tokens, row-level authorization, append-only decision writes, fencing tokens, session reaper, triage sandbox, server-side credential isolation.

### 4.14 Composer lifecycle (Epic 14)
Invite flow, token issuance with role claims, heartbeat protocol, deregister + resource release, token rotation.

### 4.15 Role-aware lenses (Epic 15)
Five lenses over shared state: analyst, dev, PM, designer, stakeholder. Same canonical state, different first-view cuts, different filter presets, different scale budgets.

### 4.16 Remote composer support (Epic 16)
Remote MCP transport hardened for web agent clients. Auth token propagation via browser-safe mechanisms. Non-code territory primitives (doc_region, research_artifact) with durable artifact storage.

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

Atelier requires these capabilities from whatever stack implements it:

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
- Find_similar precision ≥75% at ≥60% recall on eval set (CI-gated; red line)
- Sync lag p95 < 60s (publish) / < 24h (mirror)
- Lock conflict rate < 2% of acquisition attempts
- Triage accept rate ≥80% (proposals accepted as-is or with minor edits)
- Session reaper rate < 5% (indicates crash recovery, not overload)

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
