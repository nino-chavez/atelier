# BRD Open Questions

**Context.** Questions surfaced during design that must be answered before or during v1 build. Each item is an explicit decision point, not a defect.

**Last updated:** 2026-04-24 (pre-build)

---

## 1 · Territory-model validation on the analyst case

**Scenario.** An analyst composer begins week-1 competitive research on US-1.3. They connect their web-based agent client via remote protocol, register a session with `locus=web`, and need to:

1. Read the current strategy context for US-1.3
2. Claim a research artifact contribution
3. Run fit_check to see if prior research exists
4. Author research content via their agent
5. Log decisions about findings
6. Release the contribution for PM review

**Open questions:**
- Does the territory schema with `scope_kind=research_artifact` + `scope_pattern=research/**` cleanly support this flow? Or does the schema need a structural rework for knowledge-work artifact types?
- What happens when the analyst's research touches multiple trace IDs (e.g., research on US-1.3 reveals implications for US-1.5)? Does it become two contributions, or one with multi-trace-ID?
- How are agent-session transcripts stored alongside the distilled research artifact? Sidecar file? External blob store?
- When the analyst releases the contribution to `review`, who (which role + which lens) sees it for triage/approval?

**Recommendation.** Walk the scenario end-to-end through the schema + endpoint + prototype views **before any code is written**. If a step requires a concept not yet in the design, add it to the design — don't code around it.

**Status.** **RESOLVED** (2026-04-24). Walk completed in `../architecture/walks/analyst-week-1.md`. Five gaps surfaced and landed:

| Gap | ADR | Sub-question resolved |
|---|---|---|
| #1 — Contribution creation path for ad-hoc work | ADR-022 (claim atomic-creates) | Q: who creates the open row? A: `claim` does, atomically |
| #2 — Remote-locus repo write path unspecified | ADR-023 (per-project endpoint committer) | Implicit gap surfaced and closed via ARCH §7.8 |
| #3 — Transcript storage | ADR-024 (sidecar, opt-in) | Q3 |
| #4 — Multi-trace-ID support | ADR-021 (`trace_ids text[]`) | Q2 |
| #5 — Lens routing for `state=review` | ADR-025 (`territory.review_role`) | Q4 |

Q1 (does `scope_kind=research_artifact` + `scope_pattern=research/**` cleanly support the flow?) — **yes**, confirmed against `.atelier/territories.yaml`. No schema change needed.

---

## 2 · Switchman as dependency vs. own-implementation for file locks

**Scenario.** Atelier's lock + fencing primitive overlaps with Switchman's core offering. Switchman (full product April 2026) ships MCP-based file-level locks with support for Claude Code, Cursor, Codex, Windsurf, Aider.

**Open questions:**
- Does Switchman expose fencing tokens in its public API or is that internal?
- Is Switchman's license compatible with Atelier's OSS distribution model?
- How stable is Switchman's API surface? Are there public version/deprecation policies?
- What's the maintainer health (solo vs team)? Single-maintainer dependencies carry abandonment risk.

**Recommendation.** Evaluate Switchman's public surface before v1 commit. If it's stable with fencing + clean MCP, integrate and inherit ~2 weeks of work. If any concern, own-implementation.

**Status.** **RESOLVED** (2026-04-25). Own-implementation. See ADR-026 and PRD-COMPANION D22 for the full evaluation rubric. Headline: Switchman is MIT/MCP-native but its lease+scope model exposes **no fencing tokens**, which disqualifies it under ADR-004 (fencing mandatory on every lock from v1). Re-evaluation trigger: Switchman 1.0 with explicit fencing-token API + semver commitment.

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

**Status.** **RESOLVED** (2026-04-25). Default: **Supabase Auth** (sub-decision of ADR-027 reference stack). BYO via OIDC federation through `.atelier/config.yaml: identity.provider`. See ADR-028 and PRD-COMPANION D23.

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

**Recommendation.** Migration script. Full decision-log transfer (all per-ADR files preserved with provenance). Fencing counter reset at transition with a new ADR documenting the cutover.

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

**Scenario.** A long-running project accumulates thousands of decisions. The decision log must remain navigable.

**Open questions (closed by ADR-030):**
- Is the decision log a single file or partitioned? → **Per-ADR file from v1**, one file per ADR under `../architecture/decisions/`. Each file is independently navigable, diffable, and `git blame`-able.
- How does fit_check handle a large decision log? → Vector index ingests one embedding per ADR file. Sharding becomes a query-time concern only at very large scales (>10K ADRs); not a v1 problem.
- Is there a "decisions view" in the prototype? → Yes: `/atelier/decisions` route per Epic 12 plans, surfacing the directory's index README plus per-ADR detail.

**Status.** **RESOLVED** (2026-04-25) by ADR-030 (per-ADR file split). Per-file model from v1 means there is no "single-file growth" problem to defer; the problem is structurally avoided.

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
