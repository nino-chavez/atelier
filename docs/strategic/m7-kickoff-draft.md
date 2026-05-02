# M7 kickoff prompt (DRAFT — surface to user for refinement)

**Status:** Draft authored 2026-05-02 at M6-exit. Refine + open the M7 session against the final version.

**Author:** Claude Opus 4.7 with explicit user direction at M6 close-out.

**Source materials:**

- `docs/strategic/BUILD-SEQUENCE.md` §M7 (Hardening + open-ADR resolution)
- `docs/architecture/audits/milestone-M6-exit.md` (this audit's M7-entry follow-ups)
- `docs/functional/BRD-OPEN-QUESTIONS.md` open entries: §7, §21, §22, §23, §26, §27, §28
- M6 conversation transcripts (polish items + emergent patterns)
- `MEMORY.md` — feedback memories that inform M7 priorities

---

## M7 framing

Per BUILD-SEQUENCE: **Hardening + open-ADR resolution. Closes the loop.** A fresh `atelier init` on an empty directory produces a working coordination substrate with one command. Public reference implementation is announced.

M6 substantially expanded the substrate's correctness baseline (URL split, JSON-404 catch-all, registration_endpoint absolute, env-var trim, real-CC-MCP-client smoke). M7's job is to harden that baseline into something an adopter can drop into without being on a four-iteration substrate-fix dance.

**Three tracks** that should compose into roughly equal-weight workstreams:

1. **Adopter-readiness:** CLI polish, runbook condensation, deploy automation, observability surface
2. **Open-question resolution:** the 7 BRD-OPEN-QUESTIONS that remain genuinely open
3. **Quality bar:** lint discipline, blocking-tier eval gate (if eval data clears), real-CC-MCP-client smoke catch-rate verification

---

## Track 1: Adopter-readiness (the "fresh atelier init works" promise)

### CLI polish (BUILD-SEQUENCE §9 polished form)

12 v1 commands need polished form: exit codes, `--help`, end-to-end tested. Per BUILD-SEQUENCE §9 the raw forms exist for most:

| Command | Raw form | Polished form (M7) |
|---|---|---|
| `atelier init` | M0 + M2 | M7 |
| `atelier datastore init` | M2 | M7 |
| `atelier deploy` | M3 (raw deploy script) | M7 |
| `atelier invite` | M6 (token issuance) | M7 |
| `atelier territory add` | M2 (manual yaml edit) | M7 |
| `atelier doctor` | M2 (raw script) | M7 |
| `atelier upgrade` | -- | M7 (full) |
| `atelier sync` | M1 | M7 |
| `atelier reconcile` | M1 | M7 |
| `atelier eval find_similar` | M5 | M7 |
| `atelier audit` | (validator IS the raw form) | M7 |
| `atelier review` | (manual via PRs) | M7 |

**Sub-question (RESOLVED 2026-05-02):** `atelier dev` lands as a v1 CLI command. Bootstrap friction has been the most consistent operational pain through M2-M6 (4+ runbook drift findings, 2 bearer-cache incidents, 1 port-mismatch fix); adoption-readiness depends on bootstrap being one command. File as US-11.X. Doesn't touch the ADR-013/040 12-tool MCP surface lock (CLI surface, not MCP tool).

### Runbook condensation

After M6 added 8 troubleshooting findings + Step 0 pre-flight to `local-bootstrap.md`, the runbook is long. If `atelier dev` lands as automation, much of the troubleshooting becomes pre-empted (auto-checks before the dev server starts). Condensation targets:

- Trim Step 0 if `atelier dev` runs the same checks
- Move bearer-rotation troubleshooting to a focused `docs/user/guides/rotate-bearer.md` (currently inline)
- Consolidate the 4 substrate-fix-derived troubleshooting entries into a single "if /mcp fails" decision tree
- Archive the now-redundant runbook segments to `docs/architecture/audits/m6-runbook-condensation.md` for provenance

### `docs/user/tutorials/first-deploy.md`

The deploy executed during M6 entry; the runbook capturing the actual sequence (vercel project creation, rootDirectory=prototype, env-var newline gotcha, Path 2 split URL choice, bearer-rotation) is captured in commits but not as a focused runbook. M7 authors it. **Sources:** PR #14, #16, #18 commit messages; the M6-exit audit's deploy section; the live `atelier-three-coral.vercel.app` deployment as the verifiable target.

### `docs/user/connectors/claude-ai.md`

Claude.ai Connectors flow makes sense once a public endpoint exists (post-deploy). Per BRD §28 trigger #2's empirical confirmation, this is genuinely M7+ work. Captures the OAuth-flow path (`/oauth/api/mcp`) — the URL split exists for this client class.

### Vercel git integration + auto-deploy

Currently `vercel deploy --prod` is manual. Wiring git integration so push-to-main auto-deploys is a 5-min config change at vercel.com. Lands as a tiny PR + first-deploy.md note.

### Observability stack (BUILD-SEQUENCE explicit)

`/atelier/observability` route, telemetry table populated visibly, alerting hooks. Telemetry exists in the table (per write.ts `recordTelemetry`); the dashboard surfacing is M7 work. Plus alert config (e.g., bearer-rotation observation, find_similar degradation).

---

## Track 2: Open-question resolution

7 entries open in BRD-OPEN-QUESTIONS. M7 strategic call needed on each:

### §7 — Scale ceiling per guild (RESOLVED 2026-05-02: M7 with bounded scope)

M7 is hardening; scale-ceiling IS hardening. But the full benchmark is substantial; don't try to do all of it. M7 ships: (a) load-generation harness, (b) observability hooks for per-component perf measurement, (c) document the empirically-measured envelope (vs the v1 hypothesis committed in §7). Defer "find the actual ceiling" to whenever real load demands it. Net M7 cost: ~3-5 days, not 1-2 weeks.

### §21 — AI auto-reviewers as `review_role` type (RESOLVED 2026-05-02: V1.x defer)

Too big for M7 + crowds out hardening. Per ADR-011 destination-first: schema reservation (`territories.<name>.ai_review_policy: null`) already covered at v1; ship the implementation at v1.x. M7 should tighten what we have, not add new feature surfaces.

### §22 — Semantic contradiction validator (RESOLVED 2026-05-02: V1.x defer)

Same reasoning as §21 — feature-add, not hardening. The OpenAI-compatible adapter pattern (ADR-041) is the substrate hook for the semantic check; the validator implementation is v1.x scope. M7 doesn't need new analysis surfaces; it needs to harden what's there.

### §23 — Annotation surface (RESOLVED 2026-05-02: V1.x with adopter-signal bar held)

The 2026-04-28 update on §23 already softened to "defer to v1.x M6 with a higher bar to land (concrete pre-M6 user request needed, not speculative coordination-surface gap)." That bar was never met. M7 should not pull this forward absent a concrete adopter request. PR comments + chatbot pattern (per `docs/user/connectors/chatbot-pattern.md`) cover the practical need.

### §26 — Multi-corpus eval (find_similar) — M7 explicit scope

M7 explicit scope per the entry. Wider eval against ≥1 external corpus; data informs §27 blocking-tier flip per the rule below.

### §27 — Cross-encoder reranker (find_similar) — gated on §26 + flip rule

Gated on §26 data. Activation rule (per the resolved blocking-tier flip below): if 2-of-2 corpora clear blocking-tier with ≥50% margin above noise floor → §27 lands as the activation. If 1-of-2 → §27 stays opt-in. If 0-of-2 → §27 deferred indefinitely (advisory becomes the v1 destination, not a way station).

### §28 — Deploy strategy ADR — M7 entry deliverable

Trigger #2 fired during M6; deploy executed; ADR authoring is overdue. M7 entry includes filing the ADR — it documents the choices made empirically (Vercel + cloud Supabase + rootDirectory=prototype + URL split inheritance) so adopters can replicate.

---

## Track 3: Quality bar

### Real-CC-MCP-client smoke catch-rate verification

Memory entry "smoke-vs-real-client divergence is the reliable bug class" predicts the new PR #20 smoke catches divergences at PR time. M7 verifies: how many PRs through the M7 cycle catch a divergence via PR #20's smoke vs. surface at operator handoff? **If smoke catches them:** retire the memory entry as resolved (a real verification rather than just a hypothesis). **If divergences slip through:** expand the smoke's probe coverage.

### Blocking-tier eval gate flip (RESOLVED 2026-05-02 — concrete rule below)

Per ADR-043 the eval gate is currently advisory (precision >= 0.60, recall >= 0.60; cleared at M5). Blocking tier (precision >= 0.85, recall >= 0.70) is reserved.

**Activation rule (file in M7 wider-eval ADR when it lands):**

> Blocking tier flips from opt-in to v1.x default when, in M7 wider eval (per BRD §26):
> - At least 2 distinct corpora measured (Atelier's own + ≥1 external)
> - 2-of-2 clear blocking-tier with ≥50% margin above measured noise floor (~5pp recall variance per ADR-045 calibration)
>
> If 2-of-2 cleared: ship blocking as v1.x default; cross-encoder reranker (BRD §27) lands as the activation
> If 1-of-2 cleared: blocking stays opt-in; document the corpus-class generalization gap
> If 0-of-2 cleared: reverse the blocking-tier framing entirely — advisory IS the v1 destination, not a way station

Without a defined rule, "consistent" stays subjective and the flip never happens. The rule above gives M7 a concrete go/no-go criterion against measurable data.

### Lint rule for proprietary imports outside named adapters

Per ADR-029. Static analysis catches `@vercel/edge`, `@vercel/kv`, `Edge Config`, Supabase RPC helpers leaking outside `scripts/coordination/adapters/`. ESLint custom rule or a tsx-based check. ~half-day of work.

### `yamllint` pre-commit (PR #10 follow-up)

PR #10 was a hotfix for a YAML-colon-in-step-name parse error that broke CI silently for several weeks. Pre-commit `yamllint` catches that class. Already in PR #10's commit message as the suggested follow-up; lands at M7 entry.

### Bearer-rotation automation

Memory entry: Claude Code's MCP HTTP client caches bearers durably; rotation requires a full restart. M7 polish should:
1. Add a `scripts/bootstrap/rotate-bearer.ts` wrapper that issues a fresh bearer + writes `.mcp.json` + prints a friendly "now restart Claude Code" reminder
2. Investigate where Claude Code caches the bearer (open question; may be in a state file we haven't located, or genuinely process-memory)
3. If the cache location IS findable: a `--clear-cache` flag on the rotation script

### Polish-pass refactor opportunities

Identified during M6 but deferred:

- `scripts/sync/lib/write.ts` is 2065 lines; could split contributions/locks/decisions/sessions/triage into separate files
- The `route-proposal.ts` CLI parsing duplicates patterns elsewhere; extract a small CLI-args lib
- The `__smoke__` cleanup pattern (`'name LIKE 'smoke-%'`) bug from PR #10 era still has a few stragglers (`'transport-smoke-%'` in the transport.smoke.ts cleanup; doesn't match the actual `transport-smoke` name); fix as polish

---

## Strategic calls — RESOLVED 2026-05-02

The 7 calls were resolved at M6 close-out via Nino + Claude conversation. Resolutions folded into the section bodies above; summary here:

| # | Question | Resolution | Affects |
|---|---|---|---|
| 1 | `atelier dev` as 13th CLI command vs convenience | **V1 CLI command** | Track 1 CLI polish scope |
| 2 | §7 scale-ceiling benchmark — M7 or post-v1 | **M7 with bounded scope** (harness + observability + measured envelope; not "find the ceiling") | Track 2 §7; M7 budget +3-5 days, not +1-2 weeks |
| 3 | §21 AI auto-reviewers — v1 or v1.x | **V1.x defer**; schema slot already reserved at v1 | Track 2 §21 |
| 4 | §22 semantic contradiction — M7 or v1.x | **V1.x defer**; feature-add not hardening | Track 2 §22 |
| 5 | §23 annotation surface — v1 inline or PR-only | **V1.x with adopter-signal bar held**; PR comments + chatbot pattern cover need | Track 2 §23 |
| 6 | Blocking-tier flip rule — what counts as "consistent" | **2-of-2 corpora clear with ≥50% margin above noise floor** (concrete rule above) | Track 3 blocking-tier flip; M7 wider-eval ADR |
| 7 | Lens panel for overlapping_active — M7 polish or wait | **Wait for adopter signal**; M7 IF concrete affordance surfaces during adopter-readiness work | Track 3 polish (conditional) |

**Net M7 scope per resolutions:** Adopter-readiness (Track 1) + Hardening polish (Track 3) + §26 wider eval + §27 conditional + §28 ADR + §22 schema reservation. Defers to v1.x: §21, §22 implementation, §23. Defers conditional on signal: lens panel for overlapping_active.

**Net effect:** M7 stays tight on hardening; doesn't crowd with feature-adds.

---

## M7 success criteria (proposed)

Lifted from BUILD-SEQUENCE §M7 with M7-specific additions:

- All 35 design decisions in `docs/functional/PRD-COMPANION.md` are DECIDED (no OPEN)
- `atelier init` round-trips clean against an empty directory (the demoable)
- Public reference implementation announced
- BRD-OPEN-QUESTIONS reduces from 7 to ≤3 (the genuinely-deferred ones; sections 7, 21, 23 plausible holdovers if user defers)
- Real-CC-MCP-client smoke catch-rate verified across ≥10 PRs through M7 (data point: did the smoke catch any divergences at PR time?)
- M6 follow-ups (F6.1-F6.5 from M6-exit audit) all closed

---

## Suggested M7 prompt structure (when ready to open the session)

```
You're picking up the Atelier project at M7 entry. M6 substrate complete; deploy
live at https://atelier-three-coral.vercel.app. Public reference implementation
is M7's exit goal.

Read first:
- docs/architecture/audits/milestone-M6-exit.md (this audit; M7-entry follow-ups
  F6.1-F6.5)
- docs/strategic/BUILD-SEQUENCE.md §M7
- docs/strategic/m7-kickoff-draft.md (the prompt source itself; refine inline)
- docs/functional/BRD-OPEN-QUESTIONS.md (7 open entries to triage)

Operating discipline (unchanged from M6):
- Open with get_context (substrate first)
- claim before authoring contributions; read similar_warnings + overlapping_active
- log_decision for ADR-class decisions
- Watch /atelier broadcast presence + claims live
- ADR-044 reverse condition still applies — pause M7 when substrate breaks; fix
  in focused PR; resume

Sequence M7 work in this order (revisable based on user input):
1. M6 follow-ups (F6.2 first-deploy.md is highest priority; blocks claude.ai
   Connectors validation per BRD §28)
2. Track 3 (quality bar) — yamllint pre-commit + lint discipline + smoke
   catch-rate verification setup. Lands fast; reduces M7 risk.
3. Track 2 (open questions) — file ADRs in dependency order: §28 (deploy
   strategy) first since the empirical decisions are already made; §22
   (semantic validator) second; §26 wider eval data collection in parallel
   to the rest of M7
4. Track 1 (adopter-readiness) — CLI polish in BUILD-SEQUENCE order; runbook
   condensation after CLI lands so the runbook reflects actual command
   surface; observability stack as a final pass

When M7 PR is ready: PR with the work + M7-exit audit. CI green is the merge gate.
After merge, run the public-reference-implementation announcement (the demoable
itself is the announcement: `atelier init demo-project && cd demo-project &&
atelier deploy`).

Do NOT:
- Land §21 (AI auto-reviewers) at v1 unless the strategic call shifts (default v1.x)
- Skip ADR-NNN deploy-strategy; the empirical choices need codification
- Ship CLI polish without first-deploy.md (deploy is the most-friction surface
  for adopters)
```

---

## Refinement asks for the user

The 7 strategic calls are resolved (above); Tracks 1/2/3 framing stands; success criteria stand. Remaining refinements before opening the M7 session:

1. **Confirm or adjust the resolutions** above if any read missed something
2. **Cadence preference** — back-to-back from M6 close, or a deliberate cool-down before M7 starts?
3. **Public-reference-implementation announcement plan** — when M7 substrate is done + a clean `atelier init` produces the demoable, does the announcement happen via README + repo description update only, or also via external surfaces (HN / Twitter / blog)?

This draft is now closer to canonical than draft. The M7 session opens against this version + any refinements you fold inline before opening.
