# BRD Open Questions

**Context.** Questions surfaced during design that must be answered before or during v1 build. Each item is an explicit decision point, not a defect.

**Last updated:** 2026-04-24 (analyst-case walkthrough session)

---

## 1 · Territory-model validation on the analyst case

**Scenario.** An analyst composer begins week-1 competitive research on US-1.3. They connect their web-based agent client via remote protocol, register a session with `locus=web`, and need to:

1. Read the current strategy context for US-1.3
2. Claim a research artifact contribution
3. Run fit_check to see if prior research exists
4. Author research content via their agent
5. Log decisions about findings
6. Release the contribution for PM review

**Walkthrough findings (2026-04-24).**

The scenario was traced end-to-end through `ARCHITECTURE.md §5` (data model), `NORTH-STAR.md §5` (12-tool endpoint surface), and `territories.yaml`. Five gaps surfaced, all resolved via new decisions. What held up cleanly: `strategy-research` territory schema (`scope_kind: research_artifact`, `scope_pattern: research/**/*`), `fit_check` flow, `log_decision` four-step atomic operation, session lifecycle, lock + fencing, PM notification via pub/sub.

| Step | Tool | Result |
|---|---|---|
| 1. Read context for US-1.3 | `get_context` | Clean — minor gap: no `trace_id` scope parameter. Resolved: ADR-025. |
| 2. Claim a research artifact contribution | `claim` | Gap: no contribution-creation path in 12-tool surface. Resolved: ADR-021 (`claim` overloaded for create+claim). |
| 3. Run fit_check | `fit_check` | Clean. No gaps. |
| 4. Author research content via web agent | `update` | Significant gap: no artifact write path for web agents. Resolved: ADR-022 (`update` + optional `content` payload; endpoint commits via git API). |
| 5. Log decisions about findings | `log_decision` | Clean. Existing four-step flow covers web agents via git API. |
| 6. Release for PM review | `release` | Minor gap: `release` semantic was ambiguous (abandon vs. forward to review). Resolved: ADR-024. |

**Resolved open questions:**
- Territory schema with `scope_kind=research_artifact` + `scope_pattern=research/**` cleanly supports the flow. No structural rework needed.
- Multi-trace-ID research: `trace_id text` → `trace_ids text[]` (first element = primary). Resolved: ADR-023.
- Agent-session transcript storage: sidecar file `research/<trace_id>-<slug>.transcript.md` committed via same git API mechanism as artifact content (ADR-022). Covered by ARCH-05.
- When analyst releases to `review`: PM lens (`/atelier` with PM filter active) shows contributions in `review` state in `strategy-research` territory. Pub/sub broadcast notifies all active PM sessions. No design change needed — existing lens + pub/sub covers this.

**Decisions produced:** ADR-021, ADR-022, ADR-023, ADR-024, ADR-025.

**Status.** RESOLVED. No design gaps remain for the analyst case. Implementation can proceed.

---

## 2 · Switchman as dependency vs. own-implementation for file locks

**Scenario.** Atelier's lock + fencing primitive overlaps with Switchman's core offering. Switchman (full product April 2026) ships MCP-based file-level locks with support for Claude Code, Cursor, Codex, Windsurf, Aider.

**Open questions:**
- Does Switchman expose fencing tokens in its public API or is that internal?
- Is Switchman's license compatible with Atelier's OSS distribution model?
- How stable is Switchman's API surface? Are there public version/deprecation policies?
- What's the maintainer health (solo vs team)? Single-maintainer dependencies carry abandonment risk.

**Recommendation.** Evaluate Switchman's public surface before v1 commit. If it's stable with fencing + clean MCP, integrate and inherit ~2 weeks of work. If any concern, own-implementation.

**Status.** OPEN. Pending evaluation.

---

## 3 · Embedding-model default + swappability for fit_check

**Scenario.** Fit_check's precision depends on the embedding model's semantic representation of decisions + contributions + BRD/PRD sections + research artifacts.

**Open questions:**
- What's the default? Candidates:
  - External API (OpenAI `text-embedding-3-small`, Cohere Embed v3) — adequate, cheap, but adds external dependency + data-egress concerns for regulated teams
  - Self-hostable open model (BGE-large-en, E5, etc.) — eliminates external dependency but adds hosting cost
- How does model choice affect the eval set? The eval set's labels assume a particular similarity behavior.
- How is model swappability implemented? Re-embed the whole index on switch, or maintain multiple indices?

**Recommendation.** Benchmark ≥3 candidates on the seed eval set. Default to a self-hostable model for regulated-team viability. Document swappability as a first-class config knob with a documented re-index procedure.

**Status.** OPEN. Pending benchmark.

---

## 4 · Contract-breaking-change heuristics

**Scenario.** A territory owner publishes a contract update. The system classifies it as "breaking" (routes through proposal flow) or "additive" (broadcasts immediately).

**Open questions:**
- What heuristics classify a contract change as breaking?
  - Obvious breaking: removed fields, narrowed type constraints, renamed fields
  - Ambiguous: added optional fields (could break consumers with strict validators), reordered fields, moved defaults
- Should the publisher have an override ("I know this looks breaking; it's not")?
- How do we handle contract versioning over time? Semver-style? Monotonic? Snapshot per commit?

**Recommendation.** Conservative defaults (any field removal, narrowing, or rename = breaking). Publisher override with justification required. Semver-style versioning with major-version bump on breaking. Document heuristics so consumers understand what triggers a proposal.

**Status.** OPEN.

---

## 5 · Identity-service default

**Scenario.** Atelier requires an identity service for per-composer signed tokens. Options:
- Self-hosted OIDC (complex deploy; team owns identity)
- External provider (Auth0, Clerk, Supabase Auth, etc. — clean integration but vendor dependency)
- Bring-your-own with a documented default

**Open questions:**
- What's the default that ships with `atelier init`?
- For teams with existing SSO, how does Atelier integrate without making them set up a separate identity service?
- What's the token-rotation UX? How do composers rotate their own tokens?

**Recommendation.** BYO with a documented default recipe (most likely a specific external provider for the default to reduce ceremony). Support SSO federation via OIDC claims mapping.

**Status.** OPEN.

---

## 6 · Upgrade path semantics for template versions

**Scenario.** A team on Atelier template v1.0 wants to adopt template v1.1 without re-scaffolding.

**Open questions:**
- `atelier upgrade` runs migrations. What about authored content that conflicts with new defaults?
- Are migrations idempotent? Reversible?
- How does the datastore schema get migrated? Compatibility window for in-flight contributions across versions?
- Do projects have to upgrade in lockstep if they share a hive?

**Recommendation.** Migrations are additive-preferred (no destructive changes). Conflicts reported, not auto-resolved. Datastore schema supports N and N−1 simultaneously for a grace window. Projects upgrade independently within a hive.

**Status.** OPEN.

---

## 7 · Scale ceiling per hive

**Scenario.** One hive hosts N projects with M composers total. What are the design limits?

**Open questions:**
- Is the blackboard pub/sub single-channel per-project or per-hive? Pub/sub load scales accordingly.
- Vector index size: embeddings for all decisions + contributions + BRD sections + research across all projects. What's the ceiling before query p95 degrades?
- Reaper cron runs across all projects — does it parallelize per-project or scan one table?

**Recommendation.** Document supported scale envelope (e.g., up to 10 projects × 20 composers × 10K contributions per project = 2M rows). Beyond that, recommend multiple hives per team.

**Status.** OPEN. Benchmark required.

---

## 8 · Cross-composer cost accounting

**Scenario.** Each composer's agent consumes LLM tokens (for their own agent usage and for Atelier-side operations like fit_check embedding). How does a team manage aggregate spend?

**Open questions:**
- Is there a composer-level budget or project-level budget?
- Is fit_check embedding cost charged per call (borne by the caller) or amortized (borne by the project)?
- How does the admin see cost breakdown? Is this v1 scope?

**Recommendation.** Out of v1 scope for most categories. Fit_check embedding cost is amortized to the project. Observability includes token-usage telemetry so teams can see cost retrospectively. Active cost-governance is a v1.x addition if demand surfaces.

**Status.** OPEN (scoped OUT of v1 unless demand flips).

---

## 9 · Cross-repo projects

**Scenario.** A project spans multiple repositories (e.g., frontend + backend in separate git repos).

**Open questions:**
- Can one Atelier project reference multiple repos?
- How does the traceability registry work across repos?
- Do file-based artifact_scope patterns work across repo boundaries?

**Recommendation.** v1 supports one-repo-per-project. Multi-repo is a v1.x addition with `.atelier/repos.yaml` listing additional repos and scope patterns with repo-qualified paths (`repo://name/path`).

**Status.** DEFERRED to v1.x.

---

## 10 · Offline / disconnected mode

**Scenario.** A composer is offline for an extended period. What works? What doesn't?

**Open questions:**
- Can a dev work in the repo with their agent offline? Yes — git + `get_context` can fall back to local constitution files + local decisions.md cache.
- Can they claim contributions offline? No — that requires datastore.
- What happens on reconnect? Replay? Merge conflicts?

**Recommendation.** Document the capability matrix. Offline: read canonical state + edit files + commit. Online-required: claim contributions, acquire locks, log decisions, fit_check. On reconnect: session re-registers; conflicts reported, not auto-resolved.

**Status.** OPEN. Document for v1.

---

## 11 · Solo-to-hive transition

**Scenario.** A solo dev starts a project with `atelier init --local-only`. Six months later, they want to add collaborators.

**Open questions:**
- How does `atelier datastore init` migrate local state (SQLite + file-based pub/sub) to production datastore?
- Is decision history preserved across the transition?
- Do local-only fencing tokens remain valid?

**Recommendation.** Migration script. Full decision-log transfer. Fencing counter reset at transition with a note in `decisions.md`.

**Status.** OPEN. Design v1 scope.

---

## 12 · Fit_check sensitivity trade-off

**Scenario.** Fit_check returns matches above similarity threshold. Too sensitive = false positives blocking legitimate work. Too loose = duplicate implementations slip through.

**Open questions:**
- Where does the default threshold sit? 0.75? 0.80? 0.85?
- Is threshold per-project-configurable or global?
- Do composers see all matches below threshold (as "weak suggestions") or only those above?

**Recommendation.** Default threshold 0.80 (tuned against seed eval set). Per-project configurable. UI shows matches ≥0.80 prominently and matches 0.65–0.80 as collapsible "weak suggestions."

**Status.** OPEN. Benchmark required.

---

## 13 · Decision-log growth and searchability

**Scenario.** A long-running project accumulates thousands of decisions. `decisions.md` becomes large and hard to navigate.

**Open questions:**
- Is `decisions.md` a single file or partitioned (e.g., per-quarter or per-epic)?
- How does fit_check handle a large decision log — all in one vector index, or sharded?
- Is there a "decisions view" in the prototype that makes old decisions discoverable?

**Recommendation.** Single file at v1 with a documented 10K-entry ceiling. Partitioning is v1.x with `decisions/YYYY-MM.md` files and a rollup index. `/atelier/decisions` route with filters and search. fit_check handles scale via vector-index sharding at query time.

**Status.** DEFERRED partitioning to v1.x. Design single-file at v1 with ceiling documented.

---

## 14 · Analyst-proposed territory changes

**Scenario.** An analyst decides the `strategy` territory's scope pattern is too narrow — they want to include `research/**` alongside `BRD.md#*`.

**Open questions:**
- Who has authority to modify territory definitions? Is it by role? By explicit admin assignment?
- Does a territory change require a cross-composer vote or just the admin?
- Does modifying `territories.yaml` trigger a proposal flow or is it an immediate change?

**Recommendation.** Territory changes are repo-committed PRs. Any composer can propose; admin (or defined approver role) must merge. Change takes effect on merge + datastore reload.

**Status.** OPEN.

---

## 15 · Prototype deployment per environment

**Scenario.** A team wants different Atelier environments (staging, production). How?

**Open questions:**
- One hive with multiple projects representing environments, or one project with multiple deploy targets?
- Are sessions/contributions shared across environments or isolated?

**Recommendation.** Environments are separate projects within one hive. Each has its own repo branch, datastore schema namespace, deploy target. Cross-environment references via trace IDs if needed. Documented pattern, not a schema construct.

**Status.** DOCUMENTED convention (no schema change).

---
