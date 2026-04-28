# BRD Open Questions

**Context.** Questions surfaced during design that must be answered before or during v1 build. Each item is an explicit decision point, not a defect.

**Last updated:** 2026-04-28 (section 20 added per pre-M1 data-model audit F12; sections 3, 7, 19, 20 are the genuinely-open list)

**File structure.** Open entries with full context appear first. Resolved entries below are compressed to one-line redirects pointing at the canonical home where each decision now lives. Original numbering is preserved so external references (e.g., "see BRD-OPEN-QUESTIONS section 14") still resolve. Full historical text of resolved entries is in git history.

---

## Open

Four entries remain genuinely open. Sections 3 and 7 require benchmark data; section 19 requires a strategic call on whether to add a new contribution-lifecycle state; section 20 requires a strategic call on splitting the composer role enum (surfaced by the pre-M1 data-model audit). None blocks M1; section 19 wants resolution before M2 contribution-lifecycle endpoint work lands; section 20 wants resolution before deployment exposes the conflation in real teams.

### 3 · Embedding-model default + swappability for find_similar

**Scenario.** Find_similar's precision depends on the embedding model's semantic representation of decisions + contributions + BRD/PRD sections + research artifacts.

**Open questions:**
- What's the default? Candidates:
  - External API (OpenAI `text-embedding-3-small`, Cohere Embed v3) — adequate, cheap, but adds external dependency + data-egress concerns for regulated teams
  - Self-hostable open model (BGE-large-en, E5, etc.) — eliminates external dependency but adds hosting cost
- How does model choice affect the eval set? The eval set's labels assume a particular similarity behavior.
- How is model swappability implemented? Re-embed the whole index on switch, or maintain multiple indices?

**Recommendation.** Benchmark ≥3 candidates on the seed eval set. Default to a self-hostable model for regulated-team viability. Document swappability as a first-class config knob with a documented re-index procedure.

**Status.** OPEN. Pending benchmark per `../testing/embedding-model-benchmark-plan.md`. Resolution gates M5 entry per BUILD-SEQUENCE section 7 question 3.

---

### 7 · Scale ceiling per guild

**Scenario.** One guild hosts N projects with M composers total. What are the design limits?

**Open questions:**
- Is the blackboard pub/sub single-channel per-project or per-guild? Pub/sub load scales accordingly.
- Vector index size: embeddings for all decisions + contributions + BRD sections + research across all projects. What's the ceiling before query p95 degrades?
- Reaper cron runs across all projects — does it parallelize per-project or scan one table?

**Recommendation.** Document supported scale envelope (e.g., up to 10 projects × 20 composers × 10K contributions per project = 2M rows). Beyond that, recommend multiple guilds per team.

**Status.** OPEN. Benchmark required per `../testing/scale-ceiling-benchmark-plan.md`. v1 envelope hypothesis committed; benchmark validates incrementally across M2 / M4 / M5 / M6. Two architectural side-deliverables surfaced by the planning analysis already landed (ARCH 6.1.2 session row cleanup, ARCH 6.8 broadcast topology).

---

### 19 - Plan-review checkpoint between claim and implementation

**Scenario.** A composer (or their agent) atomic-creates and claims a contribution per ARCH 6.2.1. Today the contribution lifecycle goes `open -> claimed -> in_progress -> review -> merged`. There is no checkpoint where a human edits the agent's intent before implementation begins. Implementation may take minutes; the only alignment touchpoint is PR review at the end, when the work is already done.

This pattern was surfaced by the 2026-04-28 strategy addendum (`../strategic/addenda/2026-04-28-multi-agent-coordination-landscape.md`) drawing on:
- Maggie Appleton's talk -- "alignment touchpoints have collapsed; PR holds all the coordination weight"
- ACE -- multiplayer sessions where teams collaboratively edit agent-generated plans before code is written
- SpecLang -- spec-as-source pattern
- Copilot Workspace -- plan-then-implement workflow

Three independent projects converge on the same pattern: agent generates plan -> team edits collaboratively -> code follows.

**Open questions:**
- Should Atelier add a `plan_review` state between `claimed` and `in_progress`?
- If yes, opt-in per territory (so simple work is not slowed) or default-on?
- What's the plan format -- free-form markdown? Structured (intent / approach / files-touched / risks)?
- Who approves -- the territory's `review_role`, or a different reviewer (the contribution requester, the cross-territory consumer)?
- What's the agent's behavior when the plan is rejected? Revise and re-submit, or release?
- Does plan_review require its own `acquire_lock` (agent grabs files mentioned in the plan), or are locks deferred to in_progress?

**Recommendation.** Add an opt-in `plan_review` state, gated per-territory via `territories.yaml: requires_plan_review: true` (default false to keep simple work fast). The agent calls `update(state="plan_review", payload=<plan markdown>, fencing_token=<from acquire_lock if files known>)`. The territory's `review_role` approves via `update(state="in_progress")` (with same author_session_id semantics as the original claim, i.e., only the original author can transition). On rejection, the contribution returns to `state=claimed` with the reviewer's comments stored in the contribution's content_ref or transcript_ref. Plan format is free-form markdown at v1; structured templates can be added per-territory at v1.x as a config knob.

This addresses the "should we build it" alignment bottleneck at the right point -- before code, not at PR. Per-territory opt-in means territories with established patterns (e.g., trivial config edits) don't pay the latency cost; territories with high-stakes work (e.g., architecture changes, design tokens) do.

**Status.** OPEN. Wants resolution before M2 contribution-lifecycle endpoint work lands. If accepted, becomes an ADR + ARCH addition (likely a new section 6.2.1.7 between 6.2.1.5 pre-existing claim path and 6.2.2 update operation semantics). If rejected, document the rejection rationale (e.g., "plan-as-checkpoint adds latency disproportionate to alignment value at Atelier's target team scale") and revisit if v1 deployment surfaces the gap.

---

### 20 - Composer role enum mixes work-discipline with access-level

**Scenario.** `composers.default_role` is currently a single enum: `analyst | dev | pm | designer | admin | stakeholder`. Four values are work disciplines (analyst, dev, pm, designer). Two are access levels (admin = platform privileges; stakeholder = read-only). Two axes in one field.

A pm is naturally also a stakeholder for work outside their territories. A designer might also need admin privileges. The current model handles this via "secondary roles per `.atelier/config.yaml`" but the primary role conflates the two. ADR-017 lenses (analyst/dev/pm/designer/stakeholder) further muddy the water -- stakeholder is a lens (a viewing mode) AND a role-permission. Two different concepts share the name.

Surfaced by `../architecture/audits/pre-M1-data-model-audit.md` finding F12.

**Open questions:**
- Does the enum need splitting into `discipline` (analyst | dev | pm | designer) + `access_level` (member | admin | stakeholder)? Or rename to acknowledge it's a fuzzy classifier?
- If split, what is the migration path for existing `default_role=admin` and `default_role=stakeholder` composers (they have no discipline)?
- Does the lens model in ADR-017 stay a 5-lens model with stakeholder-as-lens, or split lens-stakeholder from access-level-stakeholder?
- Does territories.yaml `owner_role` and `review_role` continue to reference the discipline values only (cleaner), or remain ambiguous?

**Recommendation.** Split into two columns: `composers.discipline (analyst | dev | pm | designer)` + `composers.access_level (member | admin | stakeholder)`. Cleanest semantically; matches how teams actually think about people ("Sarah is a designer who is also an admin"). Migration: existing `default_role=admin` composers default to `discipline=null, access_level=admin`; existing `default_role=stakeholder` composers default to `discipline=null, access_level=stakeholder`; the four discipline values map to `discipline=<value>, access_level=member`. ADR-017 lens model keeps the same five viewing modes; the stakeholder lens applies whenever `access_level=stakeholder` OR a discipline composer chooses to view-as-stakeholder.

**Status.** OPEN. Does not block M1 -- current enum works for the schema's first migration. The right resolution touches `.atelier/territories.yaml` owner_role/review_role values, BRD acceptance criteria referencing roles, and the lens-vocabulary in ADR-017. Wants resolution before deployment surfaces the conflation in real teams. Likely lands as ADR-038 + a coordinated migration commit.

---

## Resolved

Each entry below is a one-line redirect to the canonical home where the decision now lives. Recommendations and full Q-and-A blocks have been removed to avoid parallel-summary drift per METHODOLOGY section 6.1; see git history for the original full-context entries.

### 1 - Territory-model validation on the analyst case

Validate territory model end-to-end against an analyst's web-surface week-1 research scenario.

**Status.** RESOLVED 2026-04-24. See `../architecture/walks/analyst-week-1.md` and ADRs 021/022/023/024/025. Five gaps surfaced and landed via the walk; territory schema confirmed adequate for research_artifact flows. Walk re-examined 2026-04-27 with the latent-gaps discipline; see walk section 7 for the per-step audit-trail of additional ARCH subsections folded in.

---

### 2 - Switchman as dependency vs. own-implementation for file locks

Decide whether to integrate Switchman or build Atelier's own lock + fencing implementation.

**Status.** RESOLVED 2026-04-25. See ADR-026. Own-implementation; Switchman lacks a fencing-token API, disqualifying under ADR-004.

---

### 4 - Contract-breaking-change heuristics

Define when a territory contract change classifies as breaking vs additive.

**Status.** RESOLVED 2026-04-27. See ARCH section 6.6.1. Conservative classifier table with publisher override (justification required) and semver-style versioning.

---

### 5 - Identity-service default

Pick the default identity service shipped with `atelier init`.

**Status.** RESOLVED 2026-04-25. See ADR-028. Default Supabase Auth; BYO via OIDC federation through `.atelier/config.yaml: identity.provider`.

---

### 6 - Upgrade path semantics for template versions

Define how a team adopts a new Atelier template version without re-scaffolding.

**Status.** RESOLVED at design level 2026-04-27. See ARCH section 9.7. Additive-preferred + idempotent migrations, no auto-rollback, schema N/N-1 co-existence, no-lockstep upgrades. Data-dependent residue: grace-window length tuned post-M7 from operational experience.

---

### 8 - Cross-composer cost accounting

Manage aggregate LLM-token spend across a team's composers + Atelier-side operations.

**Status.** RESOLVED at v1 design level 2026-04-28. v1 ships visibility (token-usage telemetry per ARCH 8.1, Cost lens in /atelier/observability per ARCH 8.2). Active cost-governance (budgets, hard limits) explicitly DEFERRED to v1.x with trigger "if demand surfaces"; v1 telemetry is the substrate any future governance work builds on.

---

### 9 - Cross-repo projects

Atelier projects spanning multiple git repositories.

**Status.** RESOLVED as deferral 2026-04-28. v1 commitment "one repo per project" landed in ARCH 9.2 with rationale and workarounds. v1.x extension hook (`.atelier/repos.yaml` with `repo://name/path` scope qualifier) sketched; designed when the v1.x epic is authored.

---

### 10 - Offline / disconnected mode

Specify what works and doesn't for a composer offline.

**Status.** RESOLVED 2026-04-27. See ARCH section 9.6. Capability matrix + reconnect semantics; web-surface composers explicitly offline-incapable.

---

### 11 - Solo-to-guild transition

Define how a solo `atelier init --local-only` project promotes to a guild-shared deployment.

**Status.** RESOLVED at design level 2026-04-27. See ARCH section 9.5. Additive-preferred migration, full decision-log transfer, fencing reset with a transition ADR. Operational runbook lands at M7 alongside `atelier upgrade`.

---

### 12 - Find_similar sensitivity trade-off

Set find_similar threshold + UI presentation policy.

**Status.** RESOLVED at design level 2026-04-27. See ARCH section 6.4.1. Two-band response (primary + weak), per-project configurable, top-k per band. Data-dependent residue: actual default-threshold value tuned at M5 against the seed eval set per ADR-006.

---

### 13 - Decision-log growth and searchability

Keep a long-running project's decision log navigable.

**Status.** RESOLVED 2026-04-25. See ADR-030. Per-ADR file split structurally avoids the single-file growth problem.

---

### 14 - Analyst-proposed territory changes

Govern who can modify territory definitions and how.

**Status.** RESOLVED 2026-04-27. See `../../.atelier/territories.yaml` header. Any composer proposes via PR; admin (or delegated approver per `config.yaml`) merges; effect on merge + next datastore reload via the M1 territories-mirror sync script.

---

### 15 - Prototype deployment per environment

Run multiple Atelier environments (staging, production).

**Status.** DOCUMENTED convention. Environments are separate projects within one guild; each has its own repo branch, datastore schema namespace, deploy target. Cross-environment refs via trace IDs. No schema change.

---

### 16 - Adapter sequencing within M1

Decide whether all five non-GitHub external adapters ship at M1 or are sequenced.

**Status.** RESOLVED 2026-04-27. See `../strategic/BUILD-SEQUENCE.md` M1.5. M1 ships the adapter interface + GitHub adapter; M1.5 ships Jira/Linear/Confluence/Notion/Figma with their own integration tests and per-provider runbooks under `docs/user/integrations/`. All five remain v1 scope per ADR-011; only their construction order is sequenced.

---

### 17 - Round-trip whitelist surface

Define what counts as permissible normalization vs drift in the M1 round-trip integrity test.

**Status.** RESOLVED 2026-04-27. See `../../scripts/README.md` "Round-trip integrity contract". Filed as a question in error; was a spec gap (recommendation became spec).

---

### 18 - publish-delivery trigger model (pre-broadcast-substrate)

Pick the trigger mechanism for publish-delivery before the broadcast substrate exists.

**Status.** RESOLVED 2026-04-27. See `../../scripts/README.md` "publish-delivery trigger model". Polling at M1, post-commit hooks at M2, broadcast subscription at M4 -- non-destructive cutover at each milestone.
