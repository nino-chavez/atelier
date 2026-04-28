# BRD Open Questions

**Context.** Questions surfaced during design that must be answered before or during v1 build. Each item is an explicit decision point, not a defect.

**Last updated:** 2026-04-28 (section 24 added on branch reaping in `reconcile.ts`, surfaced by the second-pass post-compact red-team audit; sections 3, 7, 19, 21, 22, 23, 24 are the genuinely-open list)

**File structure.** Open entries with full context appear first. Resolved entries below are compressed to one-line redirects pointing at the canonical home where each decision now lives. Original numbering is preserved so external references (e.g., "see BRD-OPEN-QUESTIONS section 14") still resolve. Full historical text of resolved entries is in git history.

---

## Open

Seven entries remain genuinely open. Sections 3 and 7 require benchmark data; section 19 requires a strategic call on adding a new contribution-lifecycle state; sections 21, 22, 23 surfaced by the 2026-04-28 AI-speed red-team pivot and require strategic calls on whether to extend the v1 surface (auto-reviewers, semantic validator, contribution annotations) or defer to v1.x; section 24 surfaced by the 2026-04-28 second-pass red-team audit and asks whether `reconcile.ts` should grow a branch-reaping pass to bound git-rot from AI-speed contribution churn. None blocks M1; section 19 wants resolution before M2 contribution-lifecycle endpoint work; sections 21-23 want resolution before M5/M6; section 24 wants resolution before M2 (when `reconcile.ts` lands per BUILD-SEQUENCE M1 ordering).

### 3 · Embedding-model default + swappability for find_similar

**Scenario.** Find_similar's precision depends on the embedding model's semantic representation of decisions + contributions + BRD/PRD sections + research artifacts.

**Open questions:**
- What's the default? Candidates:
  - External API (OpenAI `text-embedding-3-small`, Cohere Embed v3) — adequate, cheap, but adds external dependency + data-egress concerns for regulated teams
  - Self-hostable open model (BGE-large-en, E5, etc.) — eliminates external dependency but adds hosting cost
- How does model choice affect the eval set? The eval set's labels assume a particular similarity behavior.
- How is model swappability implemented? Re-embed the whole index on switch, or maintain multiple indices?

**Recommendation.** Benchmark ≥3 candidates on the seed eval set. Default to a self-hostable model for regulated-team viability. Document swappability as a first-class config knob with a documented re-index procedure.

**Hybrid fallback (per 2026-04-28 expert review).** The ADR-006 precision gate (>=75% precision at >=60% recall) is aggressive. If the M5 benchmark consistently shows <70% precision against the seed eval set, the duplication-detection value prop weakens. Recommendation: design `find_similar` from M5 onward with a keyword-heavy semantic-hybrid retrieval path (semantic vector search + BM25-or-equivalent keyword search, scores combined via reciprocal rank fusion or similar) so the system degrades gracefully when the embedding model alone underperforms. The existing `degraded=true` flag on `find_similar` responses already supports this -- the hybrid path is the fallback that fills the degraded path with usable results rather than pure keyword search. Decision on whether to ship hybrid as default vs. as a fallback lands with the embedding benchmark resolution.

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

Split into `composers.discipline` (5 values including newly-added `architect`) + `composers.access_level` (3 values).

**Status.** RESOLVED 2026-04-28. See [ADR-038](../architecture/decisions/ADR-038-composer-role-split-into-discipline-plus-access-level.md). Resolved same-day per expert-review prompt that surfaced this should land before M1 schema implementation, not v1.x. The fix also closed a previously-undetected drift: `architect` was used as `owner_role` across 4 territories but missing from the composers enum -- now first-class as `discipline=architect`.

---

### 21 - AI auto-reviewers as a `review_role` type

**Scenario.** Per ADR-025, `territories.review_role` keys to a composer role (architect, dev, pm, designer). Every `state=review` transition routes to a human in that role. In an AI-speed reality (per the 2026-04-28 AI-speed red-team pivot), this is the dominant bottleneck: AI implements in 2 min, human approves in 4 hrs. On a 1-human-N-agent team, the human cannot keep up even with engaged attention.

The 2026-04-28 expert review's Opportunities table explicitly named "Auto-Reviewers: Using AI to perform the review_role for 90% of tasks" as the highest-leverage opportunity.

**Open questions:**
- Should `territories.review_role` accept non-human values (e.g., `review_role: ai-validator`)? Or should the existing role values gain an "AI delegate" sub-config (e.g., `review_role: dev` with `dev.ai_auto_approve: <criteria>`)?
- What criteria gate AI auto-approval? Likely a configurable mix of: (a) contribution kind (implementation/research/design), (b) requires_owner_approval flag (always defer to human if set), (c) territory sensitivity tier (low / medium / high), (d) PR diff size, (e) test-pass status, (f) find_similar exclusion (no >0.85 matches).
- What's the AI reviewer's specific check surface? Spec-match (does the PR implement the cited ARCH section?), test-pass, lint-pass, no contradiction with prior ADRs, no overlap with active locks?
- What's the audit trail? Every AI auto-approval needs to be revocable (a human reviewer can later override + re-trigger review with reasoning recorded).
- How does this interact with `requires_owner_approval=true` (from ADR-033 cross-role authoring + triage)? Likely: AI may NOT clear this flag; only human reviewers can. AI auto-approves only when `requires_owner_approval=false`.

**Recommendation.** Extend the territory schema with an optional `ai_review_policy` block (off by default). When enabled, the AI reviewer runs its check surface and either auto-approves (recording an audit-trail entry) or escalates to the human in `review_role`. Human reviewers can override AI approvals retroactively via a new tool or an `update(state="review", reopen=true)` semantic. Cross-role contributions (`requires_owner_approval=true`) are excluded from AI auto-approval per the merge-gate logic in ADR-033.

This is the single highest-leverage v1.x feature. Worth landing at M6 (alongside remote-principal composers + triage, which are the other AI-coordination concentrations) as ADR-039 + ARCH 6.2.3 extension + territory schema addition.

**Status.** OPEN. Strategic call: does this land at v1 or v1.x? Recommendation is v1.x (M6) because the find_similar precision data (M5) informs the auto-approve thresholds. v1 reserves the config surface (`territories.<name>.ai_review_policy: null`) so adoption doesn't require a schema migration. Surfaced by 2026-04-28 AI-speed red-team pivot.

---

### 22 - Semantic contradiction check in the validator

**Scenario.** The `scripts/traceability/validate-refs.mjs` validator (per scripts/README.md "Extended cross-doc consistency") catches syntactic drift: trace IDs resolve, ADR sections exist, frontmatter valid. It does NOT catch semantic drift: "this new ADR contradicts the NORTH-STAR" or "this new contribution implements the opposite of what the cited BRD story specifies."

In an AI-speed reality, agents may generate ADRs at scale that pass syntactic checks but contain subtle contradictions with the canonical state. The 2026-04-28 AI-speed red-team pivot named this "Hallucinated Decision Debt" / "Audit Exhaustion" -- the human architect drowns in 80%-correct rationale.

**Open questions:**
- Should the validator gain a semantic contradiction check class? If yes, when does it run (per-PR? milestone-entry? both?)?
- What's the implementation? Likely an LLM-based check that compares the new ADR/contribution against canonical state (NORTH-STAR + relevant ARCH sections + recent ADRs) and flags potential contradictions for human review.
- What's the cost? An LLM call per PR adds latency + token spend. Worth it on PRs touching `docs/architecture/decisions/` and `docs/functional/BRD.md`; probably not on every code PR.
- What's the failure mode? False positives (the AI flags non-contradictions) waste human time. False negatives (the AI misses real contradictions) defeat the purpose. Need a calibration mechanism.
- How does this interact with section 21 (AI auto-reviewers)? They share the AI-judgment surface. Likely the same `review.ai_judgment` config block governs both: enable, disable, model selection, threshold tuning.

**Recommendation.** Add `semantic_contradiction_check` as an optional check class in scripts/README.md "Extended cross-doc consistency" (off by default). Implementation lands at M5 alongside find_similar productionization (similar LLM-based reasoning surface; can share infrastructure). Default scope: PRs touching `docs/architecture/decisions/`, `docs/functional/BRD.md`, `docs/strategic/NORTH-STAR.md`. Output: per-PR comment listing potential contradictions with citations to the prior canonical content.

The check is advisory at v1.x (warns, never blocks). Promoting to blocking is a per-project policy decision based on observed false-positive rate.

**Status.** OPEN. Strategic call: does the cost (LLM calls per PR + calibration overhead) justify the catch (catching subtle AI-generated drift that syntactic checks miss)? Recommendation is yes for ADR-touching PRs at M5, no for code PRs at v1. Surfaced by 2026-04-28 AI-speed red-team pivot.

---

### 23 - Lightweight annotations on contributions (`comment_on_contribution`)

**Scenario.** Decisions and rationale are currently captured via:
- ADR rationale field (for log_decision-shaped decisions)
- contribution.content_ref (the artifact body)
- contribution.transcript_ref (agent session transcript per ADR-024)
- PR comments (in git, not in datastore)

What's missing: lightweight inline rationale on a contribution that does NOT justify a full ADR. Example: a Slack-equivalent "I rejected this proposal because the territory's contracts forbid X -- see contract Y". Currently this rationale either becomes an ad-hoc PR comment (visible in GitHub but not in `/atelier`) or vanishes into chat (Slack/Teams).

The 2026-04-28 red team's Gap A named this "Slack dark matter": decisions still happen in chat, the canonical state captures only the post-hoc summary. ADR-010 explicitly excludes building a chat app, but lightweight annotations on coordination objects are NOT a chat app.

GitHub ACE (per 2026-04-28 strategy addendum on AI-speed coordination) is making the opposite bet: building chat directly into the tool. Atelier's bet remains that chat lives elsewhere (Slack/Teams) but COORDINATION-OBJECT annotations live in the datastore for canonical-state durability.

**Open questions:**
- Add an `annotations` field to `contributions` (and `decisions`?) -- a list of `{author_composer_id, body, created_at}` records?
- Or add a new `annotations` table referencing contributions/decisions, with its own RLS?
- What's the API? A new tool `annotate(target_kind, target_id, body)` would add a 13th MCP tool (per ADR-013); alternatively, reuse `update()` with an optional `annotation` parameter.
- What's the rendering surface? `/atelier` contribution-detail and decision-detail panels show the annotation thread. PR comments still flow through GitHub natively; the annotation surface is for non-PR-shaped rationale.
- How does this interact with the audit trail? Annotations are append-only? Editable by their author within a window? Soft-deletable by admins?

**Recommendation.** Add `annotations` as a new table (cleaner RLS than embedded list; better query patterns). New tool `annotate(target_kind, target_id, body)` -- accepts `target_kind in (contribution, decision)` plus the target's UUID. Append-only at v1 (no edits, no deletes -- soft-flag spam via admin tool). Render in `/atelier` contribution + decision panels. Bumps the MCP tool count to 13; document in ADR-013 as a v1.x extension that fits within the protocol's design.

**Status.** OPEN. Strategic call: does adding a 13th MCP tool + a new schema table for annotations cross the line into "Atelier becomes a wiki" (which ADR-010 excludes)? Recommendation is no -- annotations are coordination-object metadata, not standalone content. But the boundary is worth being explicit about. If accepted, lands at v1.x (M6 alongside other coordination-surface enhancements) as ADR-040.

Surfaced by 2026-04-28 red-team Gap A + reinforced by GitHub ACE intel showing market interest in tool-resident chat.

**Update 2026-04-28 (post-chatbot-pattern landing).** The chatbot-as-MCP-client pattern (per `../user/connectors/chatbot-pattern.md`) covers much of this motivation: lightweight rationale flows through the chat surface where humans already are, and gets canonicalized via `log_decision` (with `transcript_ref` capturing the conversation under ADR-024). Annotations remain a separable concern only for non-chat contexts (e.g., a designer in `/atelier` wanting to attach a note to a contribution without opening chat). The strategic call now narrows to: is the non-chat annotation use case load-bearing enough for a 13th tool, or does the chatbot pattern + existing PR comment surface cover the practical need? Recommendation softens: defer to v1.x M6 with a higher bar to land (concrete pre-M6 user request needed, not speculative coordination-surface gap).

---

### 24 - Branch reaping in `reconcile.ts` for AI-speed contribution churn

**Scenario.** The throwaway-branches convention (per `../../scripts/README.md` from the 2026-04-28 AI-speed pivot) commits per-contribution branches in the form `atelier/<contribution-id>` so multiple agents can work concurrently without trampling each other's working tree. At AI implementation speed, a guild may produce hundreds of `atelier/*` branches per week. The datastore reaper handles session + lock cleanup, but no current spec addresses long-stale branches whose contributions have been merged or rejected days ago.

This was surfaced by the 2026-04-28 second-pass red-team audit (Weakness: "Git Rot — While the datastore is reaped, the repo accumulates hundreds of AI-speed branches with no specified GIT_REAPER policy"). The first-pass post-implementation symptom would be: `git branch -r` listing 500+ stale `atelier/*` branches, slowing fetch, cluttering UI, and obscuring active work.

**Open questions:**
- Where does branch reaping live? Existing-primitives check answer: `reconcile.ts` already walks repo state vs. datastore state; a branch-reaping pass is a natural extension, not a new script.
- What's the deletion criterion? Likely: contribution merged or rejected, branch's last commit older than N days (default 30?), no open PR referencing the branch.
- Local vs remote? Reconcile is server-side; it deletes remote branches. Local branches on composer machines are out of scope (composer's git client handles those).
- What about branches whose contribution row has been deleted (e.g., session reaping cascaded a delete)? Likely: orphaned `atelier/*` branches with last-commit > N days are also reapable, per the same age criterion.
- Does the reaping pass run on the same cadence as the existing reconcile cron, or separately? Likely same cron; a dry-run flag for the first M2 deployment lets the team eyeball the deletion list before enabling actual deletion.
- Configuration surface? `.atelier/config.yaml: reconcile.branch_reaping: { enabled: bool, max_age_days: int, dry_run: bool }` -- defaults to enabled=false at v1 (opt-in until a team has operational data on what's safe to delete), with the toggle documented in the M2 launch runbook.

**Recommendation.** Extend `reconcile.ts` (M1 deliverable per BUILD-SEQUENCE) with a branch-reaping pass guarded by a config flag. No new script, no new ADR. Document the criterion + defaults in `scripts/README.md` reconcile section. The existing reconcile script already has the right shape (idempotent, server-side, runs as cron); branch reaping adds one more pass to its loop.

**Status.** OPEN. Wants resolution before `reconcile.ts` lands at M1 (so the script ships with the branch-reaping pass present-but-default-off, rather than requiring a follow-up edit to add it). Strategic call is small: confirm the recommendation OR explicitly defer the pass to v1.x and accept manual `git push origin --delete` as the v1 hygiene path.

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
