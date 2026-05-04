# Atelier

A self-hostable OSS project template + agent interop protocol + reference prototype where mixed teams of humans and AI agents concurrently author one canonical artifact across IDE, browser, and terminal surfaces — without drift.

---

## What this repo is

Atelier exists as **three engagement tiers**, all first-class at v1, all open source (per ADR-031):

1. **Specification** — the methodology and the 12-tool open protocol. Transferable to any project, any stack.
2. **Reference Implementation** — this codebase. Built on the GitHub + Supabase + Vercel + MCP stack (per ADR-027). **Status: v1 substrate shipped (M0–M7 done as of 2026-05-03; see [`docs/strategic/BUILD-SEQUENCE.md`](./docs/strategic/BUILD-SEQUENCE.md) and [`docs/architecture/audits/milestone-M7-exit.md`](./docs/architecture/audits/milestone-M7-exit.md)).** Live deploy: `https://atelier-three-coral.vercel.app`.
3. **Reference Deployment** — what you get from `atelier init <project-name>` (D5) for a fresh local-stack project, or `atelier deploy` (D6) for the Vercel + Supabase Cloud deploy (per ADR-046; one-time provisioning per [`docs/user/tutorials/first-deploy.md`](./docs/user/tutorials/first-deploy.md)). Both lifecycle commands consolidate the manual runbooks into one command; [`docs/user/tutorials/local-bootstrap.md`](./docs/user/tutorials/local-bootstrap.md) and [`docs/user/tutorials/first-deploy.md`](./docs/user/tutorials/first-deploy.md) preserve the manual steps as appendices. Cloud-mode auto-provisioning of the Supabase + Vercel projects themselves remains v1.x scope per BUILD-SEQUENCE §9.

Pick your path in the table below. **If you just want to try Atelier on your workstation,** start at [`docs/user/getting-started.md`](./docs/user/getting-started.md).

---

## Pick your path

| Tier | Action | What you do | Start here |
|---|---|---|---|
| **1. Reference Deployment** | **Deploy** | Run Atelier as-is for your team. | [`docs/user/getting-started.md`](./docs/user/getting-started.md) — single-page Tier 1 walk: prereqs, the local-only path (canonical per ADR-044), and when to switch to the deployed mode. Points at [`docs/user/tutorials/local-bootstrap.md`](./docs/user/tutorials/local-bootstrap.md) and [`docs/user/tutorials/first-deploy.md`](./docs/user/tutorials/first-deploy.md) for the operator runbooks. The polished CLI surface is `atelier init` (D5) + `atelier dev` for local; `atelier deploy` (D6) for Vercel + Supabase Cloud. |
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
| **Ops** | How do I self-host and operate it? | [`docs/ops/`](./docs/ops/) |
| **Testing** | How is quality assured? | [`docs/testing/`](./docs/testing/) |
| **User** | How do I use it as an end-user? | [`docs/user/`](./docs/user/) |

Doc structure follows the claude-docs-toolkit seven-layer audience model with Atelier-specific extensions for `methodology/`, `architecture/protocol/`, `architecture/schema/` (per ADR-032). Empty layer READMEs cite the milestone where they fill in.

---

## What shipped at v1

Every capability in [`docs/strategic/NORTH-STAR.md`](./docs/strategic/NORTH-STAR.md) shipped at v1:

- **Find_similar** — semantic search answering "is this already done or in flight?" with hybrid retrieval (vector + BM25 RRF per ADR-042), an evaluation harness, and an advisory CI gate (P≥0.60 / R≥0.60 per ADR-043; blocking-tier reframed as v1.x opt-in per ADR-047 after wider-eval).
- The 12-tool agent endpoint over MCP Streamable HTTP (per ADR-013, ADR-040).
- The five role-aware lenses at `/atelier` (per ADR-017) plus the admin-gated `/atelier/observability` dashboard (per ARCH 8.2).
- The five SDLC sync substrate scripts (per ADR-008; GitHub adapter shipped, additional providers v1.x-deferred per BUILD-SEQUENCE §M1.5).
- The territory + contract model with fenced locks (per ADR-004, ADR-014, ADR-026).
- Self-hosted reference deploy on Vercel + Supabase Cloud (per ADR-046).

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

- **Phase:** v1 substrate complete (M0–M7 shipped; M7-exit audit at [`docs/architecture/audits/milestone-M7-exit.md`](./docs/architecture/audits/milestone-M7-exit.md)). The 12-tool MCP endpoint, the five role-aware lenses + `/atelier/observability` dashboard, the SDLC sync substrate (GitHub adapter), find_similar with hybrid retrieval, fenced locks, the GCP-portability lint, the deploy strategy (Vercel + Supabase Cloud), the IA/UX automated validation suite (static + DOM Playwright layers), and the v1 CLI surface (6 polished commands + 7 v1.x pointer-stubs) are all in main. Live deploy: `https://atelier-three-coral.vercel.app`. v1.x deferrals filed in [`docs/functional/BRD-OPEN-QUESTIONS.md`](./docs/functional/BRD-OPEN-QUESTIONS.md) per the no-announcement-ceremony principle.
- **Current session state:** call `get_context` against the project's MCP endpoint (US-2.4) — that's the canonical "where did the last session leave off" surface. For local exploration without an endpoint, read the canonical state precedence list in [`CLAUDE.md`](./CLAUDE.md).
