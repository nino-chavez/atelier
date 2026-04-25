# CLAUDE.md — Agent Constitution for the Atelier Repo

You are participating in the **Atelier** project — a self-hostable OSS project template for mixed teams of humans + agents to concurrently author one canonical artifact across IDE, browser, and terminal loci.

This repo is both the spec for Atelier and a reference implementation of its own methodology. What you read here also applies to any repo scaffolded by `atelier init`.

---

## Canonical state

The following documents are authoritative. When they disagree with each other, the precedence order is:

1. `NORTH-STAR.md` — complete design scope
2. `STRATEGY.md` — why and what's out of scope
3. `PRD.md` — product requirements
4. `BRD.md` — stories with trace IDs
5. `ARCHITECTURE.md` — capability-level architecture
6. `METHODOLOGY.md` — repo conventions
7. `PRD-COMPANION.md` — design-time decisions with rationale
8. `DECISIONS.md` — append-only canonical runtime decision log
9. `BRD-OPEN-QUESTIONS.md` — known open items
10. `traceability.json` — trace-ID registry

If you would change the canonical state, explain which doc and why before modifying.

---

## Session-start checklist

When you start a session in this repo:

1. Read `README.md` if you haven't already.
2. Read `NORTH-STAR.md` — this is the destination.
3. Scan `DECISIONS.md` — these are load-bearing choices; don't re-litigate without cause.
4. Check `BRD-OPEN-QUESTIONS.md` — you may be working on one of these.
5. If an agent-facing endpoint is live for this project, call `get_context` to pull session + territory + recent decisions.

---

## Atelier applies its own methodology to itself

This repo follows the methodology it specifies. That means:

- **Repo is canonical for discovery fields.** Decisions, requirements, architecture live in markdown files, not in the datastore. The datastore mirrors for query.
- **Every story has a trace ID.** If you add a user story, add a trace ID (`US-<epic>.<story>`) and update `traceability.json`.
- **Every architectural/strategic choice is a decision.** Append to `DECISIONS.md` with YAML frontmatter. Never edit a prior decision; reversals are new entries referencing old.
- **No feature deferral in design docs.** Atelier specifies destination-first; don't add "Phase 2" or "coming soon" to `NORTH-STAR.md`, `PRD.md`, `BRD.md`, or `ARCHITECTURE.md`. Build sequencing is separate.
- **Vendor-neutral in architecture docs.** Architecture describes capabilities (versioned file store, relational datastore, pub/sub broadcast, etc.), not specific vendors.

---

## Scope boundaries (what Atelier is NOT)

Per `NORTH-STAR.md` §14 and `PRD.md` §5:

- Not a SaaS
- Not an agent framework (agent clients stay in their lanes)
- Not a workflow engine (Conductor/LangGraph/CrewAI stay in their lanes)
- Not a task tracker UI (Jira/Linear remain canonical)
- Not a chat app (claude.ai/ChatGPT remain canonical for agent conversations)
- Not a code editor (VS Code/Cursor remain canonical)
- Not a design tool (Figma remains canonical for visual design)
- Not a doc editor (Confluence/Notion remain canonical for published long-form docs)
- Not a wiki (repo markdown is the knowledge base)
- Not a messaging platform (Slack/Teams remain canonical)

If you find yourself designing a feature that belongs to one of the above categories, stop and reread `PRD.md` §5.

---

## Load-bearing decisions (abbreviated — see `DECISIONS.md` for rationale)

- **ADR-001:** Prototype is the canonical artifact AND the coordination dashboard.
- **ADR-002:** Contribution is the atomic unit; subsumes tasks/decisions/proposals/PRs.
- **ADR-003:** `scope_kind` generalized from day one (files, doc_region, research_artifact, design_component, slice_config).
- **ADR-004:** Fencing tokens mandatory on all locks from v1.
- **ADR-005:** Decisions write to `decisions.md` first, datastore second.
- **ADR-006:** Fit_check ships at v1 with eval harness + CI gate (≥75% precision at ≥60% recall).
- **ADR-007:** No multi-tenant SaaS; self-hosted OSS only.
- **ADR-008:** All 5 sync substrate scripts ship together; no phasing.
- **ADR-009:** Remote-principal actor class (web agents as first-class composers).
- **ADR-010:** Explicit exclusions enforce scope boundaries.
- **ADR-011:** Destination-first design; no feature deferral.
- **ADR-012:** Capability-level architecture; no vendor lock-in.
- **ADR-013:** 12-tool agent endpoint surface.
- **ADR-014:** Territory + contract model extended to non-code.
- **ADR-015:** One hive, many projects (plural schema from v1).
- **ADR-016:** Two orthogonal substrates (SDLC sync + coordination).
- **ADR-017:** Five role-aware lenses at `/atelier`: analyst, dev, PM, designer, stakeholder.
- **ADR-018:** Triage never auto-merges; all external content requires human approval.
- **ADR-019:** Figma is feedback surface, not design source-of-truth.
- **ADR-020:** Naming: Atelier (rejected: Hivemind OS, Hive, Commons, Loom).
- **ADR-021:** Multi-trace-ID support on contributions and decisions (`text[]` with GIN index).
- **ADR-022:** `claim` atomic-creates open contributions when called with `contribution_id=null`.
- **ADR-023:** Remote-locus commits via per-project endpoint git committer (ARCH §7.8).
- **ADR-024:** Agent-session transcripts as repo-sidecar files, opt-in via `.atelier/config.yaml`.
- **ADR-025:** Review routing keyed by `territory.review_role`.

Note: ADR-013 covers MCP as the v1 reference protocol (no separate ADR). ADR-001 covers the `/atelier` route as part of "prototype is canonical artifact AND coordination dashboard" (no separate ADR).

---

## Writing conventions

- No emojis in code or docs (see user's global `~/.claude/CLAUDE.md`).
- Markdown with YAML frontmatter where relevant.
- Trace IDs in the form `US-<epic>.<story>` / `BRD:Epic-<N>` / `D<N>` / `ADR-<N>` / `NF-<N>`.
- Commit messages: descriptive, conventional-ish style. Reference trace IDs when relevant.
- Code comments: only when the WHY is non-obvious. Don't describe WHAT well-named identifiers already say.

---

## How to propose changes

- **Discovery content** (NORTH-STAR, STRATEGY, PRD, BRD, ARCHITECTURE, METHODOLOGY, DECISIONS) changes via PR.
- **Companion/open-questions** (PRD-COMPANION, BRD-OPEN-QUESTIONS) changes via PR with a clear rationale line.
- **Decisions** (DECISIONS.md) are append-only. If you want to reverse a decision, write a new decision with `reverses: ADR-<N>` frontmatter.
- **territories.yaml / config.yaml** changes via PR with approval from the architect role.

Any ambiguity, surface it rather than guessing. `BRD-OPEN-QUESTIONS.md` is the right place for unresolved items.
