# Atelier

A self-hostable OSS project template where mixed teams of humans + agents concurrently author a single canonical artifact (the prototype) from any locus, without drift.

---

## What this repo is

This repository is the reference implementation and canonical source for **Atelier** — the methodology, protocol, and template for multi-composer human+agent software authorship.

It serves three roles simultaneously:

1. **The spec** — every design decision, capability, and protocol detail lives in these docs.
2. **The template** — the `prototype/`, `scripts/`, and `.atelier/` directories are what a new project scaffolded via `atelier init` inherits.
3. **A reference implementation of its own methodology** — this repo itself follows Atelier conventions (territories, trace IDs, decisions.md, fit_check on BRD stories).

---

## What Atelier is

A **self-hosted OSS project template + agent interop protocol + reference prototype** that lets teams of humans and AI agents concurrently author one canonical artifact across different loci (IDE, browser, terminal).

- **Not a SaaS.** Teams self-host the coordination datastore and prototype.
- **Not an agent framework.** Existing agent clients (IDE + web) connect via an open interop protocol.
- **Not a replacement for Jira/Linear/Confluence/Figma.** Each remains canonical for its thing.
- **Not a workflow engine.** External workflow tools stay in their lanes.

Atelier is the **spine that connects those tools around one project** so mixed teams can work concurrently without drift.

---

## Document map

Read in this order on a first pass.

| Doc | Purpose |
|---|---|
| [`NORTH-STAR.md`](./NORTH-STAR.md) | Complete design scope, capability-level, no vendor prescriptions. Read this first. |
| [`STRATEGY.md`](./STRATEGY.md) | Market context, competitive landscape, red-team analysis, product-scope verdict. Why Atelier and why not a SaaS. |
| [`METHODOLOGY.md`](./METHODOLOGY.md) | How Atelier itself is organized — applies its own methodology to this repo. |
| [`PRD.md`](./PRD.md) | Product requirements. What the product must do. |
| [`BRD.md`](./BRD.md) | Business requirements. Epics and user stories with trace IDs. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Capability-level architecture. Components, data model, flows. No vendor lock-in. |
| [`PRD-COMPANION.md`](./PRD-COMPANION.md) | Decisions log with rationale. What we chose, why, alternatives rejected. |
| [`BRD-OPEN-QUESTIONS.md`](./BRD-OPEN-QUESTIONS.md) | Open items surfaced during analysis that need resolution before build. |
| [`DECISIONS.md`](./DECISIONS.md) | Append-only decision log. Canonical for anything Atelier-scoped. |
| [`BUILD-SEQUENCE.md`](./BUILD-SEQUENCE.md) | Order of construction for the reference implementation. Plan, not canon — design docs win on conflicts. |

---

## The irreducible bet

**Fit_check precision.** Semantic search that answers "is this already done or in flight?" at ≥75% precision with ≥60% recall. Ships at v1 with an evaluation harness and CI gate.

If the bar holds, Atelier has a defensible commercial wedge (optional managed fit_check service). If it misses, Atelier still ships as a credible OSS template + protocol spec + reference implementation. Either way, every feature described in `NORTH-STAR.md` ships together.

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
| **Constitution** | Repo-resident files governing agent behavior: `CLAUDE.md`, `AGENTS.md`, `decisions.md`, `.atelier/*`. |
| **Prototype** | The web app that is both the canonical artifact and the dashboard. |
| **Trace ID** | `US-X.Y`, `BRD:Epic-N`, etc. — join key across all surfaces. |
| **Fit_check** | Semantic search that answers "is this already done or in flight?" |
| **Triage** | Classifier + drafter pipeline that turns external comments into proposal contributions. |

---

## Status

- **Phase:** Pre-implementation. Design scope captured; no code yet.
- **Current session:** 2026-04-24. Strategic synthesis from cross-session analysis (bc-subscriptions reference impl, hackathon-hive working substrate, ai-hive architecture, big-blueprint methodology).
- **Next step:** Stress-test the territory model on the analyst case before committing to build. See `BRD-OPEN-QUESTIONS.md §1`.
