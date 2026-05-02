# BRD Open Questions

**Context.** Questions surfaced during design that must be answered before or during v1 build. Each item is an explicit decision point, not a defect.

**Last updated:** 2026-05-02 (sections 26 and 27 RESOLVED via ADR-047 wider-eval result on the claude-agent-sdk corpus; section 28 RESOLVED via ADR-046 codifying the empirical M6-entry deploy choices; section 7 partially resolved as bounded harness landing; section 29 ADDED as `atelier upgrade` scope-deferral alongside the 12-command CLI polish PR; sections 21, 22, 23, 29 are the genuinely-open list)

**File structure.** Open entries with full context appear first. Resolved entries below are compressed to one-line redirects pointing at the canonical home where each decision now lives. Original numbering is preserved so external references (e.g., "see BRD-OPEN-QUESTIONS section 14") still resolve. Full historical text of resolved entries is in git history.

---

## Open

Three entries remain genuinely open (down from seven post-M7 Track 2). Sections 21, 22, 23 surfaced by the 2026-04-28 AI-speed red-team pivot — §22 schema-reservation landed at M7 Track 2; §21 (AI auto-reviewers) and §23 (annotation surface) remain genuinely open as v1.x defer with adopter-signal bar held. Section 7 (scale ceiling) was partially resolved at M7 Track 2 — the bounded harness landed (`scripts/test/scale/load-runner.ts` + ARCH §9.8 envelope commitment); empirical override pending operator runs of the harness. Section 28 (deploy trigger conditions) was resolved 2026-05-02 as ADR-046 — trigger #2 (claude.ai Connectors blocked on local-only) fired empirically at M6 entry; ADR codifies the empirical Vercel + Supabase Cloud choices that landed `atelier-three-coral.vercel.app`. Section 26 (multi-corpus generalization) was resolved 2026-05-02 via ADR-047 — wider eval against claude-agent-sdk public docs measured P=0.5540 / R=0.5423; the unanticipated finding that advisory tier is corpus-dependent prompted ADR-043 reversal of the blocking-tier framing. Section 27 (cross-encoder reranker) was resolved 2026-05-02 via the same ADR-047 — v1.x opt-in with documented activation criteria. Section 3 (embedding model default) was resolved 2026-05-01 as ADR-041. Section 25 (cross-dimension embedding swap) was resolved 2026-05-01 within 24 hours of filing. Section 19 (plan-review checkpoint) was resolved 2026-04-30 as ADR-039.

### 7 · Scale ceiling per guild

**Scenario.** One guild hosts N projects with M composers total. What are the design limits?

**Open questions:**
- Is the blackboard pub/sub single-channel per-project or per-guild? Pub/sub load scales accordingly.
- Vector index size: embeddings for all decisions + contributions + BRD sections + research across all projects. What's the ceiling before query p95 degrades?
- Reaper cron runs across all projects — does it parallelize per-project or scan one table?

**Recommendation.** Document supported scale envelope (e.g., up to 10 projects × 20 composers × 10K contributions per project = 2M rows). Beyond that, recommend multiple guilds per team.

**Status.** OPEN -- bounded M7 deliverable landed; empirical override pending operator runs of the harness. The v1 envelope is committed in ARCH §9.8 (mirrors `docs/testing/scale-ceiling-benchmark-plan.md` §4). The harness at `scripts/test/scale/load-runner.ts` ships Scenarios A (endpoint sustained load) and B (reaper cycle time) end-to-end; C (broadcast fanout), D (vector kNN at scale), and E (cross-dimension stress) ship as documented stubs that follow the same scenario-A pattern. Per ADR-011 destination-first + the M7 kickoff bounded scope: the v1 deliverable is "harness + observability hooks + measured-envelope doc" not "find the actual ceiling." When operators run the harness against a deployed substrate, the empirical numbers populate `docs/architecture/audits/scale-ceiling-envelope-v1.md` §4 and replace the architectural prediction. Two architectural side-deliverables already landed prior to M7 (ARCH 6.1.2 session row cleanup; ARCH 6.8 broadcast topology) per the plan analysis. The remaining open work is operator-driven (run the harness, populate the measured-envelope section, file an ADR if results diverge by >2x per the plan §7 decision criteria).

---

### 19 - Plan-review checkpoint between claim and implementation

Accepted into v1 as a per-territory opt-in (default off) lifecycle gate. `contributions.state` enum gains `plan_review`; `territories.yaml` gains `requires_plan_review: bool` field. New ARCH section 6.2.1.7 specifies semantics.

**Status.** RESOLVED 2026-04-30. See [ADR-039](../architecture/decisions/ADR-039-plan-review-state-in-contribution-lifecycle.md). Resolved prior to M2 entry per the architect-of-record strategic call. The defer-to-v1.x option was rejected as the "Phase 2 / coming soon" pattern that ADR-011 (destination-first design) prohibits; the AI-speed pivot's commitment to addressing human-latency-as-bottleneck plus Atelier's regulated-team intent-vs-execution audit-trail value made acceptance the right binary call.

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

This is the single highest-leverage v1.x feature. Worth landing at M6 (alongside remote-principal composers + triage, which are the other AI-coordination concentrations) as a future ADR + ARCH 6.2.3 extension + territory schema addition.

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

**Status.** OPEN -- v1.x defer with schema reservation landed at M7. The v1 reservation per the M7 strategic call (kickoff Track 2):

- `.atelier/config.yaml: review.semantic_contradiction` block exists with `enabled: false` default. All fields the v1.x implementation needs (scope_paths, mode, base_url, api_key_env, model_name, anchor_paths, confidence_threshold) are present. Adopters who fork at v1 do not need a schema migration to enable the v1.x validator.
- `scripts/README.md "Extended cross-doc consistency"` table includes the `semantic_contradiction` check-class row marking it RESERVED. The validator has not implemented the check yet; the row documents where the v1.x implementation will plug in.
- Adapter pattern matches ADR-041 (OpenAI-compatible `/v1/chat/completions`); adopters override `base_url` + `model_name` to swap providers (Anthropic, Mistral, vLLM, Ollama, etc.) without changing adapter code.

The strategic call (does this land at v1?) was answered no per the M7 kickoff -- "schema reservation only -- not implementation." Reasons: (a) v1 is hardening, not feature-add; (b) the LLM-call cost + calibration overhead is genuinely substantial; (c) adopter signal for the feature has not surfaced; (d) destination-first per ADR-011 admits "scope deferred to v1.x" only when the v1 reservation makes the v1.x landing migration-free, which the schema reservation accomplishes.

The remaining open work is the v1.x implementation when an adopter signals need OR when AI-generated ADRs cross a noise threshold that empirically warrants the validator's catch. Filed 2026-04-28; schema reservation landed 2026-05-02. Surfaced by the AI-speed red-team pivot.

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

**Status.** OPEN. Strategic call: does adding a 13th MCP tool + a new schema table for annotations cross the line into "Atelier becomes a wiki" (which ADR-010 excludes)? Recommendation is no -- annotations are coordination-object metadata, not standalone content. But the boundary is worth being explicit about. If accepted, lands at v1.x (M6 alongside other coordination-surface enhancements) as a future ADR.

Surfaced by 2026-04-28 red-team Gap A + reinforced by GitHub ACE intel showing market interest in tool-resident chat.

**Update 2026-04-28 (post-chatbot-pattern landing).** The chatbot-as-MCP-client pattern (per `../user/connectors/chatbot-pattern.md`) covers much of this motivation: lightweight rationale flows through the chat surface where humans already are, and gets canonicalized via `log_decision` (with `transcript_ref` capturing the conversation under ADR-024). Annotations remain a separable concern only for non-chat contexts (e.g., a designer in `/atelier` wanting to attach a note to a contribution without opening chat). The strategic call now narrows to: is the non-chat annotation use case load-bearing enough for a 13th tool, or does the chatbot pattern + existing PR comment surface cover the practical need? Recommendation softens: defer to v1.x M6 with a higher bar to land (concrete pre-M6 user request needed, not speculative coordination-surface gap).

---

### 25 · Cross-dimension embedding-model swap migration path

**Scenario.** ADR-041 fixes the v1 default at OpenAI `text-embedding-3-small` (1536-dim) and the pgvector column at `vector(1536)`. ARCH 6.4.2 documents the same-dimension swap procedure (`atelier eval find_similar --rebuild-index` + 30-day grace window). What's NOT specified: the swap procedure when the new model has a different native dimension (e.g. moving to `nomic-embed-text-v1.5` at 768-dim, or `text-embedding-3-large` at 3072-dim).

**Open questions:**
- Add a second `embedding_v2 vector(N)` column on the embeddings table during transition, swap the active pointer, drop the old column at end-of-grace-window?
- Use pgvector's `halfvec` to compress without dimension change (only valid for some model pairs)?
- Reduce all models to a common dimension via Matryoshka-style truncation (lossy; trade-off on quality)?
- Force a full corpus re-embed under the new dimension, with read-only fallback during the rebuild window?

**Recommendation.** Defer until a second adapter at a different dimension is contributed. The decision space depends on: (a) which dimension count the new adapter exposes, (b) whether the source corpus content is still available at swap time, and (c) what the team's tolerance is for query-side downtime during rebuild. Pre-deciding without these constraints is over-investment.

**Status.** RESOLVED 2026-05-01 (24 hours after filing) via the M5-entry calibration. Trigger fired during ADR-042's model-swap experiment when text-embedding-3-large (3072-dim) was tested against text-embedding-3-small (1536-dim). v1 path (per migrations 7 and 8): drop + recreate the embeddings table at the new dimension, re-embed corpus from source via `embed-runner`. No production users at M5 entry -> brief read-only window during rebuild is free. v1.x considers multi-column transitions (`embedding_v1 vector(1536)`, `embedding_v2 vector(N)` with active-pointer swap) or pgvector `halfvec` compression for higher-availability deployments where downtime is not free. Methodology-honesty signal: when an "event-triggered" open question's trigger fires within 24 hours of filing, the question wasn't actually event-triggered -- it was near-term-need being deferred. The lesson: filing as event-triggered should require evidence the trigger is genuinely distant, not just absent at filing time.

---

_(Sections 26, 27, 28 moved to **Resolved** below — see the redirects.)_

---

### 29 · `atelier upgrade` template-upgrade flow (scope-deferred to v1.x)

**Scenario.** BRD US-11.10 + BUILD-SEQUENCE §9 list `atelier upgrade` as a v1 CLI command for pulling a new Atelier template version into an existing project. ARCH 9.7 specifies the semantics: additive-preferred migrations, idempotent, N/N-1 schema co-existence, conflict reports without auto-resolution, decision-log preservation. The 12-command CLI polish PR (M7 Track 1 / 2026-05-02) ships `atelier upgrade` as a **scope-deferred stub** — distinct from the 6 timeline-deferred stubs (init, datastore init, deploy, invite, territory add, doctor) which all have working raw equivalents. `atelier upgrade` has **no v1 raw form** because the underlying capability (semver-aware template upgrade with migration tracking) is not built at v1.

This files the deferral so the gap doesn't get lost.

**Why scope-deferred (not timeline-deferred):**

- Timeline-deferred stubs (the other 6): the substrate capability exists at v1; only the CLI wrapper polish lands in v1.x. Adopters using the raw form get the full capability.
- Scope-deferred `atelier upgrade`: there is no raw substrate command that does what ARCH 9.7 specifies. Operator practice at v1 is the manual workaround:

  ```bash
  cd <your-atelier-project>
  git remote add upstream https://github.com/Signal-x-Studio-LLC/atelier.git
  git fetch upstream main
  git log HEAD..upstream/main -- .atelier/ docs/strategic/ docs/architecture/ | less
  # Review what changed
  git merge upstream/main   # or cherry-pick what applies
  ```

This works for adopters who cloned recently and have minimal local divergence. It does NOT scale to:

- Adopters with custom territories that need to be preserved across upgrades
- Adopters tracking a non-`main` branch
- Adopters with custom config that conflicts with new template defaults
- Adopters with locally-applied schema migrations (ARCH 9.7's N/N-1 co-existence requirement)

**v1 reservation:** none beyond the CLI stub. No schema migration system exists at v1; no version-tracking metadata is stored in adopter projects; no migration-script registry is shipped. v1.x adds all of these.

**Trigger to land:** first adopter requests semver-aware template upgrade. Until then, the manual git-pull workflow + the CHANGELOG (when it exists) are sufficient.

**v1.x deliverables (when triggered):**

1. Per-project version metadata: `.atelier/version.lock` records the template version the project was scaffolded from + the version of every subsequent upgrade
2. Migration script registry: `tools/atelier-template/migrations/v1.0-to-v1.1/` style directories with idempotent migration scripts
3. `atelier upgrade` polished implementation: discovers the registry, applies migrations in order, reports conflicts with the team's local divergence, preserves the decision log per ARCH 9.7
4. CHANGELOG convention enforcement: every template change that affects adopter projects requires a corresponding migration script + CHANGELOG entry

**Status.** OPEN. Scope-deferred to v1.x with the trigger above. Filed 2026-05-02 as part of the 12-command polish PR (US-11.10's polished form ships as a scope-deferred stub).

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

### 3 - Embedding-model default + swappability for find_similar

Decide the v1 default embedding model + adapter shape for `find_similar`, and the swap procedure across providers.

**Status.** RESOLVED 2026-05-01. See ADR-041. OpenAI-compatible adapter ships as the only named adapter at v1; default config points at OpenAI `text-embedding-3-small` (1536-dim). Swap to vLLM / Ollama / LocalAI / self-hosted by overriding `find_similar.embeddings.base_url` + `api_key_env`. Swap procedure across same-dimension models documented in ARCH 6.4.2; cross-dimension swap filed as section 25 (event-triggered).

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

---

### 20 - Composer role enum mixes work-discipline with access-level

Split into `composers.discipline` (5 values including newly-added `architect`) + `composers.access_level` (3 values).

**Status.** RESOLVED 2026-04-28. See [ADR-038](../architecture/decisions/ADR-038-composer-role-split-into-discipline-plus-access-level.md). Resolved same-day per expert-review prompt that surfaced this should land before M1 schema implementation, not v1.x. The fix also closed a previously-undetected drift: `architect` was used as `owner_role` across 4 territories but missing from the composers enum -- now first-class as `discipline=architect`.

---

### 24 - Branch reaping in `reconcile.ts` for AI-speed contribution churn

Extend `reconcile.ts` with a branch-reaping pass guarded by a config flag; default off at v1.

**Status.** RESOLVED 2026-04-28. See `../../scripts/sync/reconcile.ts` M1 step 4.iii implementation (`reapBranches` pass guarded by `ATELIER_RECONCILE_BRANCH_REAPING_ENABLED`, default false; `--reap-branches --apply` CLI override) and `../../scripts/README.md` reconcile section. Recommendation confirmed during M1 step 4.iii; strategic-call gate from SESSION.md closed by execution.

---

### 26 · Wider eval against external corpus (multi-corpus generalization)

Run the find_similar eval against ≥1 external corpus to test whether the advisory tier holds beyond Atelier's own discovery content; feed the §27 reranker activation rule per ADR-043.

**Status.** RESOLVED 2026-05-02. See [ADR-047](../architecture/decisions/ADR-047-find-similar-wider-eval-claude-agent-sdk-and-blocking-tier-reversal.md). Wider eval ran against the claude-agent-sdk public docs corpus (44 chunked items, 117 deduped seeds via the same hand + 3-lens method as M5). Result: P=0.5540 / R=0.5423 — does NOT clear advisory tier (P≥0.60 AND R≥0.60). Per the activation rule's 0-of-2 outcome (M5 cleared advisory but missed blocking; claude-agent-sdk missed both), ADR-047 reverses ADR-043's blocking-tier framing AND demotes advisory's universality claim to "Atelier-shape-corpus dependent." The unanticipated finding (advisory itself is corpus-dependent) is documented in ADR-047's "Decision" section. Corpus + seeds + last-run.json fixtures land in `atelier/eval/find_similar/external-corpora/claude-agent-sdk/`.

---

### 27 · Cross-encoder reranker as a v1.x option for the blocking tier

Decide when (or whether) the cross-encoder reranker ships, per the §26 activation rule + ADR-043 blocking-tier flip criteria.

**Status.** RESOLVED 2026-05-02. See [ADR-047](../architecture/decisions/ADR-047-find-similar-wider-eval-claude-agent-sdk-and-blocking-tier-reversal.md). v1.x opt-in with documented activation criteria: (a) at least one adopter's measured corpus misses advisory by less than 15pp on either P or R, (b) the reranker measurably lifts that corpus into advisory in a controlled experiment, (c) the reranker's latency overhead at the adopter's typical query volume stays under 200ms p95 added to the baseline. ADR-047's failure-mode diagnostic on the claude-agent-sdk corpus (lateral domain-cluster confusion is the dominant failure mode) is exactly what a reranker addresses, so the v1.x opt-in framing is genuinely useful — not a polite deferral. Per the activation rule's 0-of-2 strict reading, the reranker would be deferred indefinitely; ADR-047 records the more nuanced opt-in framing because the diagnostic suggests the reranker is the right tool for adopters whose corpora miss advisory.

---

### 28 · Deploy trigger conditions for the Atelier endpoint

Decide WHEN to deploy the Atelier endpoint to a network-reachable host (vs the local-stack default per ADR-044).

**Status.** RESOLVED 2026-05-02. See [ADR-046](../architecture/decisions/ADR-046-deploy-strategy-vercel-supabase-cloud.md). Trigger #2 (claude.ai Connectors blocked on local-only) fired empirically at M6 entry; the deploy executed as a parallel workstream and landed `https://atelier-three-coral.vercel.app`. ADR-046 codifies the empirical choices (Vercel + Supabase Cloud + rootDirectory=prototype + URL split inheritance from PR #14 + Supabase Auth bearer with operator-driven rotation) and points at `docs/user/tutorials/first-deploy.md` (PR #24) as the procedural twin.
