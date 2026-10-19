# AGENTS.md — Agent Charter for the Atelier Repo

You are participating in the **Atelier** project — a self-hostable OSS project template for mixed teams of humans + agents to concurrently author one canonical artifact across IDE, browser, and terminal surfaces.

This repo is both the spec for Atelier and a reference implementation of its own methodology. What you read here also applies to any repo scaffolded by `atelier init`.

This file defines the roles, territories, and rules that agents must observe when working on this repo. It is read by every agent at session start: Codex reads it directly, and Claude Code loads it through the `@AGENTS.md` import in `CLAUDE.md`.

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
4a. **In-flight work plan lives in PR descriptions on main** — run `gh pr list --state all --limit 15` and read the descriptions of the recent PRs to derive current phase and sequencing (e.g. the v1.x deferral close-out spanned #46–#57). Do this before asking the operator to re-explain what you're picking up.
5. Call `get_context` against the project's MCP endpoint to pull session + territory + recent decisions. The endpoint is live (Streamable HTTP MCP per ARCH 7.9 + ADR-013/040, verified end-to-end against real Supabase Auth by `scripts/endpoint/__smoke__/real-client.smoke.ts`). Per ADR-044 the build team runs the substrate locally (`docs/user/tutorials/local-bootstrap.md` is the operator runbook); deploy is event-triggered per BRD-OPEN-QUESTIONS section 28. If the endpoint is unreachable (local stack down, MCP client misconfigured, etc.), fall back to direct canonical state read: `docs/strategic/NORTH-STAR.md`, `docs/architecture/decisions/`, `docs/functional/BRD-OPEN-QUESTIONS.md`. See `docs/methodology/METHODOLOGY.md §6.1` for the canonical-vs-ephemeral split and the no-parallel-summary rule.

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

## Roles

Seven composer roles. A composer has one default role and may hold secondary territory grants.

| Role | Primary territories | Can invite | Can author canonical state |
|---|---|---|---|
| **architect** | methodology, architecture, decisions, traceability | Yes | Yes |
| **pm** | product | Yes | Yes |
| **analyst** | requirements, strategy-research | No | Yes |
| **dev** | protocol, prototype-app, evaluation | No | Yes |
| **designer** | prototype-design | No | Yes |
| **admin** | none (platform role) | Yes | No |
| **stakeholder** | none (read-only) | No | No (comments → triage only) |

---

## Territory rules

See `.atelier/territories.yaml` for the canonical declaration. Key rules:

- **Cross-territory work routes through proposals.** If you need to modify an artifact outside your role's primary territories, create a contribution with `kind` matching the change's discipline and `requires_owner_approval=true` (ADR-033 removed `kind=proposal`); do not directly edit.
- **Contracts are load-bearing.** A territory's `contracts_published` defines the interface downstream consumers depend on. Breaking changes route through cross-territory proposal flow (ADR-014).
- **Locks are per-scope, not per-file.** A `doc_region` lock on `docs/functional/BRD.md#section-3` allows concurrent edits to `docs/functional/BRD.md#section-4` by another composer.

---

## Agent-specific rules

These rules describe the operating state once the 18-tool endpoint is live, which it is for this repo as of M2-mid (Streamable HTTP MCP per ARCH 7.9 + ADR-013/040). For local dev without a deployed endpoint, the equivalent is reading the charter files directly and following the rules manually.

1. **Read before writing.** Always pull `get_context` (post-M2) or read the charter files directly (pre-M2) before making changes.
2. **Run `find_similar` before creating contributions** (post-M5 when find_similar ships). The cost of checking is much lower than the cost of duplication.
3. **Claim before editing** (post-M2 when claim/lock primitives exist). Any edit to a shared artifact requires a claimed contribution and an acquired lock.
4. **Use fencing tokens on every write** (post-M2 when locks exist). Writes without current fencing token will be rejected server-side (ADR-004).
5. **Log decisions when making architectural/strategic/convention choices.** Keyword: "because". If the choice carries a 'because', it's a decision and belongs as a new file under `docs/architecture/decisions/ADR-NNN-<slug>.md` (per ADR-030). This rule applies pre-M2 (write the file directly) and post-M2 (call `log_decision`).
6. **Append-only for decisions.** Never edit prior decisions. Reversals are new entries with `reverses:` frontmatter.
7. **Respect scope boundaries.** If you're asked to build something that falls in an excluded category (per `docs/functional/PRD.md` §5), push back rather than implement.
8. **No emoji in commits, docs, or code** unless the user explicitly requests.

---

## Session lifecycle

```
register → work → heartbeat every 30s → deregister on completion
```

If heartbeat lapses past TTL (90s), the session is reaped: held locks release, claimed contributions return to `open`, fencing tokens invalidate. (Lifecycle is post-M2; pre-M2 there are no sessions or locks to reap.)

Always deregister cleanly when possible. Reaped sessions will be visible in `/atelier/observability` (post-M7) as a reaper-rate metric.

---

## Agent clients supported

The protocol is client-agnostic (ADR-013). Any client that can:
- Speak the agent interop protocol (MCP at v1)
- Maintain a session heartbeat loop
- Hold and present a composer token

...can participate. Current ecosystem (Q2 2026): Claude Code, Cursor, Codex, Windsurf, Aider (IDE); claude.ai with remote connectors, ChatGPT with MCP (web); custom CLIs (terminal).

---

## Sandbox rules

- **External-sourced content (via triage) never auto-merges.** Triage produces contributions with `requires_owner_approval=true` that require explicit human approval (ADR-018; ADR-033 replaced the `kind=proposal` mechanism).
- **Service-role datastore credentials live server-side only.** Clients (including this agent) only hold per-composer tokens (ADR-007 security consequence).
- **No direct datastore writes from clients.** All writes go through the agent endpoint, which enforces authorization and fencing.

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
- **ADR-015:** One guild, many projects (plural schema from v1).
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
- **ADR-033:** Contribution.kind scoped to output discipline — drop `proposal` (was conflating provenance) and `decision` (was unreachable; decisions flow via `log_decision`). Enum becomes `implementation | research | design`. Cross-role authoring surfaces via `requires_owner_approval=true`.
- **ADR-034:** Contribution lifecycle state separated from blocked status flag. `state` enum drops `blocked`; blocked is now `blocked_by IS NOT NULL` orthogonal to lifecycle position.
- **ADR-035:** Contract metadata covers ARCH 6.6.1 classifier surface. `contracts.breaking_change` bool replaced with `classifier_decision`, `classifier_reasons`, `override_decision`, `override_justification`, and a generated `effective_decision`.
- **ADR-036:** Immortal author identity via composer_id; session_id is operational only. Tables (`contributions`, `decisions`, `locks`, `telemetry`) gain `*_composer_id` (immortal) alongside existing `*_session_id` (operational, ON DELETE SET NULL).
- **ADR-037:** Decisions table cleanup — drop vestigial `convention` category, add `triggered_by_contribution_id` link.
- **ADR-038:** Composer role split into discipline + access_level. `composers.default_role` becomes `composers.discipline` (analyst | dev | pm | designer | architect) + `composers.access_level` (member | admin | stakeholder). Adds `architect` as first-class discipline (closing the territories.yaml drift). Resolves BRD-OPEN-QUESTIONS section 20.
- **ADR-039:** Plan-review state added to contribution lifecycle as per-territory opt-in gate. `contributions.state` gains `plan_review` (6 -> 7 values) between `claimed` and `in_progress`. Activation via `territories.requires_plan_review: bool` (default false). Resolves BRD-OPEN-QUESTIONS section 19. Accepted at v1 prior to M2 entry; defer-to-v1.x rejected per ADR-011 destination-first.
- **ADR-040:** 12-tool surface consolidation: `propose_contract_change` replaces `publish_contract` + `get_contracts`; contract reads served via `get_context`. Resolves ADR-013 internal-inconsistency (declared 12, listed 13). v1 surface locked at: register, heartbeat, deregister, get_context, find_similar, claim, update, release, log_decision, acquire_lock, release_lock, propose_contract_change. Surfaced by `docs/architecture/audits/M2-entry-data-model-audit.md` finding H2.
- **ADR-041:** Embedding model default for find_similar: OpenAI-compatible adapter as the only named adapter at v1; default config points at OpenAI `text-embedding-3-small` (1536-dim). Adopters swap providers (vLLM, Ollama, LocalAI, self-hosted Voyage) by overriding `find_similar.embeddings.base_url` + `api_key_env`; the adapter code does not change. pgvector schema lands at M5 entry as `vector(1536)`. Resolves D24 + BRD-OPEN-QUESTIONS section 3 prior to M5 entry per ADR-011 destination-first. Hybrid retrieval (vector + BM25) is M5's deliverable, not pre-decided here. Cross-dimension swap migration filed as BRD-OPEN-QUESTIONS section 25 (event-triggered; resolved within 24 hours by ADR-042).
- **ADR-042:** find_similar = hybrid retrieval (vector kNN + Postgres BM25 fused via RRF, k=60); cosine thresholds retired. M5 result P=0.672 / R=0.626 (text-embedding-3-small; 3-large tested + reverted).
- **ADR-043:** find_similar gate splits into advisory (v1 default; precision >= 0.60 AND recall >= 0.60; cleared by M5 measurement) and blocking (v1.x opt-in; precision >= 0.85 AND recall >= 0.70; gated on cross-encoder reranker per BRD-OPEN-QUESTIONS section 27). Preserves ADR-006's ambition (hands-off duplicate prevention IS the wedge) while honestly naming what the v1 implementation delivers (advisory-quality with documented path to blocking-quality). ADR-006 not reversed -- its 0.75/0.60 numbers are reinterpreted as the blocking-tier target. CI gate values in `.atelier/config.yaml` move to advisory; blocking values are documented but not enforced unless `gate.tier: blocking` is set.
- **ADR-044:** Bootstrap inflection at M5-exit; build sessions become MCP clients of the substrate from M6 forward. Local-stack scope only (`supabase start` + `npm run dev`); deploy decision deferred to network-access trigger per BRD-OPEN-QUESTIONS section 28 (event-triggered with concrete trigger criteria per the section 25 methodology lesson). Operationalizes BUILD-SEQUENCE M3's bootstrap commitment ("M4+: every build session observed through `/atelier`"). Operator runbook at `docs/user/tutorials/local-bootstrap.md`; secret rotation at `docs/user/guides/rotate-secrets.md`.
- **ADR-045:** `get_context` extends with optional `scope_files: string[]` for pre-claim file-overlap awareness (returns `overlapping_active`); SQL-only, deterministic, not a 13th tool.
- **ADR-046:** Deploy strategy: Vercel + Supabase Cloud + rootDirectory=prototype + URL split inheritance. Codifies the empirical M6-entry deploy that landed `https://atelier-three-coral.vercel.app`. Hosting is Vercel; coordination datastore + auth is Supabase Cloud (Pro org); URL split from PR #14 (`/api/mcp` static-bearer + `/oauth/api/mcp` OAuth-flow with discovery published path-prefixed) inherits unchanged from local-bootstrap; bearer rotation via Supabase Auth default 1-hour TTL + operator-driven `scripts/bootstrap/rotate-bearer.ts` (M7 follow-up). Does NOT reverse ADR-044; adds a peer mode to local-bootstrap, which remains canonical for development. Resolves BRD-OPEN-QUESTIONS section 28; procedural twin is `docs/user/tutorials/first-deploy.md` (PR #24 / F6.2).
- **ADR-047:** find_similar wider-eval (claude-agent-sdk corpus, 117 seeds / 44 items) P=0.554 / R=0.542 — misses advisory tier. Reverses ADR-043 blocking-tier; advisory demoted to corpus-shape-dependent; cross-encoder reranker -> v1.x opt-in. Resolves BRD §26 + §27.
- **ADR-051:** RLS on the MCP path via AsyncLocalStorage + per-tx `SET LOCAL ROLE atelier_runtime` (33 policies / 13 tables; composer resolved from `auth.jwt()->>'sub'`); sync paths bypass via service_role; supabase-js-on-MCP deferred to v2. Migration `..._atelier_rls_policies.sql`, smoke `rls.smoke.ts`. Resolves BRD §31.
- **ADR-052:** Cloudflare-primary infra pivot (Workers via `@opennextjs/cloudflare`, Cron, R2/KV/Queues/Durable Objects); Supabase Postgres+pgvector + Auth + Resend remain SaaS carve-outs. Reverses ADR-046; amends ADR-027/029. Rule: default Cloudflare, SaaS carve-out needs a named disqualifier.
- **ADR-053:** Atelier + AI Hive (`bc-subscriptions/.hive/`) are paired canonical-vs-empirical substrates (Hive = empirical lab; Atelier = canonical destination); bidirectional flow with `evidence: hive-production-use`. Not a merge or deprecation.
- **ADR-054:** Adopt brainstorm primitives from Hive (reverses BRD §35): +6 tools (`propose`/`react`/`get_proposals`/`synthesize`/`approve_plan`/`checkpoint`); surface lock 12->18 (amends ADR-040); new tables + RLS. Structured deliberation, not chat (preserves PRD §5).
- **ADR-055:** Three-loop coordination framing (brainstorm / execute / continuity) as canonical IA over the 18 tools; SSE push supersedes Supabase Realtime as canonical broadcast (Realtime adapter retained for M2-M7 adopters; preserves ADR-029 portability).

_(Per-ADR provenance — which audit or review surfaced each — lives in the ADR files' frontmatter, per ADR-030.)_

---

## Writing conventions

- No emojis in code or docs (see the user's global agent instructions).
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
