# CLAUDE.md — Agent Charter for the Atelier Repo

You are participating in the **Atelier** project — a self-hostable OSS project template for mixed teams of humans + agents to concurrently author one canonical artifact across IDE, browser, and terminal surfaces.

This repo is both the spec for Atelier and a reference implementation of its own methodology. What you read here also applies to any repo scaffolded by `atelier init`.

---

## Canonical state

The following documents are authoritative. When they disagree with each other, the precedence order is:

1. `docs/strategic/NORTH-STAR.md` — complete design scope
2. `docs/strategic/STRATEGY.md` — why and what's out of scope
3. `docs/functional/PRD.md` — product requirements
4. `docs/functional/BRD.md` — stories with trace IDs
5. `docs/architecture/ARCHITECTURE.md` — capability-level architecture
6. `docs/methodology/METHODOLOGY.md` — repo conventions
7. `docs/functional/PRD-COMPANION.md` — design-time decisions with rationale
8. `docs/architecture/decisions/` — append-only canonical runtime decision log (one file per ADR per ADR-030)
9. `docs/functional/BRD-OPEN-QUESTIONS.md` — known open items
10. `docs/strategic/risks.md` — load-bearing strategic bets and their fallback paths (separate from spec by design)
11. `traceability.json` — trace-ID registry

If you would change the canonical state, explain which doc and why before modifying.

---

## Session-start checklist

When you start a session in this repo:

1. Read `README.md` if you haven't already — it has tier-routing (Deploy / Extend / Implement) and the document map.
2. Read `docs/strategic/NORTH-STAR.md` — this is the destination.
3. Scan `docs/architecture/decisions/README.md` (the ADR index) — these are load-bearing choices; don't re-litigate without cause.
4. Check `docs/functional/BRD-OPEN-QUESTIONS.md` — you may be working on one of these.
5. If an agent-facing endpoint is live for this project, call `get_context` to pull session + territory + recent decisions. **Pre-M2** (now), the equivalent is `.atelier/checkpoints/SESSION.md` — a thin session-state file that is retired the moment the M2 endpoint ships. See `docs/methodology/METHODOLOGY.md §6.1` for the canonical-vs-ephemeral split and the no-parallel-summary rule.

---

## Atelier applies its own methodology to itself

This repo follows the methodology it specifies. That means:

- **Repo is canonical for discovery fields.** Decisions, requirements, architecture live in markdown files, not in the datastore. The datastore mirrors for query.
- **Every story has a trace ID.** If you add a user story, add a trace ID (`US-<epic>.<story>`) and update `traceability.json`.
- **Every architectural/strategic choice is a decision.** Add a new file under `docs/architecture/decisions/ADR-NNN-<slug>.md` with YAML frontmatter (per ADR-030). Never edit a prior ADR file; reversals are new files referencing old via `reverses: ADR-<N>` frontmatter.
- **No feature deferral in design docs.** Atelier specifies destination-first; don't add "Phase 2" or "coming soon" to the canonical docs. Build sequencing is separate (see `docs/strategic/BUILD-SEQUENCE.md`).
- **Vendor-neutral in architecture docs.** Architecture describes capabilities (versioned file store, relational datastore, pub/sub broadcast, etc.), not specific vendors. The reference implementation is a separate concept (per ADR-012, ADR-027).

---

## Three-tier consumer model (per ADR-031)

Atelier serves three distinct reader intents. When responding to questions, identify the tier:

- **Tier 1 — Reference Deployment** (action: **Deploy**): "Run Atelier as-is for my team via `atelier init && atelier deploy`." Primary docs: `docs/user/`, `docs/ops/`.
- **Tier 2 — Reference Implementation** (action: **Extend**): "Fork this repo and customize." Primary docs: `docs/developer/`, `docs/architecture/`. Entry point: `docs/developer/fork-and-customize.md`.
- **Tier 3 — Specification** (action: **Implement**): "Implement the protocol on a different stack" or "apply the methodology without using this repo." Primary docs: `docs/methodology/`, `docs/architecture/protocol/`. Entry points: `docs/methodology/adoption-guide.md` (methodology) or `docs/architecture/protocol/implementing-on-other-stacks.md` (protocol).

---

## Scope boundaries (what Atelier is NOT)

Per `docs/strategic/NORTH-STAR.md` §14 and `docs/functional/PRD.md` §5:

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

If you find yourself designing a feature that belongs to one of the above categories, stop and reread `docs/functional/PRD.md` §5.

---

## Load-bearing decisions (abbreviated — see `docs/architecture/decisions/` for rationale)

- **ADR-001:** Prototype is the canonical artifact AND the coordination dashboard.
- **ADR-002:** Contribution is the atomic unit; subsumes tasks/decisions/proposals/PRs.
- **ADR-003:** `scope_kind` generalized from day one (files, doc_region, research_artifact, design_component, slice_config).
- **ADR-004:** Fencing tokens mandatory on all locks from v1.
- **ADR-005:** Decisions write to repo first, datastore second.
- **ADR-006:** Find_similar ships at v1 with eval harness + CI gate (≥75% precision at ≥60% recall).
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
- **ADR-023:** Remote-surface commits via per-project endpoint git committer (ARCH §7.8).
- **ADR-024:** Agent-session transcripts as repo-sidecar files, opt-in via `.atelier/config.yaml`.
- **ADR-025:** Review routing keyed by `territory.review_role`.
- **ADR-026:** Atelier owns the lock + fencing implementation; Switchman not adopted (no fencing-token API).
- **ADR-027:** Reference implementation stack: GitHub + Supabase (Postgres + Realtime + Auth + pgvector) + Vercel (Functions + Hosting + Cron) + MCP. One valid implementation; ADR-012 still governs the architecture.
- **ADR-028:** Identity service default = Supabase Auth (sub-decision of ADR-027). BYO via OIDC through `.atelier/config.yaml: identity.provider`.
- **ADR-029:** Reference impl preserves GCP-portability. No `@vercel/edge`, `@vercel/kv`, Edge Config, or Supabase RPC helpers outside named adapters. Realtime wrapped in `BroadcastService` interface. Migration mapping documented per-capability.
- **ADR-030:** Per-ADR file split — `DECISIONS.md` becomes `docs/architecture/decisions/ADR-NNN-<slug>.md` directory.
- **ADR-031:** Three-tier consumer model — Specification / Reference Implementation / Reference Deployment, all first-class at v1.
- **ADR-032:** Adopt extended documentation structure (claude-docs-toolkit seven layers + Atelier-specific extensions for `methodology/`, `architecture/protocol/`, `architecture/schema/`).

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

- **Discovery content** (anything under `docs/strategic/`, `docs/functional/`, `docs/architecture/ARCHITECTURE.md`, `docs/methodology/`) changes via PR.
- **Companion / open questions** (`docs/functional/PRD-COMPANION.md`, `docs/functional/BRD-OPEN-QUESTIONS.md`) changes via PR with a clear rationale line.
- **Decisions** (`docs/architecture/decisions/`) are append-only. New ADRs are new files. Reversals are new files with `reverses: ADR-<N>` frontmatter (per ADR-030).
- **territories.yaml / config.yaml** changes via PR with approval from the architect role.

Any ambiguity, surface it rather than guessing. `docs/functional/BRD-OPEN-QUESTIONS.md` is the right place for unresolved items.
