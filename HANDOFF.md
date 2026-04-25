# HANDOFF — Pick this up in a new session

**Written:** 2026-04-24
**Session:** Initial strategic synthesis (design only, no code)
**Owner:** Nino Chavez

Read this first. It gets you oriented in under 5 minutes without re-reading every doc.

---

## What Atelier is (one paragraph)

**A self-hostable OSS project template + agent interop protocol + reference prototype** where mixed teams of humans and AI agents concurrently author one canonical artifact (the prototype) across different loci (IDE, browser, terminal). Not a SaaS. Not an agent framework. Not a replacement for Jira/Linear/Confluence/Figma. Atelier is the **spine** that connects existing best-in-class tools around one project so mixed teams can work concurrently without drift.

Origin: synthesizes `bc-subscriptions` (reference impl of big-blueprint methodology), `hackathon-hive` (working coordination substrate), `ai-hive` (architecture spec), and `big-blueprint` (methodology template) into one design with corrections applied from red-team analysis.

---

## Current state

- **Phase:** Pre-implementation. Design scope captured + analyst-case walk completed (5 design ADRs landed). Zero code.
- **Scaffold:** ~22 files, ~5000 lines of docs + config in this directory.
- **Git:** initialized, public remote at `Signal-x-Studio-LLC/atelier`, two commits on `main`.
- **Immediate next step:** Pick the reference-implementation stack (Option D below) or begin M1 of `BUILD-SEQUENCE.md` (SDLC sync substrate). The schema design is now stable — analyst-week-1 walk closed the open territory questions.

---

## Read-order for a fresh session

**Fast path (under 15 min):**
1. This file (`HANDOFF.md`)
2. `README.md` — vocabulary + doc map
3. `NORTH-STAR.md` — the complete destination spec

**Full context (under 1 hour):**
4. `STRATEGY.md` — why this shape (market, competitive, red-team, verdict)
5. `PRD-COMPANION.md` — the 25 design decisions and their rationale
6. `METHODOLOGY.md` — how this repo applies Atelier to itself
7. `BRD-OPEN-QUESTIONS.md` — the 15 open items (focus on top 3)

**Reference (as needed):**
- `PRD.md`, `BRD.md`, `ARCHITECTURE.md`, `DECISIONS.md`

---

## The irreducible bet (don't forget this)

**Fit_check precision at ≥75% at ≥60% recall on a labeled eval set.** This is the disconfirming test for any commercial surface. It ships at v1 with the eval harness and CI gate regardless of precision outcome. If precision holds → commercial wedge exists (managed fit_check). If it misses → Atelier remains OSS template + protocol spec + reference implementation. **Either way, every feature in `NORTH-STAR.md` ships.** Fit_check performance determines the commercial story, not the feature scope.

---

## Load-bearing decisions (don't re-litigate without a new red team)

The 25 ADRs in `DECISIONS.md` represent choices made across multiple session iterations, often after explicit user corrections (the last 5 surfaced from the analyst-case walk on 2026-04-24, see `walks/analyst-week-1.md`). Before challenging any of them, read the ADR's rationale + the corresponding entry in `PRD-COMPANION.md`. If you still think a change is warranted, propose a new decision that references and reverses the prior ADR — don't silently modify the earlier choice.

Shortlist grouped by "this will bite you if you forget":

**Scope guardrails** (most likely to be accidentally violated):
- **ADR-007** — No SaaS. Self-hosted OSS only.
- **ADR-010** — Explicit exclusions: not a workflow engine, task tracker UI, chat app, code editor, design tool, doc editor, wiki, or messaging platform.
- **ADR-011** — Destination-first design. No feature deferral in design docs. No "Phase 2" or "coming soon."
- **ADR-012** — Capability-level architecture. No vendor names in arch docs.

**Structural model** (changes cascade if you violate):
- **ADR-001** — Prototype is canonical artifact AND coordination dashboard. One web app, five routes including `/atelier`.
- **ADR-002** — Contribution is the atomic unit. One schema subsumes tasks, decisions, proposals, PRs.
- **ADR-003** — `scope_kind` generalized from day one (files, doc_region, research_artifact, design_component, slice_config).
- **ADR-016** — Two orthogonal substrates (SDLC sync + coordination). Don't conflate them.
- **ADR-019** — Figma is feedback surface only. Design lives in the prototype (repo-canonical).

**Safety / durability** (silent violations cause data loss):
- **ADR-004** — Fencing tokens on every lock from v1. Never ship locks without fencing.
- **ADR-005** — Decisions write to `decisions.md` first, datastore second. Repo is authoritative.
- **ADR-018** — Triage never auto-merges. External content requires human approval.

**Protocol / architecture**:
- **ADR-013** — 12 tools, exactly. Protocol-agnostic spec (MCP is the v1 reference).
- **ADR-014** — Territory + contract model extended to non-code artifacts.
- **ADR-015** — One hive, many projects (plural schema from v1).

**Personas / actors**:
- **ADR-009** — Remote-principal actor class. Web agents are first-class composers, not second-class reviewers.
- **ADR-017** — Five role-aware lenses at `/atelier`: analyst, dev, PM, designer, stakeholder.

**Process**:
- **ADR-008** — All 5 sync substrate scripts ship together.

**Naming**:
- **ADR-020** — Atelier. Rejected: Hivemind OS (platform-coded), Hive (too narrow), Commons (too generic).

**Walk-derived (added 2026-04-24, see `walks/analyst-week-1.md`):**
- **ADR-021** — Multi-trace-ID support on contributions and decisions (`text[]` with GIN index).
- **ADR-022** — `claim` atomic-creates open contributions when called with `contribution_id=null`.
- **ADR-023** — Remote-locus commits via per-project endpoint git committer (ARCH §7.8).
- **ADR-024** — Agent-session transcripts as repo-sidecar files, opt-in by config.
- **ADR-025** — Review routing keyed by `territory.review_role`.

---

## Corrections that happened mid-session (context for why certain choices are locked)

These are the three structural corrections the user made during the initial session that shaped the final design. A fresh session that re-introduces any of these will be wrong:

1. **Hive is NOT narrow.** Early framing treated multi-composer concurrency as a specialized primitive ("only when two devs code the same files"). User correction: "we absolutely need concurrent brainstorming and development. it's why we build hackathon-hive and hive-dashboard from the ai-hive architecture document." Hive is central, not narrow.
2. **Figma does NOT own the design.** Early framing treated Figma as a design source-of-truth. User correction: "figma should not own the design, it is just the surface for feedback." Design lives in the prototype components (repo-canonical). Figma is a projection/feedback surface like Confluence is for BRDs.
3. **Big-blueprint IS the prototype.** Early framing separated "the methodology" from "the prototype." User correction: "the point of big-blueprint is to be the prototype so we would enhance it for collaboration capabilities." The prototype is the canonical artifact; the methodology is how the prototype is structured.

The fourth major correction was **no feature deferral**: "nothing should be deferred or future state. north star from the start so we understand the full scope of what needs to be designed. this is the point of blueprint as we learned from a 'feature at a time' approach builds drift that needs to be avoided." This is why `NORTH-STAR.md` specifies every capability at v1 with no phasing language.

---

## Scope boundaries — what NOT to build

A new session will be tempted to build adjacent features. Resist.

Atelier is NOT:
- A SaaS (self-hosted only)
- An agent framework (Claude Code, Cursor, claude.ai stay in their lanes)
- A workflow engine (Conductor, LangGraph, CrewAI stay in their lanes)
- A task tracker UI (Jira, Linear remain canonical for delivery tracking)
- A chat app (claude.ai, ChatGPT remain canonical for agent conversations)
- A code editor (VS Code, Cursor remain canonical)
- A design tool (Figma remains canonical for visual design)
- A doc editor (Confluence, Notion remain canonical for published long-form docs)
- A wiki (repo markdown is the knowledge base)
- A messaging platform (Slack, Teams remain canonical)

If a feature request maps to one of these categories, push back or create a `BRD-OPEN-QUESTIONS.md` entry — don't implement.

---

## Top 3 open items (from `BRD-OPEN-QUESTIONS.md`)

These should be resolved before implementation begins or very early in implementation:

1. ~~**Territory model validation on the analyst case.**~~ **RESOLVED 2026-04-24.** See `walks/analyst-week-1.md`. Five gaps surfaced and landed as ADR-021 through ADR-025. Schema is now stable.
2. **Switchman as dependency vs. own-implementation for file locks.** Evaluate Switchman's public API, fencing-token support, license compatibility, and maintainer health. If stable with fencing, integrate. If not, own-implementation with fencing from v1. (D22 in PRD-COMPANION.) Per `BUILD-SEQUENCE.md §7`, this should be resolved during M1 to derisk M2's lock subsystem.
3. **Embedding model default for fit_check.** Benchmark ≥3 candidates on the seed eval set. Default should prefer a self-hostable option for regulated-team viability. (D24 in PRD-COMPANION.)

---

## Suggested next-session openings (pick one)

Each is ~1–2 hours of focused work.

**Option A — Walk a second scenario (dev-locus or designer-locus).**
The analyst case is closed (`walks/analyst-week-1.md`). The next-most-divergent locus is dev (claims a `files` contribution, acquires a lock, writes via local repo, races a remote-locus committer) or designer (claims a `design_component`, surfaces feedback from Figma via triage, releases through `prototype-design.review_role=designer`).
Prompt: "Walk a dev-week-1 scenario end-to-end through the schema + endpoint + prototype views. Pay attention to lock contention with a concurrent remote-locus composer. Surface any gaps as new ADRs."

**Option B — Resolve open ADRs (Switchman, identity, embedding).**
Prompt: "Resolve `PRD-COMPANION.md` OPEN decisions: D22 (Switchman), D23 (identity service default), D24 (embedding model). For each, produce a concrete recommendation with evidence, then update the decision's status and append a new ADR to `DECISIONS.md`."

**Option C — Implementation planning (build sequencing).**
Initial sketch exists in `BUILD-SEQUENCE.md` (8 milestones M0–M7, with the recursion check as the organizing principle). Open items listed in `BUILD-SEQUENCE.md §7`.
Prompt: "Review `BUILD-SEQUENCE.md`. Resolve the four open questions in §7 (fit_check timing, M3/M4 ordering, M2 subsetting, D22 timing). Validate each milestone's exit criteria are specific enough to know when it's done. Revise the sequence if any revision is warranted, and log a new ADR in `DECISIONS.md` for any consequential reorder."

**Option D — Reference-implementation technology selection.**
Prompt: "ADR-012 says architecture is capability-level. But we need to pick a specific stack for the reference implementation. Recommend concrete choices for each capability in `NORTH-STAR.md §13` (versioned file store, relational datastore, pub/sub, identity, vector index, serverless, static hosting, protocol, cron, observability), with rationale. Document as 'one valid implementation' not 'the architecture.'"

**Option E — User-facing materials (if planning to publish).**
Prompt: "Atelier's commercial story is OSS-first with methodology as credibility artifact. Draft: (1) a positioning one-pager for the methodology, (2) an announcement blog post framing the problem and Atelier's shape, (3) a 'getting started' guide from `atelier init` through first multi-composer session. Match the 'no emoji, no overclaims' voice from other Nino materials."

---

## Predecessors worth knowing about

- `/Users/nino/Workspace/dev/wip/bc-subscriptions/` — reference implementation of big-blueprint methodology. Read `METHODOLOGY.md`, `BRD.md` story format, `traceability.json` structure. Atelier's repo structure mirrors this.
- `/Users/nino/Workspace/dev/wip/big-blueprint/` — the methodology template itself. Currently houses the methodology; Atelier is its successor framing.
- `/Users/nino/Workspace/dev/wip/ai-hive/docs/architecture.md` — the coordination substrate architecture spec. Atelier's blackboard model, 12-tool endpoint surface, territory/contract model inherit from here.
- `/Users/nino/Workspace/dev/wip/ai-hive/docs/document-resonance.md` — resonance analysis showing which ideas converged across research sources. Confirms fit_check as load-bearing primitive.
- `/Users/nino/Workspace/dev/tools/hackathon-hive/` — working coordination implementation (Supabase + Vercel + MCP). Has the fencing-token gap, missing fit_check, and missing decisions.md writer that Atelier fixes at v1.

---

## User's conversational patterns worth preserving

Drawn from the initial session. These affect how to engage:

- **Rejects incrementalism.** "Nothing should be deferred or future state." Phased rollouts in design docs will be rejected. Present complete scope; sequence implementation separately.
- **Pushes back on competitive analyses.** Expect to have competitor lists challenged. Be specific and recent; hedge on things you can't verify.
- **Expects product-architect thinking.** "Who are the users and their personas. what are they doing. where would they do it. then what capabilities are we building ourselves vs integrating with in another system." Lead with users and jobs-to-be-done, not with primitives or data models.
- **Corrects rather than repeats.** If you miss the framing (e.g., treating Figma as design source), the correction is specific and sharp. Don't argue; absorb and update.
- **Wants methodological consistency.** Atelier applying its own methodology to itself is not a gimmick — it's load-bearing. Violations of the methodology in Atelier's own docs will be called out.
- **No emoji.** Ever, unless explicitly requested.

---

## Memory pointer

`~/.claude/projects/-Users-nino-Workspace-dev-wip-bc-subscriptions/memory/project_methodology.md` holds the cross-session project memory that tracks the methodology's evolution (currently scoped to bc-subscriptions but Atelier's emergence is noted). A fresh session may want to update or create an Atelier-specific memory entry once implementation begins.

---

## If something feels wrong

Atelier's design was iterated across a long session with multiple corrections. If a fresh session reads a doc and something feels off (a decision contradicts another, a capability seems to duplicate an external tool, a boundary appears violated), it's probably a real issue — flag it via a new `BRD-OPEN-QUESTIONS.md` entry rather than silently "fixing" it. Design docs are canonical; undocumented changes from a fresh session are drift.

---

## Final note

The product is named **Atelier** for a reason (ADR-025). A studio where multiple contributors work together on one canonical artifact. Everything about the design serves that metaphor. When in doubt, ask: "Does this make the shared studio work better, or does it pull us into a category we explicitly excluded?"
