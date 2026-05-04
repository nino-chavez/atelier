# BRD Open Questions

**Context.** Decision points surfaced during design that need an explicit call. Each item is a discrete strategic question, not a defect.

**File structure.** Open entries with full context appear first. Resolved entries below are compressed to one-line redirects pointing at the canonical home where each decision now lives. Original numbering is preserved so external references (e.g., "see BRD-OPEN-QUESTIONS section 14") still resolve. Full historical text of resolved entries is in git history.

---

## Open

Open at v1.x: §7 (scale ceiling — bounded harness shipped; empirical override pending operator runs), §21 (AI auto-reviewers — v1.x defer with adopter-signal bar), §22 (semantic-contradiction validator — schema reservation shipped at v1; implementation v1.x), §23 (lightweight annotations on contributions — v1.x defer with adopter-signal bar), §30 (push-notification alerting via messaging adapter — v1 ships UI alerts; out-of-band delivery v1.x with adopter-signal trigger), §31 (X1 audit LOW items — filed with explicit activation criteria each).

### 7 · Scale ceiling per guild

**Scenario.** One guild hosts N projects with M composers total. What are the design limits?

**Open questions:**
- Is the blackboard pub/sub single-channel per-project or per-guild? Pub/sub load scales accordingly.
- Vector index size: embeddings for all decisions + contributions + BRD sections + research across all projects. What's the ceiling before query p95 degrades?
- Reaper cron runs across all projects — does it parallelize per-project or scan one table?

**Recommendation.** Document supported scale envelope (e.g., up to 10 projects × 20 composers × 10K contributions per project = 2M rows). Beyond that, recommend multiple guilds per team.

**Status.** OPEN -- bounded M7 deliverable landed; empirical override pending operator runs of the harness. The v1 envelope is committed in ARCH §9.8 (mirrors `docs/testing/scale-ceiling-benchmark-plan.md` §4). The harness at `scripts/test/scale/load-runner.ts` ships Scenarios A (endpoint sustained load) and B (reaper cycle time) end-to-end; C (broadcast fanout), D (vector kNN at scale), and E (cross-dimension stress) ship as documented stubs that follow the same scenario-A pattern. Per ADR-011 destination-first + the M7 kickoff bounded scope: the v1 deliverable is "harness + observability hooks + measured-envelope doc" not "find the actual ceiling." When operators run the harness against a deployed substrate, the empirical numbers populate `docs/architecture/audits/scale-ceiling-envelope-v1.md` §4 and replace the architectural prediction. Two architectural side-deliverables already landed prior to M7 (ARCH 6.1.2 session row cleanup; ARCH 6.8 broadcast topology) per the plan analysis. The remaining open work is operator-driven (run the harness, populate the measured-envelope section, file an ADR if results diverge by >2x per the plan §7 decision criteria).

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

**Status.** OPEN at v1.x. v1 reserves the config surface (`territories.<name>.ai_review_policy: null`) so adoption does not require a schema migration. Recommendation is v1.x M6 alongside remote-principal composers and triage; find_similar precision data informs the auto-approve thresholds.

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

**Status.** OPEN at v1.x — implementation deferred; schema reservation ships at v1.

v1 reservation:

- `.atelier/config.yaml: review.semantic_contradiction` block exists with `enabled: false` default. All fields the v1.x implementation needs (scope_paths, mode, base_url, api_key_env, model_name, anchor_paths, confidence_threshold) are present. Adopters who fork at v1 do not need a schema migration to enable the v1.x validator.
- `scripts/README.md "Extended cross-doc consistency"` table includes the `semantic_contradiction` check-class row marked RESERVED. The validator has not implemented the check yet; the row documents where the v1.x implementation plugs in.
- Adapter pattern matches ADR-041 (OpenAI-compatible `/v1/chat/completions`); adopters override `base_url` + `model_name` to swap providers (Anthropic, Mistral, vLLM, Ollama, etc.) without changing adapter code.

Activation criteria for v1.x landing: an adopter signals need OR AI-generated ADRs cross a noise threshold that empirically warrants the validator's catch.

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

### 30 · Push-notification alerting via messaging adapter (out-of-band observability delivery)

**Scenario.** ARCH §8.3 specifies messaging-adapter-published alerts when observability thresholds cross (sync lag > NFR thresholds, find_similar precision regression > 5%, reaper rate spike, authentication failure spike). The M7 Track 1 observability stack ships UI-rendered alerts only — the dashboard at `/atelier/observability` colors threshold pills (yellow at 80% of envelope, red at 100%) per `.atelier/config.yaml: observability.thresholds`, but does not push out-of-band notifications to messaging surfaces (Slack, Teams, Discord, email). v1 ships visibility-in-UI; out-of-band delivery is filed for v1.x.

**Why deferred to v1.x:**

- Same lens as the contributions-panel and find_similar deferrals: ship the substrate (UI-visible alerts that operators can actually see), let adopter signal inform the delivery shape rather than pre-deciding before any adopter has voiced what they want notified about.
- Channel coverage matters: messaging-adapter delivery means picking which channels are first-class (Slack? Teams? Discord? Generic webhook?) and which thresholds are noisy by default. Pre-deciding without operator feedback risks both omission (missing the channel adopters use) and churn (an early decision needing reversal once signal arrives).
- The substrate hooks already exist: telemetry rows are queryable, thresholds are configurable, the dashboard shows the alert state. Adding a messaging-adapter publisher is additive — no schema change, no breaking config rename. v1.x lands the publisher when the trigger fires.

**Trigger to land:** first adopter requests out-of-band ops alerts with a named channel preference. Until then, operator practice is dashboard polling — the 30s client-poll on `/atelier/observability` keeps the UI close to real-time, and the threshold pills surface state visibly enough that a tab open during ops review covers the operational case.

**v1 deliverables that already shipped (M7 Track 1):**

- `.atelier/config.yaml: observability.thresholds` block — adopter-tunable values for the 10 envelope dimensions (sessions, contributions, decisions, locks, vector rows, triage backlog, sync lag p95, daily cost)
- `/atelier/observability` route — admin-gated 8-section dashboard rendering threshold pills + 30s client-poll + manual refresh button
- Severity calculator in `prototype/src/lib/atelier/observability-config.ts` — single source for the 80%/100% color bands, ready for the v1.x messaging-adapter publisher to consume

**v1.x deliverables (when triggered):**

1. Messaging-adapter publisher: poll the same view-model the dashboard reads, fire when severity transitions from `ok` → `warn` or `warn` → `alert` (debounced — no continuous reposting while a metric stays in the same band)
2. Per-threshold channel routing: `.atelier/config.yaml: observability.alerts.<metric>.channel` so adopters can route different signals to different channels (cost spike → finance Slack channel, reaper spike → ops on-call)
3. Quiet hours + acknowledgment: respect operator-set quiet windows; allow ack from the messaging surface to suppress repeat notifications until the next state transition
4. Backoff on flap: exponential backoff when a metric oscillates between `warn` and `alert` (reduces alert fatigue from noisy thresholds)

**Status.** OPEN. v1 ships UI alerts; out-of-band delivery is v1.x scope, gated on the adopter-signal trigger above.

---

### 31 · v1.x next-level security and polish items

**Context.** Items the v1 security + quality audit (X1) classified as LOW severity, code polish, or activation-gated by adopter signal. HIGH + MEDIUM findings shipped at v1 (B1 prompt-injection pre-filter on the semantic-contradiction validator; C1 OTP-relay structural protection via the rally-hq token-hash flow at `/auth/confirm` plus `shouldCreateUser:false` on `signInWithOtp` -- the dedicated D7 `/sign-in/check` gate has been removed in favor of these two structural defenses, see "Refactor sign-in to token-hash flow per rally-hq pattern" below; A1 magic-link redaction in `atelier invite` default output; A3 secret redaction in diffs; B2 execFileSync hardening; B4 statement_timeout on migration apply; D1 advisory lock on alert-publisher; D2 advisory lock on migration runner; plus quality patterns for self-disabling tests, regex-as-parser sanity floors, and parallel-implementation consolidation under `scripts/lib/`). Items below carry explicit activation criteria so they do not age into anonymous backlog.

**Security / hardening (activation-gated):**

- **C2 sign-out CSRF.** Switch sign-out from GET to POST. *Activate when:* an adopter reports CSRF concern OR one-form-edit polish lands.
- **C3 invite identity-rebinding.** Invite re-issued to an attacker-controlled email could rebind a composer's `identity_subject`. *Activate when:* multi-admin teams onboard. *Workaround until then:* runbook entry advising single-admin invite + manual identity_subject rotation.
- **C4 LensUnauthorized info disclosure.** The `no_composer` reason names the exact failure mode. *Activate when:* an adopter classifies their deploy as user-class hostile.
- **B3 `git clone --` separator.** `atelier init` invokes `git clone <url>` without `--`; a malicious tutorial URL like `--upload-pack=...` could exploit option parsing. *Activate when:* one-form-edit polish lands.
- **A2 webhook URL in fetch error message.** Node's `fetch` may include the URL in `error.toString`. *Activate when:* a node version drift makes this concrete.
- **A4 deploy validation tail redaction.** `atelier deploy --validate` tails command output that may include secrets if the substrate ever logs them. *Activate when:* an adopter reports a leak OR substrate logging changes.
- **D3 invite race.** Two simultaneous `atelier invite` calls for the same email can both pass the duplicate check. *Activate when:* scale ceiling per ARCH §9.8 is approached, or batch-onboarding lands.
- **E1 / E2 / E3 DoS items.** Endpoint rate-limit; magic-link request flood; cron-publisher fanout. *Activate when:* deploy infra (Vercel + Supabase) signals the layer below cannot absorb the rate.

**Code polish:**

- Rerank adapter type widening; messaging-lib slack coupling; `runner.ts` re-exports; doctor JSON inline type; webhook adapter URL substring matching brittleness.

**Operator ergonomics:**

- **Bearer rotation in build sessions.** Surfaced during BUILD-SEQUENCE row G's first MCP-client session: rotating the local bearer required manual password reset → `signInWithPassword` → `.mcp.json` write because the originating password was not recoverable from existing artifacts. `atelier dev` should be able to rotate non-interactively when the operator opts in to credential persistence. *Activate when:* a second build session hits the same friction OR an adopter reports the same wall during onboarding. *Design space (do not pre-decide):* `.atelier/dev-credentials.json` (gitignored) vs OS keychain integration vs `atelier dev --rotate` interactive prompt. Pre-deciding before the second data point is over-investment.

**Runbook gaps:**

- **first-deploy.md misses Supabase Auth URL Configuration for human sign-in.** The runbook covers URL Configuration for OAuth Connectors (claude.ai / ChatGPT) but not for the human-sign-in magic-link/OTP path. Historically: without `Site URL` set to the deploy URL and `/sign-in/callback?**` in Redirect URLs, magic links bounced with "Invalid redirect URL" (the 6-digit code path still worked because it doesn't follow URLs). Surfaced 2026-05-04 when the first cloud-deploy sign-in attempt hit it. The token-hash refactor (see RESOLVED entry below) removed the redirect-URL allowlist dependency for the magic-link path, so this runbook gap is now reduced to: confirm `Site URL` matches the deploy URL and paste the rally-hq email template. *Fix:* add a "Configure Supabase Auth URL Configuration for sign-in" subsection to first-deploy.md covering the email-template paste-in + Site URL note (no allowlist entries needed for human sign-in after the refactor). *Activate when:* next adopter onboarding to cloud OR next first-deploy.md polish pass.

- **`ATELIER_PUBLIC_URL` not set in cloud Vercel env.** `scripts/bootstrap/invite-composer.ts` reads `ATELIER_PUBLIC_URL` (then `ATELIER_ENDPOINT_URL`) for the magic-link `redirect_to` parameter; defaults to `http://localhost:3000` if neither is set. Symptom: `atelier invite --remote` produces magic links pointing at `localhost:3000` instead of the deploy URL, breaking sign-in. Workaround: pass `--site-url <deploy-url>` explicitly on every cloud invite. *Fix:* add `ATELIER_PUBLIC_URL` to `vercel env` for production (= the deploy URL), AND have first-deploy.md call this out as a one-time post-deploy env step. *Activate when:* next first-deploy.md polish pass OR next cloud invite without `--site-url` produces the same wrong URL.

- **`NEXT_PUBLIC_SUPABASE_ANON_KEY` not in cloud Vercel env.** Surfaced 2026-05-04 during first cloud sign-in attempt: console threw `NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set; the broadcast island cannot subscribe to Realtime`. The Vercel production env carries `NEXT_PUBLIC_SUPABASE_URL` but not the anon/publishable key; without it the browser Supabase client cannot instantiate, blocking sign-in form submission. *Fix:* add `NEXT_PUBLIC_SUPABASE_ANON_KEY` to `vercel env` production with the `sb_publishable_*` value (per the late-2025 Supabase API key paradigm; works as drop-in for the legacy anon JWT). first-deploy.md should enumerate this alongside `ATELIER_PUBLIC_URL` as a required post-provisioning env. *Activate when:* now (blocked sign-in on the deployed app at first attempt).

- **Broadcast island mounts on `/sign-in` (unauthenticated route).** Same incident as above: the broadcast island throws on mount when the browser Supabase client cannot instantiate, but the deeper issue is that the island has no business mounting on `/sign-in` in the first place — it is a logged-out page with no session to subscribe Realtime against. Even after the env-var fix lands, the island will mount-and-immediately-fail-silently (no useful Realtime subscription possible without a session). *Fix:* gate the broadcast island mount on session presence; only mount inside authenticated `/atelier/*` routes; never on `/sign-in`, `/`, `/auth/confirm`, or any pre-auth surface. *Activate when:* next sign-in flow polish pass OR a real composer reports a confusing console error during sign-in.

- **SMTP deliverability on custom-domain inboxes (vs Gmail).** Supabase's default SMTP relay (`mail.app.supabase.io`) reliably reaches Gmail but is rate-limited (~3-4 emails/hour) and aggressively spam-filtered against custom domains. First-cloud-sign-in attempt to `dev@signalx.studio` produced no delivery; switching to `abelino.chavez@gmail.com` worked. *Fix:* document custom-SMTP configuration (Resend / SendGrid / SES / Postmark) as a production prerequisite in first-deploy.md, with Resend recommended for OSS adopters (3000/month free tier; minimal setup). *Activate when:* an adopter onboards a non-Gmail composer OR invite-volume exceeds Supabase's free-tier limit OR first-deploy.md polish pass.

- **`ATELIER_DATASTORE_URL` set to direct Postgres URL instead of pooler URL.** Surfaced 2026-05-04 immediately after sign-in worked end-to-end: the lens auth check threw `Bearer rejected: getaddrinfo ENOTFOUND db.<ref>.supabase.co`. Vercel Functions can only reach Supabase's `db.<project-ref>.supabase.co` direct-connection hostname over IPv6, which Vercel's standard Node.js runtime does not have outbound. Supabase explicitly directs serverless platforms to use the pooler hostname (`aws-0-<region>.pooler.supabase.com`). Symptom worked from any developer laptop with IPv6 (including the seed flow) but blocked all DB-touching routes on the deployed app. *Fix:* swap `ATELIER_DATASTORE_URL` in Vercel production to the **Session-mode pooler URL** (port 5432; supports all Postgres operations including migrations) — `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`. first-deploy.md must call this out prominently as the most common Supabase+Vercel footgun: dashboard surfaces both URLs side-by-side with no warning that the direct one will silently break on serverless. *Activate when:* now (blocked all DB-touching routes on deployed app at first attempt).

- **`NEXT_PUBLIC_SUPABASE_ANON_KEY` legacy name vs canonical `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.** Atelier reads the legacy slot name; canonical Supabase Next.js docs (post-2025 paradigm shift) now use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Both names accept the new `sb_publishable_*` value (drop-in compatible per `@supabase/supabase-js@^2.45+`). Minor — both work — but adopters following the canonical docs will set `_PUBLISHABLE_KEY` and find Atelier's adapter doesn't read it. *Fix:* extend the env-var read fallback chain in `prototype/src/lib/atelier/adapters/supabase-browser.ts` and `supabase-ssr.ts` to accept both names: `process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY`. *Activate when:* env-var refactor PR (the broader canonical-env-var-naming work flagged in the canonical-pattern audit) lands OR adopter onboarding hits the gap.

**Architectural alternatives (filed for visibility):**

- **Adopt `vercel.ts` (or `vercel.json`) as the canonical Vercel deploy-config declaration site.** The repo currently ships no `vercel.ts` / `vercel.json` and relies entirely on Vercel framework auto-detection plus dashboard-side configuration (rootDirectory=prototype per ADR-046). Per the canonical-pattern audit (`docs/architecture/audits/canonical-pattern-audit-v1.md` F5), this creates concrete adopter-facing gaps: `docs/user/guides/observability-alerts.md` instructs adopters to "Add to vercel.json" but the file does not exist; `docs/user/guides/enable-auto-deploy.md` describes "the vercel.json config + GitHub remote + Vercel project linkage form the canonical CI/CD pipeline" but no vercel.json exists; ADR-046's rootDirectory=prototype choice lives only in the Vercel dashboard, invisible to fork-and-customize adopters; the future cron-route implementation (reaper, mirror-delivery, reconcile, triage per ARCH §6.5 / §7.4 / §8) is blocked on the absence of a `crons` array declaration site. Per the 2026-02 Vercel Knowledge Update, `vercel.ts` is the current recommended config-as-code shape (typed, dynamic logic, env-var access via `@vercel/config`); `vercel.json` is the legacy alternative. **Recommended scope:** ship `prototype/vercel.ts` carrying at minimum: `framework: 'nextjs'`, rootDirectory acknowledgment via comment, build/install command pinning, function timeout (the platform default moved to 300s — explicit pin protects against future drift), and a `crons` array stub the future cron-route handlers can land into. *Activate when:* (a) the cron-route implementation lands and needs a declaration site; OR (b) one-form-edit polish lands on `enable-auto-deploy.md` / `observability-alerts.md` and the dangling `vercel.json` references resolve; OR (c) the next adopter onboarding to fork-and-customize hits the missing-config friction. *Reference impls:* `apps/rally-hq` and `apps/630-apps/*` both ship `vercel.json` configurations.

- **Refactor sign-in to token-hash flow per rally-hq pattern.** *RESOLVED 2026-05-04 by [this PR].* The activation criterion fired earlier than expected: the first cloud-deploy `/sign-in` attempt produced a 500 on `/sign-in/check` cold-start on Vercel, breaking sign-in entirely on production. Rather than patch the cold-start, we adopted the rally-hq token-hash pattern wholesale. *What changed:* `/sign-in/check/route.ts` deleted (the C1 enumeration gate is gone); `/sign-in/callback/route.ts` deleted; new `/auth/confirm/route.ts` calls `auth.verifyOtp({ type, token_hash })` via the named SSR adapter; `SignInForm.tsx` no longer POSTs to a server gate before `signInWithOtp`. *Structural protection (post-refactor):* (a) `shouldCreateUser:false` on `signInWithOtp` — Supabase Auth refuses to mint mail for non-existent users; (b) token-hash verify only succeeds for tokens Supabase issued. The form still advances the UI on every submit so it is not a user-enumeration oracle. *Required separate-from-code deployment step:* operator pastes the rally-hq email template body into Supabase Dashboard → Authentication → Email Templates → Magic Link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=/atelier`. Site URL stays at the app root; the redirect-URL allowlist is no longer required for the human-sign-in path (still needed for OAuth Connectors / PKCE flows on `/oauth/api/mcp`). Reference impl: `apps/rally-hq/docs/SECURITY.md`.

**Validator polish:**

- **Stale example trace IDs in milestone-exit audit docs.** `docs/architecture/audits/milestone-M0-exit.md` and `milestone-M1-exit.md` reference example trace IDs (matching `NF-N`, `US-N.M`, and `BRD:Epic-N` shapes) that do not resolve in `traceability.json`. The IDs are illustrative-only in audit prose, not real references. *Fix path:* either rewrite the audit-doc references with real trace IDs, or extend `scripts/traceability/validate-refs.ts` to whitelist a documented example-IDs set. *Activate when:* next traceability-validator polish pass, OR a future milestone-exit audit blocks on inheriting the false-positive.

**Status.** OPEN at v1.x. Each item carries an explicit state-triggered activation criterion; no time-triggered ping (state-triggered work per CLAUDE.md).

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

### 19 - Plan-review checkpoint between claim and implementation

Per-territory opt-in lifecycle gate between `claim` and `in_progress`.

**Status.** RESOLVED 2026-04-30. See [ADR-039](../architecture/decisions/ADR-039-plan-review-state-in-contribution-lifecycle.md). Per-territory opt-in (default off); `contributions.state` enum gains `plan_review`; `territories.yaml` gains `requires_plan_review: bool`. Semantics in ARCH 6.2.1.7.

---

### 20 - Composer role enum mixes work-discipline with access-level

Split into `composers.discipline` (5 values including newly-added `architect`) + `composers.access_level` (3 values).

**Status.** RESOLVED 2026-04-28. See [ADR-038](../architecture/decisions/ADR-038-composer-role-split-into-discipline-plus-access-level.md). `composers.default_role` split into `composers.discipline` (analyst | dev | pm | designer | architect) + `composers.access_level` (member | admin | stakeholder). `architect` is first-class discipline, matching its use as `owner_role` across territories.

---

### 24 - Branch reaping in `reconcile.ts` for AI-speed contribution churn

Extend `reconcile.ts` with a branch-reaping pass guarded by a config flag; default off at v1.

**Status.** RESOLVED 2026-04-28. See `../../scripts/sync/reconcile.ts` M1 step 4.iii (`reapBranches` pass guarded by `ATELIER_RECONCILE_BRANCH_REAPING_ENABLED`, default false; `--reap-branches --apply` CLI override) and `../../scripts/README.md` reconcile section.

---

### 25 · Cross-dimension embedding-model swap migration path

Define the swap procedure when a new embedding model has a different native dimension from the v1 default.

**Status.** RESOLVED 2026-05-01 via the M5-entry calibration. v1 path (per migrations 7 and 8): drop + recreate the embeddings table at the new dimension, re-embed corpus from source via `embed-runner`. With no production users at v1, a brief read-only window during rebuild is acceptable. v1.x considers multi-column transitions (`embedding_v1 vector(1536)`, `embedding_v2 vector(N)` with active-pointer swap) or pgvector `halfvec` compression for higher-availability deployments where downtime is not free.

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

---

### 29 · `atelier upgrade` template-upgrade flow

Build the substrate + CLI for semver-aware template upgrade with migration tracking (per ARCH §9.7: additive-preferred migrations, idempotent, N/N-1 schema co-existence, conflict reports without auto-resolution, decision-log preservation).

**Status.** RESOLVED 2026-05-04. See BUILD-SEQUENCE §10 (E1 + E2). Substrate: `scripts/migration/` library exposing `MigrationRunner` + `atelier_schema_versions` tracking table. Operator-facing CLI: `atelier upgrade [--check | --apply | --dry-run | --force-apply-modified | --json]` consuming the runner. Operator runbook at `docs/user/guides/upgrade-schema.md`. DOWN migrations / rollback remain v1.x next-level per ADR-005 (append-only); cross-deploy coordination is an adopter-side decision.
