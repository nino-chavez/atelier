# Strategy & Market Context

**Status:** Draft v1.0
**Owner:** Nino Chavez
**Last updated:** 2026-04-24
**Related:** `NORTH-STAR.md` (the destination), `../functional/PRD.md` (what), `../architecture/ARCHITECTURE.md` (how), `../architecture/decisions` (log)

---

## What this doc is

Evidence and framing that backs the scope, positioning, and product-shape decisions in `../functional/PRD.md` and `NORTH-STAR.md`. **Not** a decision record — product decisions live in `../functional/PRD.md` and `../functional/PRD-COMPANION.md`. **Not** a roadmap.

Read this when you want to know *why* Atelier takes the shape it does — why it's OSS not SaaS, why self-hosted not managed, why a template + protocol rather than a product replacement, and why the coordination substrate (territories + contracts + locks + claim + broadcast + decisions + repo-canonical, with `find_similar` as one auxiliary capability) is the load-bearing differentiation.

---

## 1. Problem statement

Modern software is increasingly authored by **mixed teams of humans and AI agents**. The default pattern — one human + one agent + one session, writing code in one IDE — is well-served by Claude Code, Cursor, GitHub Copilot, and their peers.

The pattern breaks at two expansions:

1. **Multi-composer on one codebase.** N humans, each with their own agent swarm, editing the same repo concurrently. Agents duplicate each other's work. Merge conflicts multiply. Decision rationale fragments across sessions. No shared memory.
2. **Mixed-surface teams.** Some composers are in IDE + repo (devs). Some are in browser + web agent (analysts, PMs doing research or knowledge work). Some are in design tools (designers). All contributing to the same project; none sharing a canonical coordination surface.

Neither expansion is solved by any production-grade tool as of Q2 2026. Atelier targets both.

---

## 2. Why now

Three structural changes in 2025–2026 make this gap tractable and commercially viable at roughly the same moment:

### 2.1 Agent interop protocol has consolidated

MCP (Model Context Protocol) shipped in late 2024 and by early 2026 was supported by Claude Code, Cursor, Windsurf, Codex, Aider, and — via remote connectors — claude.ai and ChatGPT web clients. For the first time there is a standard way for any agent to call any tool. Before MCP, a multi-agent-surface coordination layer required N×M integrations; after MCP, it requires one server.

### 2.2 Agent client capability has caught up to real knowledge work

Web-based agent clients (claude.ai, ChatGPT with Projects, Gemini Advanced) can now sustain multi-hour knowledge-work sessions with durable context, file attachments, and (via MCP remote connectors) tool calls. The analyst persona — previously able to *read* agent output but not *work within* agentic loops — is now a first-class composer.

### 2.3 The "solo orchestration" segment has saturated

By April 2026, every major editor has agent features; Claude Code ships subagents with worktree isolation; Cursor ships background agents; GitHub Copilot ships Squad. The solo-composer problem is being aggressively commoditized. The next problem — multi-composer coordination — is where the meaningful unsolved work has moved.

---

## 3. Competitive landscape

Two orthogonal markets, analyzed in sequence.

### 3.1 SDLC sync substrate (repo ↔ external systems)

Atelier's sync substrate (`publish-*`, `mirror-*`, `reconcile`, `triage`) overlaps with:

| Competitor | Status (Q2 2026) | Overlap | How Atelier differs |
|---|---|---|---|
| **GitHub Spec-Kit** | Shipping | Substantial — ~60% of the "repo as canonical, external tools as projections" thesis, with GitHub's distribution | Spec-kit is GitHub-centric and doesn't address non-code canonical state (BRD/PRD in markdown, prototype as artifact). Atelier is git-provider-agnostic and explicitly includes strategy/research artifacts in canonical state. |
| **Linear Agents** | Shipping | Delivery-tracker side of the sync | Linear Agents integrate AI into Linear's own workflow. Atelier treats Linear as a delivery-tracker projection of canonical repo state. |
| **Atlassian Rovo Dev** | Shipping | Jira/Confluence-side integration | Rovo is Atlassian-native. Atelier is vendor-neutral — any delivery tracker, any doc system. |
| **ChatPRD** | Shipping | PRD/BRD authoring workflow | ChatPRD is a standalone product authoring tool. Atelier's prototype *is* the canonical artifact; PRD authoring happens in the repo, not in a separate SaaS. |
| **Backstage (Spotify)** | Mature | Developer portal / service catalog | Different problem — Backstage catalogs running services. Atelier coordinates in-flight project work. |

**Verdict on the SDLC sync substrate as a standalone product: commoditized.** GitHub spec-kit plus Linear Agents plus Atlassian Rovo Dev collectively occupy ~80% of this thesis with distribution Atelier cannot match. Atelier's sync substrate is necessary for reference-implementation completeness but is not the commercial wedge.

### 3.2 Coordination substrate (multi-composer on same canonical state)

Atelier's blackboard, territory, contract, and find_similar primitives overlap with:

| Competitor | Status (Q2 2026) | Overlap | How Atelier differs |
|---|---|---|---|
| **Anthropic Claude Code Agent Teams** | Experimental, flag-gated | Shared task list, file locks, agent messaging | Anthropic owns the agent client. Agent Teams works only with Claude Code. Atelier is client-agnostic (any MCP-capable agent) and surface-agnostic (IDE + web + terminal). |
| **Switchman** | Shipping v0.x, full product by April 2026 | File locks, task queues, merge confidence reviews across Claude Code / Cursor / Codex / Windsurf / Aider. MCP-server-based. | Switchman solves concurrent coding on a codebase. Atelier generalizes to non-code artifacts (strategy, research, design) and mixed surfaces (web agents as first-class composers). Switchman is plausibly a *dependency* for Atelier's file-level lock primitive. |
| **GitHub Squad + /fleet** | Shipping | Multi-agent on one repo, GitHub-native | GitHub-native; single-provider. Atelier is vendor-neutral and includes non-code territories. |
| **Microsoft Conductor** | Shipping, MIT-licensed | YAML-defined multi-agent workflows, parallel execution, evaluator-optimizer loops | Workflow engine at the agent-execution layer. Atelier coordinates *across* composers each of whom may use Conductor internally. Different abstraction level. |
| **Agentic Workflows** | Shipping | DAG-based agent orchestration | Same layer as Conductor; different positioning. Complementary, not competitive. |
| **CrewAI / AutoGen / LangGraph** | Shipping (mature) | Agent-to-agent orchestration within one composer's swarm | Atelier is one layer up — coordination between multiple composers, each of whom may use these frameworks internally. |
| **OpenClaw Command Center** | Partial | Real-time dashboard for agent framework | Dashboard-only reference. Not a coordination primitive. |

**Verdict on the coordination substrate: genuine category with gaps incumbents haven't closed.** The substrate as a whole — territories + contracts + atomic claim + fenced locks + broadcast + repo-canonical decisions + per-project committer + the methodology — is the load-bearing differentiation. Within that substrate, several primitives are individually novel: territory + contract model extended to non-code artifact kinds; remote-composer (web agent) participation as first-class; pre-claim file-overlap awareness via `get_context(scope_files)` per ADR-045; semantic similarity across non-code artifacts via `find_similar` (advisory-tier search aid, not the wedge — per ADR-043 + ADR-047). Switchman and Agent Teams are closing file-level coordination fast; Atelier's differentiation is the multi-surface multi-artifact substrate, not any single primitive.

---

## 4. Red team analysis

Two focused red-team rounds were conducted, one per substrate, in the 2026-04-24 strategic-architecture session.

### 4.1 Round 1 — SDLC sync substrate as a SaaS product

**Premise tested:** Build a hosted service that syncs repo ↔ Jira ↔ Confluence ↔ Figma as a managed offering.

**Findings:**

1. **Build cost underestimated ~3–4x.** Initial estimate assumed 22–40 engineer-weeks + 15–25% FTE ongoing. Realistic estimate for a production SaaS: $750k–$1.2M year 1.
2. **Fast-follower risk extreme.** GitHub spec-kit + Linear Agents + Atlassian Rovo Dev collectively ship 80% of the thesis with incumbent distribution. Time to competitive parity from Day 1: ~6–9 months.
3. **Commoditization certain.** The primitives (OAuth flows, REST API integrations, drift detection, webhook triage) are individually cheap. The moat is integration surface, which rewards the largest existing platform, not the novel one.
4. **No defensible moat.** "We sync better" is not a wedge when incumbents are shipping integrations weekly.

**Disconfirming test proposed:** Build Phase 1 `publish-jira.mjs` only, against a real Jira Cloud instance, with a 2-week timebox. If delivering deterministic publish-and-overwrite is materially harder than expected, the whole substrate is harder than expected.

**Verdict:** Not a standalone commercial product. Methodology as public artifact + template as OSS scaffold + optionally a single managed sync-adapter Forge app for Jira in the regulated-RTM segment.

### 4.2 Round 2 — Coordination substrate (guild) as a SaaS product

**Premise tested:** Build a hosted multi-composer coordination service.

**Competitor list (Q2 2026):**
- Anthropic Claude Code Agent Teams (experimentally shipped; Anthropic owns the client)
- Switchman (shipping; full product April 2026; MCP-server-based across 5+ clients)
- GitHub Squad + `/fleet` (shipping; GitHub-native)
- Microsoft Conductor (MIT; workflow layer)
- Atlassian Rovo Dev (Atlassian-native)

**Findings:**

1. **Agent Teams and Switchman close file-level coordination.** Both ship concurrent-coding primitives (task claim, file locks) that overlap with Atelier's lock subsystem.
2. **Non-code coordination is genuinely novel.** No incumbent addresses multi-composer work on non-code artifacts (strategy docs, research, design) via the same substrate. find_similar on decisions + research is unique.
3. **Mixed-surface support is genuinely novel.** Incumbents assume all composers are on the codebase. Web-agent composers as first-class are not supported anywhere.
4. **Production SaaS cost: ~$750k–$1.2M year 1.** Against free incumbents (Agent Teams, Switchman OSS), the math does not work.

**Disconfirming test:** Build `find_similar` standalone with vector index + labeled eval set. 2-week spike. Target ≥75% precision at ≥60% recall. The bet and its fallback path are tracked in [`risks.md`](./risks.md) Bet 1.

**Verdict:** Not a standalone SaaS. Publish the schema + agent-endpoint tool surface as a spec ("Atelier Coordination Protocol"). Contribute find_similar and non-code territory contracts to Switchman as PRs/plugins if the test confirms. Don't build SaaS against Switchman/Agent Teams.

---

## 5. v1 design constraints

Four engineering choices are baked into Atelier's v1 design. They shape the schema, the protocol, and the security model from day one — not as v2 hardenings to apply later.

1. **Fencing tokens on every lock (per ADR-004).** Lease-based mutexes (Redlock-style) are vulnerable to Kleppmann's GC-pause-past-TTL pattern: a holder pauses past lease expiry, returns, and writes after the lease has been reassigned. Atelier ships per-resource monotonic fencing tokens validated server-side on every write to a locked artifact. Cheap at v1, expensive to retrofit.
2. **find_similar at v1 with eval harness (per ADR-006, ADR-042, ADR-043, ADR-047).** Ships as an advisory-tier capability — semantic search aid for "have we discussed this before?" across decisions, contributions, BRD/PRD sections, and research artifacts. Two gate tiers: advisory (P ≥ 0.60 AND R ≥ 0.60; v1 default; informational CI gate) and blocking (P ≥ 0.85 AND R ≥ 0.70; v1.x opt-in gated on cross-encoder reranker per BRD-OPEN-QUESTIONS §27). Advisory clearance is corpus-dependent — adopters run the harness against their own corpus to learn whether they sit above or below the tier. The substrate-as-a-whole (per §4 verdict above) is the load-bearing differentiation; find_similar is one capability within it. Pre-claim file-overlap awareness is `get_context(scope_files)`'s job per ADR-045, not find_similar's.
3. **Decisions write repo-first (per ADR-005, ADR-030).** Graceful degradation requires the rationale archive to survive a coordination-datastore outage. `log_decision` writes a per-ADR file under `../architecture/decisions/` first; the datastore mirror is a read-model. A CI check validates the two stay in sync.
4. **Per-composer signed tokens; no shared bearer (per ARCH §7.1).** Single shared bearer tokens make audit attribution impossible and reduce RLS to decoration (service-role bypass becomes too easy). Per-composer signed tokens from v1; service-role bypass is contained server-side.

**Provenance.** All four were surfaced during red-team review of predecessor coordination work. The patterns themselves are well-established in distributed-systems literature; the predecessor experience made the cost of skipping them concrete.

---

## 5.5 The coordination pattern is well-validated

Atelier is not inventing a coordination model — it's applying a proven one to mixed human-agent software teams. The same architectural primitives (canonical-state-as-dashboard, named domains with handoff contracts, atomic units of work, locks against silent overwrite, triage of external inputs) appear in every high-stakes multi-actor coordination domain:

| Domain | Canonical-state-as-dashboard | Named domain | Atomic unit | Lock-against-overwrite | Triage of external input |
|---|---|---|---|---|---|
| **Emergency room** | EMR + track board | Bay (Trauma, Cards) | Order / intervention | Med reconciliation token | Paramedic radio / clinic records |
| **Air traffic control** | Strip board / ScreenWatch | Sector | Flight strip | Separation rules | Initial contact handoff |
| **Restaurant brigade** | The pass | Station (sauté, grill) | Ticket | Ticket sequencing | Front-of-house orders |
| **Newsroom** | Editorial budget | Beat (politics, sports) | Story slot | Editorial hold | Wire desk |
| **Atelier** | Prototype + `/atelier` | Territory | Contribution | Fencing token | Comment triage |

The mapping is unusually clean because the underlying problem-shape — multi-actor concurrent authoring on shared canonical state with handoff contracts, audit requirements, and silent-overwrite hazards — is invariant across these domains. Atelier's job is to instantiate the pattern for software teams; the architectural primitives are inherited from a long history of practical coordination in higher-stakes domains.

This also explains why our vocabulary is what it is — `triage` is a direct loan from medicine, `blackboard` from multi-agent AI literature, `lens` from optical metaphor — the terms come from where the underlying patterns were first solved.

---

## 6. Product scope — the verdict

**Atelier ships as three open-source engagement tiers (per ADR-031): a Specification (methodology + 12-tool protocol), a Reference Implementation (this codebase, designed for the GitHub + Supabase + Vercel + MCP stack per ADR-027), and a Reference Deployment (`atelier init && atelier deploy`). Not a SaaS. Not a platform. Not a replacement for any incumbent tool.**

Rationale:

- **Self-hosted keeps teams in control of their own data and infrastructure.** Regulated industries require this. Non-regulated teams benefit from zero vendor lock-in.
- **OSS maximizes adoption leverage.** The methodology and protocol are the IP; hoarding them limits diffusion.
- **Template, not product.** The value is in the scaffolding + convention — what you get after `atelier init` — not in a hosted experience.
- **Protocol, not integration.** Atelier doesn't integrate with each tool individually; it defines the interop protocol that composers (agents + humans) use to participate in a project. Integrations with Jira/Confluence/Figma are straightforward because they're separate from the protocol's core.

**Potential commercial surfaces** (none ship at v1; each depends on a strategic bet tracked in [`risks.md`](./risks.md)):

1. Managed find_similar service — depends on Bet 1 (find_similar precision).
2. Single-focus Forge app for Jira in the regulated-RTM segment — depends on Bet 2 (regulated-RTM segment exists).
3. Consulting / adoption support for enterprise teams.

---

## 7. The find_similar gate-tier split (post-M5 calibration)

The original ADR-006 specification framed find_similar with a single CI gate at ≥75% precision and ≥60% recall, treating both clearance as the load-bearing strategic bet. M5 measurement (P=0.672, R=0.626 on Atelier's own corpus with hybrid retrieval + multi-author seeds, per ADR-042) and the subsequent M6 strategic re-evaluation produced two corrections:

1. **Gate-tier split (per ADR-043).** The original 0.75/0.60 threshold is now the *blocking-tier* target (hands-off duplicate prevention; v1.x opt-in; gated on cross-encoder reranker per BRD-OPEN-QUESTIONS §27). The v1 *advisory tier* sits at ≥0.60/≥0.60 — empirically achievable, ships at v1 default, surfaces warnings in claim flows + PR comments + `/atelier` panels but does not block.

2. **Wedge-framing demotion (this section's revision).** The original framing of find_similar as "the load-bearing strategic bet" overstated what the capability delivers at v1 quality. The substrate as a whole is the wedge (per §4 verdict). find_similar is one auxiliary capability — useful as an advisory search aid for "have we discussed this kind of thing before?" — not the differentiated primitive in its own right. The CI gate is informational at v1 (see implementation in `.atelier/config.yaml: find_similar.ci_gate.enabled` + `.github/workflows/atelier-audit.yml`); blocking activation is opt-in for adopters who wire the cross-encoder reranker.

The eval set still ships with the template. The `atelier eval find_similar` CLI command still produces the precision/recall report. Whether the *blocking-tier* threshold is achievable with M7 polish (cross-encoder reranker landing) and what changes about Atelier's commercial story if it isn't is tracked in [`risks.md`](./risks.md) Bet 1; the spec stands regardless. What changes is which surface within the substrate the commercial path foregrounds — not the feature scope.

---

## 8. What Atelier replaces and does not replace

### Replaces
- **Nothing.** Every external tool remains canonical for its thing.

### Augments
- **Jira / Linear** with bidirectional sync and repo-canonical discovery fields
- **Confluence / Notion** with repo-canonical BRD/PRD and comment triage
- **Figma** as a feedback surface for a canonical prototype built elsewhere
- **Claude Code / Cursor** with project-context-on-demand via the agent endpoint
- **claude.ai / ChatGPT** with remote MCP access to the same project context

### Absorbs (as explicit design)
Atelier evolved from prior work on coordination substrates, prototype-as-canonical-artifact, and reference-implementation patterns for dual-track agile. See [`../methodology/METHODOLOGY.md §6.1`](../methodology/METHODOLOGY.md) for the doc-organization provenance.

---

## 9. Positioning one-liner

> Atelier is the OSS spine for mixed teams of humans and AI agents to author one canonical artifact across IDE, browser, and terminal — without drift, duplication, or vendor lock-in.

---

## 10. Known staleness

- Competitive analysis dated 2026-04-24. The agent-tooling ecosystem moves faster than any single doc can track. Re-audit at least quarterly. Recent partial re-audit: `addenda/2026-04-28-multi-agent-coordination-landscape.md` (covers Maggie Appleton's talk + GitHub Next project survey; recommendations pending action).
- Cost estimates assume 2026 compute/personnel markets. Re-estimate annually.
- Red team findings reflect the 2026-04-24 session only. Re-run with different stakeholders at least once before major commit (e.g., before building commercial surface).

---

## 11. Addenda

Time-stamped analyses that inform strategic positioning without modifying this canonical document live in [`addenda/`](addenda/). Each addendum is a snapshot of inputs (competitive scans, talks, papers, market signals) at a moment in time; this document absorbs durable conclusions through normal PR cadence. See [`addenda/README.md`](addenda/README.md) for the pattern.
