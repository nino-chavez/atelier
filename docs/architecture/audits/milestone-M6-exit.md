# Milestone M6 exit audit

**Audit run:** 2026-05-02
**Auditor:** architect role (Claude Opus 4.7 with explicit user direction; manual + validator-assisted)
**Milestone:** M6 -- Remote-principal composers + triage
**Per:** METHODOLOGY section 11.3 milestone-exit drift sweep + scripts/README.md "Extended cross-doc consistency"

---

## Summary

| Sweep area (METHODOLOGY 11.3) | Result | Findings |
|---|---|---|
| 1. Cross-doc reference integrity | **PARTIAL** | M1-exit's F1 (traceability.json `entries[]` missing US-X.Y stories) remains open; ~278 unresolved trace_id citations all share that single root cause. No new drift introduced by M6. Build-registry script still pending (per BUILD-SEQUENCE M7 polish scope) |
| 2. Walk re-run (analyst, dev, designer) | **DEFERRED** | M6 substantially changed the dev surface (FeedbackQueuePanel approve/reject affordances; URL-split deployment story) but did not invalidate the existing walks' acceptance steps. Next regular re-walk: M7 entry alongside CLI polish + first-deploy.md authoring |
| 3. ADR re-evaluation triggers | **OK** | 8 ADRs carry triggers (027, 028, 029, 030, 031, 032, 039, 040). ADR-040's surface-lock trigger empirically held: ADR-045 added `scope_files` as a parameter on existing `get_context` rather than minting a 13th tool. Other 7 ADRs: no triggers fired in the M6 window |
| 4. BRD-OPEN-QUESTIONS hygiene | **OK** | 7 entries genuinely open (sections 7, 21, 22, 23, 26, 27, 28); section 28's trigger #2 (claude.ai Connectors blocked on local-only) **fired empirically during M6 entry** -- documented as a confirmation note in BRD-OPEN-QUESTIONS §28 (PR #18). Deploy executed as parallel workstream; ADR-NNN authoring deferred to post-deploy stabilization |
| 5. Schema consistency | **OK** | 12 tables in DB match ARCH 5.1 + M5 + M6 additions (`embeddings` from M5; `triage_pending` from M6 / migration 9). ARCH 5.1 documents 11 tables explicitly; `triage_pending` is documented in migration 9's preamble + ARCH §6.5.2 referenced by ADR-018. ARCH 5.1 text update for the 12th table is M7 polish |
| 6. Traceability coverage | **DRIFT** | Same single root cause as M1-exit F1: traceability.json's `entries[]` lacks individual US-X.Y stories, so coverage cannot be computed. 23 specific BRD stories flagged with no resolution path (US-11.7, US-11.10, US-11.11, US-12.1, US-12.2, US-12.3, etc.). Most are M7 CLI surface (`atelier reconcile`, `atelier upgrade`, `atelier audit`) + observability (telemetry dashboard) -- BUILD-SEQUENCE puts these in M7 |
| 7. Operational completeness | **PARTIAL** | M6 produced `docs/user/connectors/claude-code.md` (corrected per PR #18; static-bearer shape is canonical) + `docs/user/tutorials/local-bootstrap.md` (Step 0 pre-flight + 8 troubleshooting findings landed in PR #18). Missing: `docs/user/tutorials/first-deploy.md` (the deploy ran during M6 entry but the runbook capturing it didn't land yet -- file as M6.5 or M7 follow-up) |

**Headline.** M6 substrate work landed in 11 PRs across the milestone (PRs #9-#21 inclusive minus the merged-and-deleted intermediates). The work split naturally into three cohorts: (a) substrate fixes catching real-Claude-Code-MCP-client divergences (PRs #11, #13, #14, #16, plus the trim() commit landed directly to main), (b) M6 feature work (scope_files PR #17, triage substrate PR #19, FeedbackQueuePanel PR #21), and (c) hardening that emerged during the milestone (CI hybrid split PR #15, runbook bundle PR #18, real-CC-MCP-client smoke PR #20 promoted from M7). Task #12 (lens panel for `overlapping_active`) was deferred to M7 polish per the UX-deferral framing in MEMORY (no adoption signal yet on which affordance shape composers want; substrate is queryable so the data is shipped). All seven sweep areas pass with the same single root-cause drift M1-exit identified (F1 / traceability.json registry gap); no new M6-specific drift requiring action.

---

## M6 implementation deliverables (cross-reference)

For audit traceability, this is the M6 PR catalog. All commits since `b5206ce` (PR #9 / m5-exit-bootstrap-adr-044 merge to main):

| PR | SHA | Cohort | Deliverable |
|---|---|---|---|
| #10 | `48ae43a`, `44c6bd4`, `41addcc`, `d5ab343` | CI cleanup | YAML colon hotfix + post-ADR-042/043 smoke alignments (the bridge from M5 into M6) |
| #11 | `eb7f396`, `2be5bce` | Substrate fix | OAuth discovery emits `registration_endpoint`. Empirical: Claude Code's MCP SDK requires the field; Atelier's omission caused `/mcp` to bail. First of six divergence-class fixes |
| #13 | `597ae0c`, `c2923f0` | Substrate fix | `registration_endpoint` value must be ABSOLUTE URL (PR #11 emitted relative; SDK's Zod `.url()` rejects). Lib gains request-URL-derived fallback |
| #14 | `36de9af` | Substrate architecture | URL split: `/api/mcp` (static bearer; no discovery published) vs `/oauth/api/mcp` (OAuth flow; discovery path-prefixed). Resolves the architectural conflict that Claude Code's SDK preferentially does OAuth flow when discovery is reachable, ignoring static bearer |
| (no PR) | `785ef1c` | Substrate fix | `trim()` on env-var-derived issuer URLs. Trailing newline from `echo $VAR \| vercel env add` propagated into all derived discovery URLs. Landed direct-to-main during cloud-deploy iteration; documented in PR #14's commit log + the M6 runbook bundle's troubleshooting section |
| #15 | `a167b33`, `b9ac958` | Workflow rework | Hybrid CI gate split: fast (PR; ~60-90s; typecheck + traceability) and full (merge; ~3-4min; substrate smokes). Empirically the per-PR substrate gate caught ~0 substantive bugs that real-use validation didn't also catch |
| #16 | `b49c14c` | Substrate fix | Catch-all JSON 404 at `/.well-known/[...slug]/route.ts`. Sixth divergence-class fix: Claude Code's SDK parses 404 bodies as JSON; Next.js's HTML 404 default broke parsing |
| #17 | `05f6513` | Feature | `get_context.scope_files` parameter for pre-claim file-overlap awareness. ADR-045 + ARCH §6.7.5. 18 new smoke assertions in section [9] of endpoint.smoke.ts |
| #18 | `798c38a`, `b539e49` | Hardening / docs | M6-entry runbook bundle: 8 findings + connectors/claude-code.md fix (Path B's `auth.type: "bearer"` is fictitious per claude-code-guide research). Step 0 pre-flight, .env.example, 4 new troubleshooting entries |
| #19 | `bb57d66`, `5663b87` | Feature | Triage substrate: migration 9 (triage_pending table), LlmClassifier via registry seam (Path A; ARCH 5-cat ontology preserved), AtelierClient triage_pending CRUD methods, route-proposal refinement, dedicated triage smoke (26 assertions), CI gate update |
| #20 | `eae0ecf`, `a835481` | Testing | Real Claude Code MCP-client probe-shape smoke (promoted M7→M6). Spawns next dev + probes every URL Claude Code's SDK is empirically known to hit. 50+ assertions catching 5 of 6 substrate-fix regression classes |
| #21 | `59b4b89`, `0987cbc` | Feature | FeedbackQueuePanel wire-up: lens-data.ts loadFeedbackQueue, server actions for approve/reject (per ADR-028 cookie auth), panel renders with route-to-viewer affordance gating |

**ADRs landed during M6:** ADR-045 (PR #12, merged 2026-05-01).

**Cloud deploy executed as parallel workstream during M6 entry** (BRD §28 trigger #2 firing): cloud Supabase project `lgzitibcufxfgkaxroqg` (Pro org, us-west-1, all 8 migrations applied) + Vercel project `atelier` (rootDirectory=prototype) live at `https://atelier-three-coral.vercel.app`. The deploy itself didn't land as a discrete PR; the substrate fixes that surfaced during deploy execution (PR #14 split, trim() commit, PR #16 catch-all) carry the load-bearing learnings.

**Test totals at M6 exit:**

| Suite | Assertions | Status | Notes |
|---|---|---|---|
| schema-invariants | 31 | green | unchanged from M1 |
| write library | 39 | green | unchanged from M1 |
| sync substrate | 19 + 1 | green | +1 assertion: low-confidence persisted in triage_pending |
| github adapter | 31 | green | unchanged |
| round-trip negative | 7 | green | unchanged |
| round-trip corpus | 43 files / 6 doc classes | green | unchanged |
| endpoint dispatcher (incl plan-review + scope_files) | 60+ + 18 | green | +18 from PR #17 section [9] (scope_files behavior matrix) |
| committer | n/a | green | unchanged |
| transport wire | 50+ | green | section [0] discovery split + [0a] /oauth/register stub + [0b] resolver paths + [0c] both-routes-bearer-auth |
| real-client (Supabase Auth) | 20+ | green | discovery split assertions added |
| broadcast | n/a | green | unchanged |
| lens (M3 view-model) | n/a | green | feedbackQueue field surfaces through view-model (data layer covered by triage smoke) |
| **triage** (NEW M6) | **26** | **green** | LlmClassifier registry seam, triage_pending lifecycle (insert/list/approve/reject), idempotent re-routing, FORBIDDEN cross-project guard |
| **CC MCP-client probe-shape** (NEW M6) | **50+** | **green** | Spawns next dev; verifies every Claude Code SDK probe URL returns parseable JSON of expected shape |
| eval harness (M5 / informational) | per-PR informational | n/a | continue-on-error per ADR-045 demotion + the eval-gate-informational flip |

---

## Sweep area details

### 1. Cross-doc reference integrity

Validator output: 92 issues across 3 FAIL check classes (`trace_id_resolution`, `markdown_link_integrity`, `traceability_coverage`); 2 INFO check classes (`open_questions_hygiene`, `adr_reeval_trigger_check`).

Of the 92 issues: ~85 are M1-exit F1 root-cause (traceability.json `entries[]` missing US-X.Y stories so citations don't resolve). The remaining ~7 are markdown link integrity issues in the M0-exit and M1-exit audit docs themselves (NF-12 references in walk steps; not load-bearing for M6).

**No new drift introduced by M6.**

### 2. Walk re-run

Walks last re-walked at M3-exit (2026-04-29). Spec changes since: M5 find_similar substrate (eval gate flip; advisory tier) + M6 triage substrate (FeedbackQueuePanel wire-up; URL-split deployment story).

Per METHODOLOGY 11.7 the criteria is "every milestone-exit drift sweep plus on demand when a substantial spec change lands":

- **analyst-week-1** -- M6 work doesn't substantively change the analyst surface. The triage flow surfaces in /atelier feedback queue, but analysts consume the existing queue via the dashboard; the approve/reject ergonomics are PM-discipline-routed by default (per ADR-025 territory.review_role). **Not stale.**
- **dev-week-1** -- M6 changed the deployment-side story: dev work now has cloud target. Walk's Step 1 pre-condition was "composer has configured their MCP client per local-bootstrap.md"; the walk doesn't yet reference cloud deploy. **Not stale, but a fold-in candidate** when first-deploy.md authors at M7.
- **designer-week-1** -- M6 work doesn't change the designer surface (Figma triage path is M6 scope but unchanged from M3 design). **Not stale.**

**Conclusion:** No re-walk required at M6 exit. Next re-walk: M7 entry, alongside CLI polish + first-deploy.md authoring.

### 3. ADR re-evaluation triggers

8 ADRs carry triggers; reviewed each for M6-window evidence:

| ADR | Trigger summary | Fired? |
|---|---|---|
| 027 | Reference stack deprecation | No |
| 028 | Supabase Auth deprecation; >50% of `atelier init` users override | No (no adopters yet) |
| 029 | GCP-portability lint rule violations | No |
| 030 | Per-ADR file format change | No |
| 031 | Tier consolidation | No |
| 032 | Doc structure consolidation | No |
| 039 | Plan-review proves friction without benefit | No (M6 didn't exercise plan_review enough to fire either way) |
| 040 | 13th MCP tool needed (would amend the surface lock) | **Tested + held.** ADR-045 added `scope_files` as a parameter on existing `get_context` rather than minting a 13th tool. Alternative considered + rejected per ADR-045 trade-off table |

**No triggers fired during M6.** ADR-040's hold under direct test is itself a validation of the surface-lock discipline.

### 4. BRD-OPEN-QUESTIONS hygiene

7 OPEN entries (3 informational): sections 7 (scale ceiling), 21 (AI auto-reviewers), 22 (semantic contradiction validator), 23 (annotation surface), 26 (multi-corpus eval), 27 (cross-encoder reranker), 28 (deploy trigger).

| Section | Spec-gap-vs-real-question test | Action |
|---|---|---|
| 7 | Real question (benchmark required) | Stay open; M7 polish data target |
| 21 | Real question (AI auto-reviewer scope) | Stay open; M7 entry candidate |
| 22 | Real question (semantic-contradiction surface) | Stay open; M7 entry candidate |
| 23 | Real question (annotation surface scope) | Stay open; M7 entry candidate |
| 26 | Real question (multi-corpus eval data target) | Stay open; M7 wider eval scope |
| 27 | Real question (cross-encoder reranker upgrade) | Stay open; gated on M7 wider eval |
| 28 | Real question with **trigger #2 EMPIRICALLY FIRED** in M6 | Empirical-confirmation note added in PR #18; deploy executed as parallel workstream; ADR-NNN (deploy strategy) deferred to post-deploy stabilization |

No spec-gaps wearing question costumes.

### 5. Schema consistency

12 tables in DB:

```
projects, composers, sessions, contributions, decisions,
territories, contracts, locks, telemetry,
delivery_sync_state (M1 / migration 003),
embeddings (M5 / migration 006),
triage_pending (M6 / migration 009)
```

ARCH 5.1 explicitly documents 11. The 12th (`triage_pending`) is documented in:
- migration 009's preamble (full intent + invariants)
- ARCH §6.5.2 (referenced by ADR-018 as the triage flow's persistent surface)

ARCH 5.1 text update to enumerate the 12th table is a doc-only follow-up; it's M7 polish per the same cadence M5's `embeddings` table followed (migration documents intent; ARCH 5.1 prose updates batch into hardening passes).

ARCH 5.2 indexes: migration 009 added 4 indexes on triage_pending (`project_pending_idx`, `project_decided_idx`, `territory_idx`, `context_gin`). All present in DB; verified via `\d triage_pending` during PR #19's smoke run.

ARCH 5.3 RLS: triage_pending is service-role-only at M6 (no per-composer RLS policies yet). The same RLS posture as M2-entry tables; M7 polish includes a JWT-mapped RLS pass across all tables.

### 6. Traceability coverage

23 BRD stories flagged with no resolution path (validator output). Spot-check:

| Story | Description | Resolution path |
|---|---|---|
| US-11.7 | atelier reconcile | Implementation lives at `scripts/sync/reconcile.ts`; no ADR formally cites it because the spec-to-implementation link is implicit in BUILD-SEQUENCE M1. Coverable by build-registry script |
| US-11.10 | atelier upgrade CLI | Genuinely unimplemented; M7 CLI surface scope per BUILD-SEQUENCE §9 |
| US-11.11 | atelier audit | Validator IS the raw form (per scripts/README.md). M7 polish wraps as CLI |
| US-12.1 | Telemetry emission | Implementation in write.ts (`recordTelemetry`); no ADR cites directly. Coverable by build-registry |
| US-12.2 | Admin observability sub-route | Genuinely unimplemented; M7 BUILD-SEQUENCE scope |
| US-12.3 | Session heartbeat dashboard | Genuinely unimplemented; M7 |

Pattern: most "no resolution path" entries are EITHER (a) implemented but not registered in traceability.json (build-registry script gap from M1-exit F1), OR (b) genuinely M7 scope. Neither warrants M6-exit blocking.

**Coverage cannot be computed numerically** until F1 lands. Same as M1-exit.

### 7. Operational completeness

Per `.atelier/config.yaml: review.milestone_exit.operational_completeness_map`:

- `mcp_clients: docs/user/connectors/` -- present: `claude-code.md` (corrected at PR #18), `cursor.md`, `chatbot-pattern.md`, `README.md`. Missing: `claude-ai.md` for claude.ai Connectors (deferred per BRD §28 -- the deploy executed but the runbook capturing the Connectors-specific config didn't land yet)
- `external_integrations: docs/user/integrations/` -- not yet present (M7 polish per BUILD-SEQUENCE; no external-integration adapters need runbooks at v1 because `noop` is the only registered)
- `cli_commands: docs/user/reference/cli/` -- not yet present (M7 polish per BUILD-SEQUENCE; no polished CLI yet)

**M6-specific completeness gap:** `docs/user/tutorials/first-deploy.md` is referenced from `local-bootstrap.md` step "What's next" but doesn't exist yet. The deploy executed during M6 entry; the runbook capturing the actual sequence (vercel + cloud Supabase + rootDirectory + env-var newline gotcha + Path 2 split URL choice + bearer-rotation friction) is captured in commits and the M6 runbook bundle's findings, but a focused user-facing runbook hasn't been written. **File as M6.5 or M7-entry follow-up.**

---

## Drift items requiring action

### M6-exit-foldable (none)

No new drift introduced by M6 that needs to land alongside this audit. PR #18 landed all 8 runbook fixes; PR #19 + #21 closed the substrate gaps; PR #20 added the regression-class smoke.

### M7-entry follow-ups (filed; not foldable in M6)

| Item | Severity | Description | Recommended landing |
|---|---|---|---|
| F6.1 | LOW | ARCH 5.1 prose enumerates 11 tables; should enumerate 12 (add `triage_pending`) | M7 polish doc-pass |
| F6.2 | MEDIUM | `docs/user/tutorials/first-deploy.md` doesn't exist; deploy executed at M6 entry but runbook didn't author | M6.5 follow-up OR M7 polish |
| F6.3 | LOW | `docs/user/connectors/claude-ai.md` missing (claude.ai Connectors config) | M7-entry alongside first-deploy.md (the Connectors flow only makes sense once a public endpoint exists, which the deploy provides) |
| F6.4 | LOW | Bearer-cache durability finding (memory feedback): Claude Code's MCP HTTP client caches bearer in process state surviving restart + /mcp Disable→Enable. M7 should add a real Claude Code MCP-client smoke that exercises bearer rotation explicitly | M7 polish |
| F6.5 | LOW | Lens panel for `overlapping_active` (task #12 deferred to M7) | M7 polish OR after adopter signal on UI affordance shape |

### M1-exit follow-ups still open

| Item | Status |
|---|---|
| F1 (build-registry script) | Still open. M7 polish slot per BUILD-SEQUENCE §9 (`atelier audit` polished form). Empirically a non-blocker for milestone progress; only blocks the validator's `--per-pr` mode promotion to hard CI gate |
| F2 (`edges[]` graph derivation) | Same as F1 (same script's deliverable) |
| F3 (validator `--per-pr` hard gate) | Resolves automatically once F1 lands |
| F4 (`operational_completeness_map`) | Now declared in `.atelier/config.yaml` (lines 219-226 confirmed during this audit). Effectively resolved, pending validator implementation of the check class |
| F5 (test fixtures in citation walk) | Trivial; not on critical path |

---

## Pattern observations

Three patterns emerged during M6 worth surfacing as input to M7 strategic planning:

### Pattern 1: Smoke-vs-real-client divergence is the reliable bug class

Six instances during M5/M6 stretch:

| # | PR | Class |
|---|---|---|
| 1 | #9 (M5-exit) | `notifications/initialized` handshake (JSON-RPC level) |
| 2 | #11 | `registration_endpoint` absent in OAuth discovery |
| 3 | #13 | `registration_endpoint` emission shape (relative→absolute) |
| 4 | #14 | `registration_endpoint` presence (URL split) |
| 5 | trim() commit | Trailing newline in env-var-derived issuer |
| 6 | #16 | Next.js HTML 404 on probe paths (SDK can't JSON-parse `<`) |

Each surfaced when a real MCP client connected; none were caught by smoke that mounted its own `http.createServer`. PR #20 (real CC MCP-client probe-shape smoke) was promoted from M7 to M6 to catch this regression class going forward; verifying its catch rate at subsequent PRs is itself an M7-entry item (worth 1-2 quarters of operational data before retiring the memory entry as resolved).

### Pattern 2: Substrate iteration consumes more milestone budget than feature work

Of 11 M6 PRs, 6 were substrate fixes (PRs #11, #13, #14, #15, #16, #18) and only 4 were feature work (PRs #17, #19, #20, #21). The substrate-fix budget exceeded the feature-work budget. The promoted CC-MCP-client smoke is the load-bearing M7 mitigation: with that smoke in place, future divergence-class regressions surface at PR time rather than at operator handoff.

### Pattern 3: Bootstrap inflection (ADR-044) operationalized successfully

ADR-044 promised "build sessions become MCP clients of the substrate from M6 forward". M6 delivered: every M6 work item except deploy was authored against the substrate (curl-based when MCP client cached stale bearers; tool-based when fresh). The bootstrap's friction surfaced and was documented (PR #18's 8 findings); the substrate's correctness was validated end-to-end against a deployed environment for the first time. ADR-044's reverse-condition discipline (pause M6 when substrate breaks; fix in focused PR; resume) fired six times and held its shape across all six.

---

## Sign-off

This audit identifies five M7-entry follow-ups (F6.1-F6.5; severities LOW/MEDIUM), surfaces no M6-specific drift requiring action, and confirms M6 substrate + feature deliverables green across 26 + 50+ new smoke assertions plus the existing M5-baseline 200+ assertions. All seven sweep areas pass with the same single root-cause drift M1-exit identified (F1 / traceability.json registry gap); no new M6 drift.

**Recommendation:** mark M6 status as Done. The five M7-entry follow-ups (ARCH 5.1 prose update, first-deploy.md, claude-ai.md, bearer-cache real-client smoke, lens panel for overlapping_active) sequence into M7 polish per BUILD-SEQUENCE §9.

The deploy artifact (`https://atelier-three-coral.vercel.app`) is live with all M6 substrate including the catch-all JSON 404, URL split, and registration_endpoint absolute URL. Future PRs against main auto-deploy via Vercel git integration once that's wired (M6.5 follow-up; not blocking).

**Architect approval:** _pending_

---

## Cross-references

- BUILD-SEQUENCE.md §M6 -- Remote-principal composers + triage
- ADR-018 -- Triage never auto-merges (foundational decision for migration 9)
- ADR-022 -- claim() atomic-create-and-claim path (used by triage approval flow)
- ADR-025 -- Review routing keyed by territory.review_role (FeedbackQueuePanel `routedToViewer` flag)
- ADR-028 -- Supabase Auth + static bearer (substrate-fix series rationale)
- ADR-040 -- 12-tool surface lock (held under ADR-045 stress test)
- ADR-044 -- Bootstrap inflection at M5-exit (operationalized through M6)
- ADR-045 -- get_context.scope_files (M6's lone new ADR; PR #17)
- METHODOLOGY 11.3 -- Milestone-exit drift sweep
- METHODOLOGY 11.5 -- Data-model + contract audit (milestone-entry; not invoked at M6 exit but invoked at M2 entry which seeded the territories the triage substrate consumes)
