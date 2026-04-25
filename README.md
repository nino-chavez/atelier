# Atelier

A self-hostable OSS project template + agent interop protocol + reference prototype where mixed teams of humans and AI agents concurrently author one canonical artifact across IDE, browser, and terminal loci — without drift.

---

## What this repo is

Atelier ships as **three things in one repo**:

1. **A methodology** (transferable to any project, any stack).
2. **An open protocol** (12-tool agent-facing surface; MCP is the v1 reference transport).
3. **A reference implementation** (the codebase you're looking at — Vercel + Supabase + MCP, per ADR-027).

These are documented as three tiers below. Pick the tier that matches what you want to do.

---

## Pick your path

| Tier | Action | What you do | Start here |
|---|---|---|---|
| **1. Reference Deployment** | **Deploy** | Run Atelier as-is for your team via `atelier init && atelier deploy`. You don't want to think about the implementation. | [`docs/user/`](./docs/user/) (populates at v1) and [`docs/ops/`](./docs/ops/) (populates at M7) |
| **2. Reference Implementation** | **Extend** | Fork this repo. Modify schema, add lenses, swap fit_check model, write new sync adapters. | [`docs/developer/fork-and-customize.md`](./docs/developer/fork-and-customize.md) |
| **3. Specification** | **Implement** | Implement the 12-tool protocol on a different stack, OR apply Atelier's methodology to a project that does not use this codebase. | [`docs/methodology/adoption-guide.md`](./docs/methodology/adoption-guide.md) (methodology) or [`docs/architecture/protocol/`](./docs/architecture/protocol/) (protocol) |

All three tiers are open source. All three tiers are first-class at v1 per ADR-031.

---

## What Atelier is not

- **Not a SaaS** — teams self-host (per ADR-007).
- **Not an agent framework** — existing agent clients connect via the open protocol.
- **Not a replacement for Jira / Linear / Confluence / Figma / Slack** — each remains canonical for its own domain (per ADR-010).
- **Not a workflow engine** — Conductor / LangGraph / CrewAI stay in their lanes.

Atelier is the **spine that connects existing best-in-class tools around one project** so mixed teams can work concurrently without drift.

---

## Document map

| Layer | Audience question | Path |
|---|---|---|
| **Methodology** | How is the way-of-working organized, and how do I adopt it? | [`docs/methodology/`](./docs/methodology/) |
| **Strategic** | Where is Atelier going, and why this shape? | [`docs/strategic/`](./docs/strategic/) — NORTH-STAR, STRATEGY, BUILD-SEQUENCE |
| **Functional** | What does the product do? | [`docs/functional/`](./docs/functional/) — PRD, BRD, companion, open questions |
| **Architecture** | How is it designed? | [`docs/architecture/`](./docs/architecture/) — ARCHITECTURE, decisions, protocol, schema, walks, diagrams |
| **Developer** | How do I contribute or fork? | [`docs/developer/`](./docs/developer/) |
| **Ops** | How do I self-host and operate it? (M7) | [`docs/ops/`](./docs/ops/) |
| **Testing** | How is quality assured? (M5) | [`docs/testing/`](./docs/testing/) |
| **User** | How do I use it as an end-user? (v1) | [`docs/user/`](./docs/user/) |

Doc structure follows [claude-docs-toolkit](https://github.com/) seven-layer model with Atelier-specific extensions for `methodology/`, `architecture/protocol/`, `architecture/schema/` (per ADR-032). Empty layer READMEs cite the BUILD-SEQUENCE milestone where they fill in.

---

## The irreducible bet

**Fit_check precision.** Semantic search that answers "is this already done or in flight?" at ≥75% precision with ≥60% recall. Ships at v1 with an evaluation harness and CI gate (per ADR-006).

If the bar holds, Atelier has a defensible commercial wedge (optional managed fit_check service). If it misses, Atelier still ships as a credible OSS template + protocol spec + reference implementation. Either way, every feature described in `docs/strategic/NORTH-STAR.md` ships together.

---

## Vocabulary

| Term | Meaning |
|---|---|
| **Atelier** | The product. The shared studio. |
| **Project** | One repo + one coordination datastore + one deployed prototype + linked tools. |
| **Composer** | Human principal with authority over a territory. |
| **Session** | A composer's active connection to a project from a specific locus. |
| **Territory** | Named domain with owner, scope kind, scope pattern, published contracts. |
| **Contribution** | Atomic unit of work; one schema covers tasks/decisions/proposals/PRs. |
| **Contract** | Typed interface published by one territory for consumption by others. |
| **Blackboard** | Coordination state (sessions, contributions, decisions, locks, contracts). |
| **Constitution** | Repo-resident files governing agent behavior: `CLAUDE.md`, `AGENTS.md`, `docs/architecture/decisions/`, `.atelier/*`. |
| **Prototype** | The web app that is both the canonical artifact and the dashboard. |
| **Trace ID** | `US-X.Y`, `BRD:Epic-N`, etc. — join key across all surfaces. |
| **Fit_check** | Semantic search that answers "is this already done or in flight?" |
| **Triage** | Classifier + drafter pipeline that turns external comments into proposal contributions. |

---

## Status

- **Phase:** Pre-implementation. M0 of [`docs/strategic/BUILD-SEQUENCE.md`](./docs/strategic/BUILD-SEQUENCE.md) complete (methodology + 32 ADRs + scaffolding). M1 (SDLC sync substrate) is the next concrete step.
- **Current session state:** see [`.atelier/checkpoints/SESSION.md`](./.atelier/checkpoints/SESSION.md) — ephemeral, sunset at M2 when `get_context` (US-2.4) replaces it.
