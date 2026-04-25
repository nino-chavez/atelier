# Strategy & Market Context

**Status:** Draft v1.0
**Owner:** Nino Chavez
**Last updated:** 2026-04-24
**Related:** `NORTH-STAR.md` (the destination), `../functional/PRD.md` (what), `../architecture/ARCHITECTURE.md` (how), `../architecture/decisions` (log)

---

## What this doc is

Evidence and framing that backs the scope, positioning, and product-shape decisions in `../functional/PRD.md` and `NORTH-STAR.md`. **Not** a decision record — product decisions live in `../functional/PRD.md` and `../functional/PRD-COMPANION.md`. **Not** a roadmap.

Read this when you want to know *why* Atelier takes the shape it does — why it's OSS not SaaS, why self-hosted not managed, why a template + protocol rather than a product replacement, and why fit_check is the load-bearing bet.

---

## 1. Problem statement

Modern software is increasingly authored by **mixed teams of humans and AI agents**. The default pattern — one human + one agent + one session, writing code in one IDE — is well-served by Claude Code, Cursor, GitHub Copilot, and their peers.

The pattern breaks at two expansions:

1. **Multi-composer on one codebase.** N humans, each with their own agent swarm, editing the same repo concurrently. Agents duplicate each other's work. Merge conflicts multiply. Decision rationale fragments across sessions. No shared memory.
2. **Mixed-locus teams.** Some composers are in IDE + repo (devs). Some are in browser + web agent (analysts, PMs doing research or knowledge work). Some are in design tools (designers). All contributing to the same project; none sharing a canonical coordination surface.

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

Atelier's blackboard, territory, contract, and fit_check primitives overlap with:

| Competitor | Status (Q2 2026) | Overlap | How Atelier differs |
|---|---|---|---|
| **Anthropic Claude Code Agent Teams** | Experimental, flag-gated | Shared task list, file locks, agent messaging | Anthropic owns the agent client. Agent Teams works only with Claude Code. Atelier is client-agnostic (any MCP-capable agent) and locus-agnostic (IDE + web + terminal). |
| **Switchman** | Shipping v0.x, full product by April 2026 | File locks, task queues, merge confidence reviews across Claude Code / Cursor / Codex / Windsurf / Aider. MCP-server-based. | Switchman solves concurrent coding on a codebase. Atelier generalizes to non-code artifacts (strategy, research, design) and mixed loci (web agents as first-class composers). Switchman is plausibly a *dependency* for Atelier's file-level lock primitive. |
| **GitHub Squad + /fleet** | Shipping | Multi-agent on one repo, GitHub-native | GitHub-native; single-provider. Atelier is vendor-neutral and includes non-code territories. |
| **Microsoft Conductor** | Shipping, MIT-licensed | YAML-defined multi-agent workflows, parallel execution, evaluator-optimizer loops | Workflow engine at the agent-execution layer. Atelier coordinates *across* composers each of whom may use Conductor internally. Different abstraction level. |
| **Agentic Workflows** | Shipping | DAG-based agent orchestration | Same layer as Conductor; different positioning. Complementary, not competitive. |
| **CrewAI / AutoGen / LangGraph** | Shipping (mature) | Agent-to-agent orchestration within one composer's swarm | Atelier is one layer up — coordination between multiple composers, each of whom may use these frameworks internally. |
| **OpenClaw Command Center** | Partial | Real-time dashboard for agent framework | Dashboard-only reference. Not a coordination primitive. |

**Verdict on the coordination substrate: genuine category with gaps incumbents haven't closed.** Fit_check (semantic duplicate detection across composers) is novel. Territory + contract model with non-code artifact kinds is novel. Remote-composer (web agent) participation is novel. But Switchman and Agent Teams are closing file-level coordination fast.

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

### 4.2 Round 2 — Coordination substrate (hive) as a SaaS product

**Premise tested:** Build a hosted multi-composer coordination service.

**First-round red team (initial session):** Cited GitHub spec-kit, Linear Agents, Atlassian Rovo Dev, Backstage as competitors. **Verdict was correct for SDLC sync and wrong for coordination.** User pushed back: "I'm not convinced the tools you research actually solve what hackathon-hive solves."

**Second-round red team (focused on coordination):** Revised competitor list to:
- Anthropic Claude Code Agent Teams (experimentally shipped; Anthropic owns the client)
- Switchman (shipping; full product April 2026; MCP-server-based across 5+ clients)
- GitHub Squad + `/fleet` (shipping; GitHub-native)
- Microsoft Conductor (MIT; workflow layer)
- Atlassian Rovo Dev (Atlassian-native)

Resonance doc's original competitive survey was ~1 year stale (dated early 2025); all of the above shipped in the subsequent 12 months.

**Findings:**

1. **Agent Teams and Switchman close file-level coordination.** Both ship concurrent-coding primitives (task claim, file locks) that hackathon-hive's current implementation duplicates.
2. **Non-code coordination is genuinely novel.** No incumbent addresses multi-composer work on non-code artifacts (strategy docs, research, design) via the same substrate. Fit_check on decisions + research is unique.
3. **Mixed-locus support is genuinely novel.** Incumbents assume all composers are on the codebase. Web-agent composers as first-class are not supported anywhere.
4. **Production SaaS cost similar: ~$750k–$1.2M year 1.** Against free incumbents (Agent Teams, Switchman OSS), the math does not work.

**Disconfirming test (both rounds converged):** Build `fit_check` standalone with vector index + labeled eval set. 2-week spike. Target ≥75% precision at ≥60% recall. If it hits, `fit_check` is the commercial wedge. If it misses, Atelier becomes methodology + template + spec.

**Verdict:** Not a standalone SaaS. Publish the schema + agent-endpoint tool surface as a spec ("Atelier Coordination Protocol"). Contribute fit_check and non-code territory contracts to Switchman as PRs/plugins if the test confirms. Don't build SaaS against Switchman/Agent Teams.

---

## 5. Engineering risks inherited from predecessor work

`hackathon-hive` is the working coordination implementation that seeds Atelier's protocol. Real engineering risks flagged during red-team review that Atelier must address from v1:

1. **File locks lack fencing tokens.** Current implementation is Redlock-style distributed mutex. Kleppmann's critique applies literally: a GC pause past TTL causes silent overwrite. Data loss risk. **Atelier ships fencing tokens on every lock from v1; retrofitting later is not an option.**
2. **`fit_check` is specified but not implemented in hackathon-hive MVP.** The single most differentiated primitive is currently vaporware. **Atelier implements fit_check at v1 with the eval harness; it is not deferred.**
3. **"Graceful degradation via decisions.md" is aspirational.** No `decisions.md` writer exists in hackathon-hive; the log lives only in Postgres. **Atelier writes to `decisions.md` first and mirrors to the datastore second; a CI check validates the two stay in sync.**
4. **Single bearer token shared across team; RLS decorative (service role bypasses).** **Atelier uses per-composer signed tokens from v1; service-role bypass is explicitly contained server-side.**

These are not "bugs to fix later." They are design constraints on v1.

---

## 6. Product scope — the verdict

**Atelier is a self-hosted OSS project template + agent interop protocol + reference prototype. Not a SaaS. Not a platform. Not a replacement for any incumbent tool.**

Rationale:

- **Self-hosted keeps teams in control of their own data and infrastructure.** Regulated industries require this. Non-regulated teams benefit from zero vendor lock-in.
- **OSS maximizes adoption leverage.** The methodology and protocol are the IP; hoarding them limits diffusion.
- **Template, not product.** The value is in the scaffolding + convention — what you get after `atelier init` — not in a hosted experience.
- **Protocol, not integration.** Atelier doesn't integrate with each tool individually; it defines the interop protocol that composers (agents + humans) use to participate in a project. Integrations with Jira/Confluence/Figma are straightforward because they're separate from the protocol's core.

**Potential commercial surfaces** (all conditional on fit_check precision holding):

1. Managed fit_check service (hosted vector index + eval harness + precision SLA).
2. Single-focus Forge app for Jira (or equivalent) in the regulated-RTM segment.
3. Consulting / adoption support for enterprise teams.

None of these ship at v1. All are evaluated only after the disconfirming test reports.

---

## 7. The disconfirming test

**Fit_check precision at ≥75% at ≥60% recall on a labeled eval set.**

Both red-team rounds converged on this single test. The eval set ships with the template. The CI gate enforces the threshold. The `atelier eval fit_check` CLI command produces the report.

**If the threshold holds:** Atelier has a defensible commercial wedge. The managed fit_check service becomes a credible offering. The methodology + protocol + reference implementation strategy is complete.

**If the threshold misses:** Atelier still ships as an OSS template + protocol spec + reference implementation. Coordination and sync still work; duplicate-detection becomes a weak suggestion rather than a strong match. The commercial wedge closes; the educational/methodological value remains.

**Either way, every feature in `NORTH-STAR.md` ships.** Fit_check's performance determines the *commercial* story. It does not gate any product feature.

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
- **Hackathon-hive's coordination substrate** — blackboard, task board, decisions, locks — with v1 engineering fixes (fencing tokens, `decisions.md` writer, fit_check implementation)
- **Big-blueprint's prototype-as-canonical-artifact model** — strategy panels, design panels, current-state panels, traceability registry, demo reel
- **bc-subscriptions' reference-implementation pattern** — one repo as source-of-truth, dual-track agile, trace IDs as join keys

---

## 9. Positioning one-liner

> Atelier is the OSS spine for mixed teams of humans and AI agents to author one canonical artifact across IDE, browser, and terminal — without drift, duplication, or vendor lock-in.

---

## 10. Known staleness

- Competitive analysis dated 2026-04-24. The agent-tooling ecosystem moves faster than any single doc can track. Re-audit at least quarterly.
- Cost estimates assume 2026 compute/personnel markets. Re-estimate annually.
- Red team findings reflect the 2026-04-24 session only. Re-run with different stakeholders at least once before major commit (e.g., before building commercial surface).
