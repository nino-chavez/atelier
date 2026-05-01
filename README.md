# Atelier

A self-hostable OSS project template + agent interop protocol + reference prototype where mixed teams of humans and AI agents concurrently author one canonical artifact across IDE, browser, and terminal surfaces — without drift.

---

## What this repo is

Atelier exists as **three engagement tiers**, all first-class at v1, all open source (per ADR-031):

1. **Specification** — the methodology and the 12-tool open protocol. Transferable to any project, any stack.
2. **Reference Implementation** — this codebase. Designed for the GitHub + Supabase + Vercel + MCP stack (per ADR-027). **Status: M0 design complete; implementation begins at M1 per [`docs/strategic/BUILD-SEQUENCE.md`](./docs/strategic/BUILD-SEQUENCE.md).**
3. **Reference Deployment** — what you get from `atelier init && atelier deploy` once the reference implementation ships (M3 for prototype + endpoint; full CLI polish at M7).

Pick your path in the table below.

---

## Pick your path

| Tier | Action | What you do | Start here |
|---|---|---|---|
| **1. Reference Deployment** | **Deploy** | Run Atelier as-is for your team via `atelier init && atelier deploy`. You don't want to think about the implementation. | [`docs/user/`](./docs/user/) (populates at v1) and [`docs/ops/`](./docs/ops/) (populates at M7) |
| **2. Reference Implementation** | **Extend** | Fork this repo. Modify schema, add lenses, swap find_similar model, write new sync adapters. | [`docs/developer/fork-and-customize.md`](./docs/developer/fork-and-customize.md) |
| **3. Specification** | **Implement** | Implement the 12-tool protocol on a different stack, OR apply Atelier's methodology to a project that does not use this codebase. | [`docs/methodology/adoption-guide.md`](./docs/methodology/adoption-guide.md) (methodology) or [`docs/architecture/protocol/`](./docs/architecture/protocol/) (protocol) |

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
| **User** | How do I use it as an end-user? (populates at v1) | [`docs/user/`](./docs/user/) |

Doc structure follows the claude-docs-toolkit seven-layer audience model with Atelier-specific extensions for `methodology/`, `architecture/protocol/`, `architecture/schema/` (per ADR-032). Empty layer READMEs cite the milestone where they fill in.

---

## What ships at v1

Every capability in [`docs/strategic/NORTH-STAR.md`](./docs/strategic/NORTH-STAR.md) ships at v1, including:

- **Find_similar** — semantic search answering "is this already done or in flight?" with an evaluation harness and CI gate enforcing ≥75% precision at ≥60% recall (per ADR-006).
- The 12-tool agent endpoint (per ADR-013).
- The five role-aware lenses at `/atelier` (per ADR-017).
- The five SDLC sync substrate scripts (per ADR-008).
- The territory + contract model with fencing tokens (per ADR-004, ADR-014).

Build sequencing across M0–M7 is in [`docs/strategic/BUILD-SEQUENCE.md`](./docs/strategic/BUILD-SEQUENCE.md). Strategic bets the build depends on — and what would change if those bets don't hold — are tracked in [`docs/strategic/risks.md`](./docs/strategic/risks.md).

---

## Vocabulary

| Term | Meaning |
|---|---|
| **Atelier** | The product. The shared studio. |
| **Guild** | A team and the shared Atelier instance they coordinate through — composers + one datastore + one endpoint + one prototype deploy. Hosts one or more projects. Per ADR-015. |
| **Project** | One repo + linked external tools, scoped within a guild via `project_id`. Projects share their guild's datastore and endpoint with `project_id` isolation. |
| **Composer** | The role-bearing participant — a human (or their authorized agent) authoring canonical state in coordination contexts. |
| **Principal** | The security-identity layer — the signed identity a composer authenticates as (per OAuth/OIDC vocabulary). A composer participates as a principal. |
| **Session** | A composer's active connection to a project from a specific surface. |
| **Surface** | Where a composer interacts from: `ide`, `web`, `terminal`, `passive`. |
| **Territory** | Named domain with owner, scope kind, scope pattern, published contracts. |
| **Contribution** | Atomic unit of work; one schema covers tasks/decisions/proposals/PRs. |
| **`scope_kind`** | One of: `files`, `doc_region`, `research_artifact`, `design_component`, `slice_config` — the five kinds of artifact a contribution or lock can target (per ADR-003). |
| **Slice** | A vertical product feature with strategy, design, and current-state views; one unit of dual-track-agile authoring (the `/slices/[id]` route). |
| **Contract** | Typed interface published by one territory for consumption by others. |
| **Blackboard** | Coordination state (sessions, contributions, decisions, locks, contracts). |
| **Charter** | Repo-resident files governing agent behavior: `CLAUDE.md`, `AGENTS.md`, `docs/architecture/decisions/`, `.atelier/*`. |
| **Prototype** | The web app that is both the canonical artifact and the dashboard. |
| **Trace ID** | `US-X.Y`, `BRD:Epic-N`, etc. — join key across all surfaces. |
| **`find_similar`** | The semantic-search primitive: "is this already done or in flight?" Operates over decisions, contributions, BRD/PRD sections, research artifacts. |
| **Triage** | Classifier + drafter pipeline that turns external comments into proposal contributions. |

---

## Status

- **Phase:** M3 entry landed (the `/atelier` route + five lenses on top of the M2-mid 12-tool MCP endpoint substrate per [`docs/strategic/BUILD-SEQUENCE.md`](./docs/strategic/BUILD-SEQUENCE.md)). The endpoint is live and verified by `scripts/endpoint/__smoke__/real-client.smoke.ts` against real Supabase Auth.
- **Current session state:** call `get_context` against the project's MCP endpoint (US-2.4) — that's the canonical "where did the last session leave off" surface. For local exploration without an endpoint, read the canonical state precedence list in [`CLAUDE.md`](./CLAUDE.md).
