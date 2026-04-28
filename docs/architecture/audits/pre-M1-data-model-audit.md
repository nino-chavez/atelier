---
last_updated: 2026-04-28
status: complete; findings landed as ADR-033/034/035/036 + ARCH 5.1 edits + BRD-OPEN-QUESTIONS section 20
audit_kind: data-model + contract
applies_to: ARCH section 5.1 (Datastore schema), 5.4 (Vector index), 6.6 (Contract flow), 7.4 (Fencing)
---

# Pre-M1 data-model and contract audit

**Audit run:** 2026-04-28
**Auditor:** architect role (manual run; codified going forward via METHODOLOGY 11.5)
**Milestone gate:** M1 entry (M1 ships the four schema tables + sync scripts; encoded migrations are much harder to refactor than spec'd schema, so the audit lands now)
**Per:** new METHODOLOGY 11.5 data-model + contract audit check class (folded into methodology in the same commit as this audit)

---

## Why this audit exists

The walks (analyst, dev, designer) validated end-to-end flow correctness. They did not audit the schema for semantic-axis cleanliness, derivable-vs-stored coherence, or constraint-surface completeness. The `kind=proposal` semantic conflation surfaced in conversation (2026-04-28) rather than from a prior audit, which IS the evidence the audit is missing.

This audit applies five checks to the v1 schema before M1 implementation encodes it:

1. **Field semantic atomicity** -- each column carries exactly one classification axis
2. **Derivable vs stored** -- denormalizations are intentional and documented
3. **Enum coherence** -- every enum's values share one classification axis; no "other" / "misc" values smuggling a second axis
4. **Constraint surface** -- CHECK constraints, FKs, NOT NULL, transition rules are specified
5. **Lifecycle invariants** -- mutability per field, permitted state transitions, FK durability across row deletions

---

## Summary

| Check | Findings | Severity mix |
|---|---|---|
| Field semantic atomicity | 3 | 2 HIGH, 1 MEDIUM |
| Derivable vs stored | 2 | 1 HIGH, 1 MEDIUM |
| Enum coherence | 4 | 2 HIGH, 1 MEDIUM, 1 LOW |
| Constraint surface | 4 | 1 HIGH, 2 MEDIUM, 1 LOW |
| Lifecycle invariants | 5 | 2 HIGH, 2 MEDIUM, 1 LOW |

**18 findings total.** 6 HIGH, 7 MEDIUM, 5 LOW.

**Headline:** 4 ADRs land in this commit (ADR-033 through ADR-036) covering the HIGH findings that touch the schema. 1 finding (F12) files as BRD-OPEN-QUESTIONS section 20 because the right answer requires a strategic call on role-vocabulary. The remaining LOW + several MEDIUM findings land as ARCH 5.1 documentation tightening + CHECK-constraint adds in the same commit.

---

## Findings

### F1 (HIGH) -- `contributions.kind` conflates intent and provenance via `proposal`

**Location:** ARCH 5.1 contributions table; ARCH 6.2.1 atomic create-and-claim signature; BRD US-2.x acceptance criteria; ARCH 6.5 triage flow.

**Schema fragment.**
```
contributions.kind enum: implementation | decision | research | design | proposal
```

**Smell.** Four of the five values describe **what the work produces** (implementation -> code; decision -> ADR; research -> artifact; design -> tokens/components). `proposal` describes **where the work came from** (raised by an outsider to the territory or by triage). Two axes collapsed into one enum.

**Operational consequence.** A research-discipline change raised by triage is `kind=proposal`, not `kind=research`. Filtering "show me all research-related contributions" misses proposals targeting research. After a proposal is approved, the field stays `kind=proposal` -- the schema cannot answer "what did this proposal become?"

**Why kind=proposal is also redundant.** The merge gate it implies ("proposals require explicit human approval") is already enforceable via `author.role` x `territory.owner_role` check (per ARCH 6.2.1 validation step 4). The role check is the actual authorization; `kind=proposal` is a denormalized echo.

**Recommended fix.** Drop `proposal` from the enum. The merge gate is enforced by the role check that already exists. Provenance ("who raised it") is already preserved via `author_session_id` -> `composers.default_role` joined against `territory.owner_role`.

**Lands as:** ADR-033.

---

### F2 (HIGH) -- `contributions.kind=decision` is unreachable / orphan enum value

**Location:** ARCH 5.1 contributions table; ARCH 6.2.3 ("For decisions: decisions log via `log_decision`, not via update. They have no `review` state."); ARCH 6.3 log_decision flow.

**Schema fragment.**
```
contributions.kind enum includes: decision
```

**Smell.** Per ARCH 6.2.3, decisions don't flow through the contributions table -- they flow via `log_decision` (ARCH 6.3), which writes to the `decisions` table directly and creates an ADR file. There is no specified path that creates a `contributions.kind=decision` row.

ARCH 6.2.1 validation accepts `kind=decision` on atomic-create, but no flow exists to author against such a contribution. It would be a row in `state=claimed` with no specified update path.

**Operational consequence.** An agent calling `claim(null, kind="decision", ...)` would succeed and create a row that has no merge path. Either the endpoint must reject `kind=decision` (then the value shouldn't be in the enum), or the spec must define what authoring against a `kind=decision` contribution does (it doesn't, and adding such a path would duplicate `log_decision`).

**Recommended fix.** Drop `decision` from the contributions.kind enum. Decisions are first-class via `log_decision` and the `decisions` table; they don't need a parallel contribution path.

**Lands as:** ADR-033 (folded with F1 -- both are kind enum scoping).

---

### F3 (LOW) -- `vector_index.source_kind` naming overlap with `contributions.kind` and `territories.scope_kind`

**Location:** ARCH 5.4 vector index.

**Schema fragment.**
```
vector_index.source_kind enum: decision | contribution | brd_section | prd_section | research_artifact
```

**Smell.** Three different enums with `kind` in the name across the schema:
- `contributions.kind` -- output discipline
- `territories.scope_kind` -- artifact shape
- `vector_index.source_kind` -- corpus origin class

The domains are genuinely different but the shared word reads as "these enums must align" -- they don't. A reader hitting all three in sequence has to keep three separate enum spaces in mind.

**Operational consequence.** Cognitive overhead, not bug. The values themselves are fine for their respective purposes.

**Recommended fix.** Documentation tightening only. ARCH 5.1 / 5.4 should call out explicitly that the three `*_kind` fields live in three independent namespaces and must not be unified. No schema change.

**Lands as:** ARCH 5.1 / 5.4 documentation note (this commit).

---

### F4 (HIGH) -- `contributions.state` mixes lifecycle position with status flag

**Location:** ARCH 5.1 contributions table; ARCH 6.2 lifecycle.

**Schema fragment.**
```
contributions.state enum: open | claimed | in_progress | review | merged | rejected | blocked
contributions.blocked_by uuid (fk, nullable)
```

**Smell.** Six of the seven values describe lifecycle position (open / claimed / in_progress / review / merged / rejected). `blocked` describes a status flag orthogonal to position -- a contribution can be blocked while claimed, blocked while in_progress, blocked while in review. The single `state` field can only carry one of "blocked" or "in_progress" but the truth is both.

The schema already has a separate `blocked_by` column, signaling that someone recognized blocked needed extra metadata. The split is half-done.

**Operational consequence.** Querying "what's stuck right now?" requires `state=blocked`, but querying "what's actively being worked?" with `state IN (claimed, in_progress)` misses blocked work that should still surface as in-flight. Reports under-count.

**Recommended fix.** Split the axis:
- `state` enum: open | claimed | in_progress | review | merged | rejected (6 values, pure lifecycle)
- `blocked_by` uuid (nullable) -- non-null implies blocked; the field already exists

A contribution is "blocked" iff `blocked_by IS NOT NULL`. The lifecycle position is preserved (was it blocked during in_progress? during claimed?), and the queries above behave intuitively.

**Lands as:** ADR-034.

---

### F5 (HIGH) -- `contracts.breaking_change` boolean misses the ARCH 6.6.1 classifier surface

**Location:** ARCH 5.1 contracts table; ARCH 6.6.1 breaking-change classifier.

**Schema fragment.**
```
contracts.breaking_change bool
```

**Smell.** ARCH 6.6.1 specifies a much richer classification including:
- Multiple breaking-change criteria (field removed, field renamed, narrowed type, required field added, default changed, etc.)
- Publisher override mechanism (`override_classification="additive"` + required `override_justification`)
- Override audit trail in `/atelier/observability`
- Override reversibility by consumer territories

None of `override_classification`, `override_justification`, `classifier_decision_reason` are in the schema. The single bool collapses everything ARCH 6.6.1 specifies into a yes/no flag.

**Operational consequence.** When a publisher overrides, the audit trail lives... where? Telemetry might capture the event, but the contracts row that consumers query has no record of "this classification was overridden, here is the justification, here is the original classifier reading."

**Recommended fix.** Expand the contracts table with:
- `classifier_decision`: "breaking" | "additive" -- the classifier's reading
- `override_decision`: "breaking" | "additive" | null -- the publisher's override, if any
- `override_justification`: text -- required when override_decision is non-null
- `effective_decision`: GENERATED -- computed as `COALESCE(override_decision, classifier_decision)`
- Drop the existing `breaking_change` bool (consumers read `effective_decision = 'breaking'` instead)

Plus a CHECK constraint: `override_decision IS NULL OR override_justification IS NOT NULL`.

**Lands as:** ADR-035.

---

### F6 (MEDIUM) -- `decisions.category` includes vestigial "convention" value with no specified semantics

**Location:** ARCH 5.1 decisions table; ARCH 6.3.1 log_decision signature.

**Schema fragment.**
```
decisions.category enum: architecture | product | design | research | convention
```

**Smell.** Four values map to disciplines (architecture, product, design, research). `convention` does not -- it's a category-of-decision, not a discipline. This is the "other / misc" pattern that breaks the enum's classification axis.

The spec does not specify what makes a decision a "convention" decision, when an author would choose it, or what happens differently if they do.

**Operational consequence.** Authors guessing. The CategoricalChoice telemetry will show `convention` either being heavily used as a catchall (defeating the categorization) or never used (proving it was vestigial).

**Recommended fix.** Drop `convention`. Map historical/intended uses:
- A decision about repo conventions (e.g., commit-message format) -> `architecture` (it governs how the repo is structured, broadly architecture)
- A decision about coding style -> `architecture` (same)
- If a fifth distinct discipline emerges later, add it deliberately with explicit semantics, not as a catchall

**Lands as:** ADR-037 (folded with F7 -- both are decisions-table cleanup).

---

### F7 (MEDIUM) -- `decisions` table has no link back to triggering contribution

**Location:** ARCH 5.1 decisions table.

**Smell.** Decisions are sometimes triggered by a contribution (e.g., a dev's PR raises an architectural question that becomes an ADR). The decisions table has `session_id` but no `contribution_id` link. The relationship "this ADR was raised in the context of this contribution" is unrecoverable from the schema.

**Operational consequence.** When viewing an ADR you cannot navigate to the contribution that triggered it. Forensics requires reading the ADR body for citations.

**Recommended fix.** Add nullable FK `decisions.triggered_by_contribution_id`. Optional -- a decision can stand alone (e.g., a top-down architectural choice not raised by a specific contribution).

**Lands as:** ADR-037 (folded with F6).

---

### F8 (LOW) -- `contributions.transcript_ref` shape unspecified

**Location:** ARCH 5.1 contributions table comment "ADR-024 (sidecar transcript path/URL)".

**Smell.** The field is `text, nullable` and the comment says "path/URL" -- both forms accepted, no validation rule specified. ADR-024 establishes transcript opt-in but does not pin the reference shape.

**Operational consequence.** Implementations may diverge on what they accept. Clients have to handle both forms when reading.

**Recommended fix.** ARCH 5.1 documentation: specify that `transcript_ref` is either (a) a repo-relative path matching `transcripts/**/*.{md,jsonl}` or (b) a fully-qualified URL with scheme. Add a CHECK constraint enforcing one of the two patterns.

**Lands as:** ARCH 5.1 documentation + CHECK constraint (this commit).

---

### F9 (HIGH) -- `contributions.author_session_id` dangles when the session row is deleted

**Location:** ARCH 5.1 contributions table; ARCH 6.1.2 session row cleanup policy.

**Schema fragment.**
```
contributions.author_session_id (fk, nullable when open)
sessions: deleted by reaper when status=dead older than retention (default 24h)
```

**Smell.** A `state=merged` contribution preserves attribution via `author_session_id` -- it points at the session that did the work. But sessions are deleted by the reaper after 24 hours (per ARCH 6.1.2). After deletion, the merged contribution's `author_session_id` is a dangling FK reference.

The schema declares this an FK, so deletion either:
- Cascades (deletes all merged contributions -- catastrophic), or
- Is rejected (sessions cannot be deleted while contributions reference them -- defeats the cleanup policy), or
- Is allowed as a SET NULL (loses attribution forever)

None of the three is acceptable. The schema is internally inconsistent.

**Operational consequence.** Without resolution, M1's first implementation choice on the FK behavior locks in one of the three failure modes. Discovery happens 24h after the first contribution is merged.

**Recommended fix.** Split attribution into immortal (composer-level) and operational (session-level):
- Add `contributions.author_composer_id` (FK to composers, NOT NULL when state>open) -- the durable attribution
- Keep `contributions.author_session_id` (FK to sessions, nullable, may dangle / SET NULL on session delete) -- the operational at-time-of-work reference

`author_composer_id` survives session cleanup; queries asking "who authored this work" use it. `author_session_id` is best-effort for "which session was holding it during work" and gracefully nulls out.

Same fix applies symmetrically to:
- `decisions.session_id` -- becomes `decisions.author_composer_id` (immortal) + `decisions.session_id` (operational, nullable, SET NULL on delete) -- F15
- `telemetry.session_id` -- already nullable; add `composer_id` for durable attribution -- F18
- `locks.session_id` -- in practice released at session-death by reaper before deletion (per ARCH 6.1), so dangling is rare, but the SET NULL semantics should be explicit -- F10

**Lands as:** ADR-036 (covers F9, F10, F15, F18).

---

### F10 (LOW) -- `locks.session_id` dangling-FK risk, mitigated by reaper

**Location:** ARCH 5.1 locks table; ARCH 6.1 reaper.

**Smell.** Same shape as F9. In practice the reaper releases all locks held by a session at session-death (ARCH 6.1), so the lock row should be deleted before the session row is. But the ordering invariant is not specified at the schema level; an implementation bug could leave dangling lock rows.

**Operational consequence.** Low -- the reaper's invariant is well-understood. Risk is implementation defect, not design defect.

**Recommended fix.** ARCH 5.1 documentation: state explicitly that locks are released (deleted) at session-reap time, before the session row itself is deleted (24h post-reap). FK behavior on the lock's session_id can be SET NULL as defense-in-depth (handles the bug case). Folded into ADR-036.

**Lands as:** ADR-036.

---

### F11 (HIGH) -- Schema-spec drift: `repo_branch`, `commit_count`, `last_observed_commit_sha` referenced but absent

**Location:** ARCH 5.1 contributions table vs ARCH 6.2.2.1 endpoint observation of IDE commits.

**Smell.** ARCH 6.2.2.1 references three fields on contributions:
- `repo_branch` -- "set on the first IDE `update` call -- the agent declares its branch name explicitly"
- `commit_count` -- updated by the push handler
- `last_observed_commit_sha` -- updated by the push handler

None of the three is in the ARCH 5.1 schema definition. This is canonical-doc-internal drift.

**Operational consequence.** M1 implementation needs to know whether to add these fields or remove the references. Either choice is straightforward but the spec doesn't make it.

**Recommended fix.** Add the three fields to ARCH 5.1 contributions table. ARCH 6.2.2.1 specifies their lifecycle correctly; the schema just needs to catch up.

**Lands as:** ARCH 5.1 schema update (this commit; not an ADR -- spec drift correction).

---

### F12 (MEDIUM-HIGH) -- `composers.default_role` enum mixes work-discipline with access-level

**Location:** ARCH 5.1 composers table; territories.yaml owner_role / review_role; ADR-017 lens model.

**Schema fragment.**
```
composers.default_role enum: analyst | dev | pm | designer | admin | stakeholder
```

**Smell.** Four values are work disciplines (analyst, dev, pm, designer). Two are access levels (admin = platform privileges; stakeholder = read-only participation). Two axes in one field.

A pm is naturally also a stakeholder for work outside their territories. A designer might also need admin privileges. The current model handles this via "secondary roles per `.atelier/config.yaml`" but the primary role conflates the two.

ADR-017 lenses (analyst/dev/pm/designer/stakeholder) further muddy the water -- stakeholder is a lens (a viewing mode) AND a role-permission. Two different concepts share the name.

**Operational consequence.** Models like "Sarah is a designer who is also an admin" require workarounds. Vocabulary feels right at the user level ("she's a designer") but the schema can't represent it cleanly.

**Recommended fix.** Strategic call required. Three options:

(A) **Split the field.** `composers.discipline: analyst | dev | pm | designer` + `composers.access_level: member | admin | stakeholder`. Cleanest semantically. Most invasive -- touches all of territories.yaml, BRD ACs that reference roles, and ADR-017 lens vocabulary.

(B) **Keep current model, document the conflation.** Document that `default_role` carries both axes by convention, and the lens model treats them uniformly. Lowest disruption; preserves the smell.

(C) **Rename.** Call the field `profile` or `participant_kind` to acknowledge it's a fuzzy classifier, not a strict role.

**Status:** OPEN. Files as **BRD-OPEN-QUESTIONS section 20** because the right answer depends on stakeholder coordination (territories.yaml owners, ADR-017 lens design).

**Does not block M1.** Current schema works; the conflation is a forward concern. M1 can ship with the existing enum and the resolution lands as a v1.x migration if (A) is chosen.

**Lands as:** BRD-OPEN-QUESTIONS section 20 (this commit).

---

### F13 (informational, no fix needed) -- `kind=proposal` role check is the actual gate

Already covered in F1 rationale -- the role check in ARCH 6.2.1 step 4 is the real authorization. F1's fix removes the `kind=proposal` redundancy. No separate finding.

---

### F14 (LOW) -- `vector_index.source_kind` `brd_section` vs `prd_section` granularity opacity

**Location:** ARCH 5.4 vector index; ARCH 6.4.2 corpus composition.

**Smell.** ARCH 6.4.2 specifies BRD as "one row per BRD story (US-X.Y block)" and PRD as "one row per top-level PRD section". Two different granularities, two different `source_kind` values that imply different shapes. The naming conveys source but obscures the granularity difference.

**Operational consequence.** A consumer iterating the corpus has to special-case the granularity per source_kind.

**Recommended fix.** ARCH 5.4 documentation: add a granularity column to the source_kind table (already partially in ARCH 6.4.2, just cross-reference it from 5.4).

**Lands as:** ARCH 5.4 documentation cross-ref (this commit).

---

### F15 (HIGH, folded with F9) -- `decisions.session_id` dangling FK after session deletion

Same shape as F9. Lands as ADR-036.

---

### F16 (MEDIUM) -- `contributions.trace_ids` non-empty constraint is API-level only, not DB-level

**Location:** ARCH 5.1 contributions; ARCH 6.2.1 validation step 2.

**Smell.** ARCH 6.2.1 step 2 says `trace_ids` is non-empty, validated by the endpoint. But the underlying column has no CHECK constraint -- a direct SQL insert (e.g., a migration script, an admin tool) could insert empty trace_ids. The invariant is enforced only at the API boundary.

**Operational consequence.** Any code path that inserts contributions outside the endpoint (migrations, admin scripts, future direct-write features) must remember to validate trace_ids. Easy to forget.

**Recommended fix.** Add CHECK constraint at the DB level: `cardinality(trace_ids) > 0`. Same constraint on `decisions.trace_ids` (per ADR-021 the same non-empty rule applies).

**Lands as:** ARCH 5.1 schema update + CHECK constraint declared (this commit).

---

### F17 (LOW) -- `locks.expires_at` lifecycle unclear

**Location:** ARCH 5.1 locks; ARCH 6.1 reaper; ARCH 7.4 fencing.

**Smell.** The `expires_at` column exists but the lifecycle around lock expiration is not specified anywhere I read. Are locks auto-released on expiration time? Or is `expires_at` a hint? The reaper releases locks at session-death, not at lock-expiration.

**Operational consequence.** Implementation chooses; choice is unaudited.

**Recommended fix.** ARCH 7.4 documentation: specify that `expires_at` is a soft hint (not auto-enforced); release happens at session-reap, at explicit `release_lock`, or at contribution merge/release. If hard expiration is desired in the future, it's an explicit feature add. Alternative: drop the column if it's unused.

**Lands as:** ARCH 7.4 documentation note (this commit). Column retained (cheap; future-proof).

---

### F18 (HIGH, folded with F9) -- `telemetry.session_id` dangling FK after session deletion

Same shape as F9. Lands as ADR-036.

---

## Findings landing in this commit

| Finding | Severity | Resolution path |
|---|---|---|
| F1, F2 | HIGH, HIGH | ADR-033 (kind enum scoped to output discipline) |
| F4 | HIGH | ADR-034 (state vs blocked separation) |
| F5 | HIGH | ADR-035 (contract metadata expanded) |
| F9, F10, F15, F18 | HIGH, LOW, HIGH, HIGH | ADR-036 (immortal author identity + FK durability) |
| F6, F7 | MEDIUM, MEDIUM | ADR-037 (decisions table cleanup) |
| F11 | HIGH | ARCH 5.1 schema add (no ADR; spec drift) |
| F3, F8, F14, F16, F17 | LOW, LOW, LOW, MEDIUM, LOW | ARCH 5.1 / 5.4 / 7.4 documentation + CHECK constraints |
| F12 | MEDIUM-HIGH | BRD-OPEN-QUESTIONS section 20 (strategic call required) |

---

## What this audit did not cover

The audit scope was the v1 schema and contract surface. Out of scope (and worth future audit):

- **API surface audit** -- the 12 endpoint tools' signatures, error envelopes, idempotency keys, retry semantics. Some of this surfaced incidentally (e.g., `claim` idempotency in ARCH 6.2.1) but a systematic API contract audit would be a separate deliverable.
- **Migration safety audit** -- once M1 schema migrations exist, verify additive-preferred per ARCH 9.7.
- **Adapter contract audit** -- M1.5 ships five non-GitHub adapters (Jira, Linear, Confluence, Notion, Figma). Each adapter's contract surface needs the same five checks applied. METHODOLOGY 11.5 (added in this commit) makes this the standing pattern for all schema-bearing milestones.

---

## Methodology contribution

This audit's process is being codified in METHODOLOGY section 11.5 (data-model + contract audit) so future schema-bearing milestones (M2 endpoint surface, M5 vector index productionization, M7 upgrade tooling) get the same scrutiny pre-implementation, not post-implementation.
