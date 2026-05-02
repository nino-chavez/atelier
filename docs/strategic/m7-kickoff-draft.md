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

**Sub-question:** does `atelier dev` (a wrapper around `supabase start && npm run dev` per the polish item from M6 conversation) belong as a 13th CLI command? If yes, it lands here. If no, it stays a polish-time convenience script.

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

### §7 — Scale ceiling per guild

Real benchmark required (per the entry). Status: OPEN since M0; M5/M6 didn't generate the data. M7 candidate IF the team has 1-2 weeks for benchmark setup. **Strategic call needed:** does Atelier need scale data before public announcement, or is "documented envelope, benchmark deferred" acceptable for v1?

### §21 — AI auto-reviewers as `review_role` type

Highest-leverage v1.x feature per the 2026-04-28 AI-speed pivot. M7 strategic call: does this land at v1, or v1.x? Recommendation in the entry: v1.x. **My read:** keep at v1.x; M7 reserves the config surface (`territories.<name>.ai_review_policy: null`) so the structural slot exists. Adding the actual AI-review path expands M7 budget materially.

### §22 — Semantic contradiction validator

"Hallucinated decision debt" check class. M7 entry candidate. **My read:** can land as a `validate-refs.ts` extension that calls find_similar against new ADRs to surface "this contradicts ADR-XYZ" warnings. Bounded scope; ~1 day of work.

### §23 — Annotation surface

PR-style line-level comments on canonical state. M7 entry candidate. Larger scope. **My read:** strategic call — does Atelier ship inline annotation at v1, or do we keep PRs as the annotation surface and document the workflow?

### §26 — Multi-corpus eval (find_similar)

M7 explicit scope per the entry. Wider eval against synthetic + real corpora; cross-encoder reranker is gated on this data per §27.

### §27 — Cross-encoder reranker (find_similar)

Gated on §26 data. **If §26 reveals find_similar precision/recall is below blocking-tier:** §27 lands. **If §26 reveals the heuristic is enough:** §27 deferred indefinitely. The advisory/blocking gate-tier split (per the memory entry) holds the optionality.

### §28 — Deploy strategy ADR

Trigger #2 fired during M6; deploy executed; ADR-NNN authoring is overdue. M7 entry includes filing this ADR — it documents the choices made empirically (Vercel + cloud Supabase + rootDirectory=prototype + URL split inheritance) so adopters can replicate.

---

## Track 3: Quality bar

### Real-CC-MCP-client smoke catch-rate verification

Memory entry "smoke-vs-real-client divergence is the reliable bug class" predicts the new PR #20 smoke catches divergences at PR time. M7 verifies: how many PRs through the M7 cycle catch a divergence via PR #20's smoke vs. surface at operator handoff? **If smoke catches them:** retire the memory entry as resolved (a real verification rather than just a hypothesis). **If divergences slip through:** expand the smoke's probe coverage.

### Blocking-tier eval gate flip

Per ADR-043 the eval gate is currently advisory (precision >= 0.60, recall >= 0.60; cleared at M5). Blocking tier (precision >= 0.85, recall >= 0.70) is reserved. **Decision rule:** if M7 wider eval (§26) shows precision/recall consistently above blocking thresholds across multiple corpora, flip the gate to blocking. **Sub-question:** what's the threshold for "consistently"? 3 of 3? 2 of 3? File as a sub-decision when M7 wider eval lands.

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

## Open strategic calls for the user

These I cannot autonomously decide:

1. **`atelier dev` wrapper as 13th CLI command, or polish-time convenience?** Affects CLI polish scope.
2. **§7 (scale ceiling) benchmark — M7 scope or deferred to post-v1?** Affects M7 budget by 1-2 weeks.
3. **§21 (AI auto-reviewers) — v1 or v1.x?** Recommendation in the BRD entry is v1.x; my read concurs. User confirms.
4. **§22 (semantic contradiction validator) — M7 or v1.x?** Bounded scope (~1 day); recommend M7.
5. **§23 (annotation surface) — v1 inline annotations, or PR-only?** Strategic call.
6. **Find_similar blocking-tier flip rule — what counts as "consistent" across corpora?** Sub-decision when §26 wider-eval data lands.
7. **Lens panel for `overlapping_active` (deferred from M6 task #12) — M7 polish or wait for adopter signal?** Default per memory: wait for signal. User confirms.

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

When ready, please:

1. **Pick a side on each of the 7 open strategic calls** above (or defer explicitly with rationale)
2. **Confirm or adjust the three-track framing** — does this match your priorities, or is one track outsized for M7's budget?
3. **Confirm the success criteria** — anything to add or remove?
4. **Edit the suggested prompt structure inline** in this draft file; I'll fold your edits + open the M7 session against the final
5. **Indicate cadence preference** — back-to-back from M6 close, or a deliberate cool-down before M7 starts?

This draft is meant to be edited freely. Not load-bearing as written; load-bearing once you sign off.
