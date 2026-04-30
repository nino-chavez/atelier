---
last_updated: 2026-04-30
status: surfaced; awaiting architect approval before HIGH items land as ADRs / migration 4 + spec edits
audit_kind: data-model + contract
applies_to: ARCH section 5.1 (composers, sessions, locks, contracts, telemetry, contributions, territories), 5.3 (Authorization), 6.2.1.7 (plan-review gate), 6.2.2 (Update operation), 6.2.4 (Release), 6.6 (Contract flow), 6.7 (get_context), 6.8 (Broadcast topology), 7.4 (Fencing), 7.9 (Web-surface auth), ADR-013 (12-tool surface), ADR-039 (plan-review state)
---

# M2-entry data-model + contract audit

**Audit run:** 2026-04-30
**Auditor:** architect role (manual; `atelier audit --milestone-entry` is M7 work per BUILD-SEQUENCE Epic 1)
**Milestone gate:** M2 entry
**Per:** METHODOLOGY 11.5; worked example precedent at `pre-M1-data-model-audit.md`

---

## Why this audit exists

M1 landed the schema (composers, sessions, locks, contracts, telemetry, contributions, decisions, territories, projects, delivery_sync_state) under service_role. M2 is the milestone where these tables gain endpoint surfaces — `register`/`heartbeat`/`deregister` write to `sessions`; `acquire_lock`/`release_lock` write to `locks`; the as-yet-unnamed contracts tool writes to `contracts`; OAuth-validated bearer tokens map JWT `sub` claims to `composers.id` (per ARCH 7.9). Plus ADR-039 (accepted 2026-04-30 just before this M2-entry sweep) extends `contributions` and `territories` with the plan-review gate.

Per METHODOLOGY 11.5, schema-bearing milestones get a data-model + contract audit at entry, not exit, because encoded schema is materially harder to refactor than spec'd schema. M1 schema as it stands is correct for M1's substrate-only scope. M2 will re-encode parts of the schema (additive migration) and introduce wire-format contracts (the 12-tool surface). This audit catches gaps in both before implementation begins.

The five checks (per METHODOLOGY 11.5):

1. **Field semantic atomicity** — each column carries exactly one classification axis
2. **Derivable vs stored** — denormalizations are intentional and documented
3. **Enum coherence** — every enum's values share one classification axis; no dead values, no smuggled axes
4. **Constraint surface** — CHECK / FK / NOT NULL / transition rules are specified and DB-enforced where feasible
5. **Lifecycle invariants** — per-field mutability, permitted state transitions, FK durability across row deletions

---

## Tables / surfaces in scope (explicit per METHODOLOGY 11.5 process correction)

Following the supplemental-sweep correction folded into METHODOLOGY 11.5 after the pre-M1 audit, scope is enumerated explicitly:

| Surface | Why in scope at M2 | Coverage |
|---|---|---|
| `composers` | OAuth JWT mapping at M2 (ARCH 7.9); spec calls for `identity_subject` column | full |
| `sessions` | register/heartbeat/deregister become endpoint-driven at M2 (ARCH 6.1) | full |
| `locks` | acquire_lock/release_lock are 2 of the 12 tools; glob-expansion lands at M2 (ARCH 7.4.1) | full |
| `contracts` | the contracts tool is 1 of the 12 tools; classifier surface (ADR-035) gets endpoint validation | full |
| `telemetry` | endpoint becomes write surface for all 12 tools' actions; ADR-039 adds 3 actions | full |
| `contributions` (ADR-039 additions) | `plan_review_approved_*` columns + `plan_review` state value | full |
| `territories` (ADR-039 additions) | `requires_plan_review` column | full |
| **The 12-tool wire-format contract (per ADR-013)** | locked at v1; M2 implements; surface drift surfaced | full |

Out of scope at this audit (deferred with justification):

| Surface | Why deferred |
|---|---|
| `decisions` table | M1-stable; append-only invariant working as spec'd; no M2 surface change |
| `projects` table | M1-stable; counters work; no M2 surface change |
| `delivery_sync_state` table | M1.5 work re-enters this surface (per-adapter contracts) |
| Vector index schema (ARCH 5.4) | M5 entry per BUILD-SEQUENCE; D24 still open |
| RLS policies tied to JWT claims | M2 endpoint hardening (post-this-audit-resolution); follows from `composers.identity_subject` landing first |

---

## Findings index

10 findings: 3 HIGH, 6 MEDIUM, 1 LOW. Each row points at the recommended landing surface.

| # | Severity | Smell (one-line) | Recommended landing |
|---|---|---|---|
| H1 | HIGH | `composers.identity_subject` referenced by ARCH 7.9 but absent from M1 schema; M2 endpoint cannot map JWTs to composers without it | Migration 4 (additive); spec-vs-schema drift, no ADR |
| H2 | HIGH | ADR-013 12-tool list is internally inconsistent (declares 12, lists 13 if `publish_contract+get_contracts` are separate tools) AND drifts from M2-entry brief which names `propose_contract_change` as the 12th tool | New ADR (proposed: ADR-040) consolidating the contracts surface + recording the rename; README vocabulary table extension |
| H3 | HIGH | Release from `state=in_progress` (post-plan-approval) does not clear `plan_review_approved_*`; a re-claim would inherit prior approval, corrupting audit trail. ADR-039 says columns reset on new claim but neither schema nor existing release SQL enforces it | M2 write library: extend `release()` SQL to clear plan_review_approved_*; (and atomic-claim path resets them on insert by default since column default is NULL) |
| M1 | MEDIUM | `contributions.plan_review_approved_*` pair lacks "both NULL or both populated" CHECK constraint; G2 has the analogous constraint for `approved_*` pair | Migration 4 (CHECK constraint) |
| M2 | MEDIUM | `contributions.plan_review_approved_by_composer_id <> author_composer_id` CHECK missing; existing `contributions_no_self_approval` is the analogous constraint for `approved_by_composer_id` | Migration 4 (CHECK constraint) |
| M3 | MEDIUM | `locks.lock_type='shared'` is a dead enum value: no spec semantics in ARCH 7.4 / 7.4.1, conflict detection treats all locks identically (`&&` overlap regardless of type). Same F2-pattern unreachable enum value as ADR-033 | Either ARCH 7.4 specifies shared semantics + write lib updates, OR migration 4 drops the value via enum collapse. Recommend **drop** unless shared-lock use case named |
| M4 | MEDIUM | `territories.contracts_consumed` referenced by ARCH 6.7.3 + the get_context ContextResponse shape (ARCH 6.7) but absent from M1 schema | Migration 4 (additive `text[]` column) OR ARCH 6.7.3 / 6.7 ContextResponse rewrites against an alternative mechanism. Recommend the column — schema is the simpler fit |
| M5 | MEDIUM | ARCH 6.7.3 still references `composers.default_role` (renamed by ADR-038 to `composers.discipline + composers.access_level`); spec drift introduced by ADR-038 commit not swept | ARCH 6.7.3 text edit (this commit batch) |
| M6 | MEDIUM | "Proposal contribution" terminology persists in ARCH 6.5 / 6.6 / 7.5 after ADR-033 dropped `kind=proposal`; M2 contracts implementation following ARCH 6.6 will read "create a proposal contribution" as a removed kind | ARCH 6.5 / 6.6 / 7.5 text edits replacing "proposal contribution" with "contribution with kind matching discipline + requires_owner_approval=true" |
| L1 | LOW | `composers` lacks a CHECK that an `active` composer has at least one auth path: either `token_hash` (static API token) or `identity_subject` (OAuth/dynamic). Schema currently permits an active composer with neither, which is impossible per ARCH 7.9 | Migration 4 (CHECK constraint, lands with H1 column) |

---

## Detailed findings

### H1 — `composers.identity_subject` missing (HIGH; check 5: lifecycle invariants + check 4: constraint surface)

**Smell.** ARCH 7.9 line 1487:

> The JWT `sub` claim resolves to `composers.id` via a join on `composers.identity_subject` (added at M2 with the `composers` table).

The "added at M2" framing matches ARCH 5.1's general posture that some columns land with the M2 endpoint, not M1. But the M1 migration (`20260428000001_atelier_m1_schema.sql`) ships `composers` without this column. M2 endpoint code that follows ARCH 7.9 will fail at the JOIN because the column does not exist.

**Diagnosis.** Spec-vs-schema drift, F11-style. The fix is mechanical: add the column in migration 4 (additive). No ADR needed; this is the spec-prescribed shape that simply needs to land.

**Open design questions to resolve before the migration writes the constraint:**

1. **Uniqueness.** `identity_subject` is the JWT `sub` claim — globally unique within an identity provider. Should the constraint be UNIQUE per project (matching the email constraint from G3) or UNIQUE globally? Recommendation: UNIQUE(project_id, identity_subject), matching the email pattern. A composer in two projects has two separate `composers` rows (one per project per ADR-015), each with the same `identity_subject` value. This is consistent with how the identity provider models it.

2. **Nullability.** Can a composer exist without an `identity_subject`? Per ARCH 7.9 "two paths, one scheme" — both static API tokens and OAuth flows produce JWTs from the identity provider, so `identity_subject` should always be present for an active composer. But during the invite flow (`atelier invite <email>`), the row is created before the user has accepted the invite and has not yet obtained a JWT. Recommendation: nullable on the column itself, with a CHECK that ties presence to `status='active'` (see L1 below).

**Recommended fix.** Migration 4 adds:

```sql
ALTER TABLE composers
  ADD COLUMN identity_subject text,
  ADD CONSTRAINT composers_project_identity_subject_uniq
    UNIQUE (project_id, identity_subject);
```

Plus the CHECK from L1 below.

**Severity rationale.** HIGH because M2 endpoint OAuth path is structurally broken without this column; not optional, not deferrable.

---

### H2 — 12-tool surface internally inconsistent + drifts from M2 brief (HIGH; check 3: enum coherence)

**Smell.** ADR-013 body line 12:

> The agent-facing endpoint exposes exactly 12 tools at v1: register, heartbeat, deregister, get_context, fit_check, claim, update, release, acquire_lock, release_lock, log_decision, publish_contract+get_contracts.

If `publish_contract+get_contracts` is one combined tool, the count is 12. If they are separate (as BRD US-2.6 reads them — "I want `publish_contract` and `get_contracts`"), the count is 13. ADR-013's text declares "exactly 12" but the explicit list reads as 13.

The README index has applied the `fit_check → find_similar` rename (per the vocabulary table on README lines 67) to the truncated index entry but ADR-013's body retains `fit_check` per append-only convention. No vocabulary entry exists for `publish_contract+get_contracts` → anything else.

The M2-entry brief (the prompt that opened this session) names the 12th tool as `propose_contract_change`:

> Per ADR-013, exactly 12 tools at v1: register, heartbeat, deregister, get_context, find_similar, claim, update, release, log_decision, acquire_lock, release_lock, propose_contract_change.

That list is 12. It implies `publish_contract` + `get_contracts` collapsed into a single `propose_contract_change` tool (matching ARCH 6.6's reality that all contract publishes go through the proposal flow when breaking; additive publishes can also flow through the same proposal mechanism with the classifier returning "additive").

**Diagnosis.** Three drifts in one place:

1. ADR-013's count vs list inconsistency (12 declared, 13 listed).
2. The contracts tool naming has shifted from "publish + get" to "propose change" (with `get_contracts` either folded into `get_context` OR dropped, OR retained as a 13th tool the brief didn't mention).
3. The vocabulary-rename table in README has not recorded this shift, breaking the discipline established for the `fit_check → find_similar` rename.

**Pre-M2 strategic call needed.** Three resolution paths, each defensible:

**Path A (recommended): consolidate to `propose_contract_change`; fold `get_contracts` into `get_context`.** ARCH 6.7's ContextResponse already returns `territories.consumed[].contracts_consumed`. Returning the actual contract bodies under `get_context` (same call, deeper response when `lens=designer` or `lens=dev`) eliminates `get_contracts` as a separate tool. The 12-tool list becomes the M2 brief's list. Update ADR-013 vocabulary-rename table; new ADR records the surface consolidation; ARCH 6.6 + 6.7 update accordingly.

**Path B: retain `publish_contract` + `get_contracts` as 2 separate tools; ADR-013's "12" was a count error and the actual surface is 13.** Defensible if the team values keeping the contracts publish/read paths distinct. Requires ADR-013 reversal (per ADR-030 append-only) declaring the count 13. Bumps the protocol version.

**Path C: retain `publish_contract`; drop `get_contracts` (consume contracts via `get_context` only).** Hybrid of A and B; the contracts publish action keeps its old name, but the read surface consolidates. Surface is 12 tools; the rename in vocabulary table is `publish_contract` → `publish_contract` (no change) plus a "removed: get_contracts (folded into get_context)" note.

**Recommended fix.** Path A. New ADR (ADR-040) recording:
- The contracts tool is `propose_contract_change(name, schema, override_classification?, override_justification?)`
- `get_contracts` is removed; consumers read via `get_context` (which already returns `territories.consumed[].contracts_consumed`; ContextResponse extended at M2 to return contract bodies, not just names, when the requesting lens or kind_filter requests them).
- The 12-tool list is locked at the M2-brief shape: register, heartbeat, deregister, get_context, find_similar, claim, update, release, log_decision, acquire_lock, release_lock, propose_contract_change.

ADR-013 stays append-only; the rename + consolidation lands in ADR-040 and the README vocabulary table gets a new row.

**Severity rationale.** HIGH because M2 cannot ship the endpoint surface without resolving the count and naming; this is the wire-format contract for v1 that's locked per ADR-013.

---

### H3 — `release` does not clear `plan_review_approved_*` (HIGH; check 5: lifecycle invariants)

**Smell.** ARCH 6.2.4 release semantics:

> `contributions.state -> open`, `contributions.author_session_id -> null`.

The current write library implementation (`scripts/sync/lib/write.ts:608-615`):

```typescript
UPDATE contributions
   SET state = 'open',
       author_session_id = NULL,
       author_composer_id = NULL,
       updated_at = now()
 WHERE id = $1
```

ADR-039's prose under "Release behavior at plan_review" addresses release **from plan_review**: state→open, plan body preserved, columns reset. But ADR-039 also says: "the new claim path resets state=open and erases `plan_review_approved_*` columns".

The gap: a contribution that passes through plan_review **and reaches in_progress** (so `plan_review_approved_by_composer_id` is populated) and is THEN released (per ARCH 6.2.4, release is permitted from state=claimed or state=in_progress) returns to state=open with `plan_review_approved_*` STILL POPULATED. A subsequent claim of this open row inherits the prior reviewer's approval — even though that approval was for a prior author's plan.

**Diagnosis.** Lifecycle-invariant gap. ADR-039 specifies the intended behavior in prose ("new claim path resets") but neither schema nor existing release SQL enforces it.

**Resolution surface options:**

1. **Application-level clear in release().** Extend the write library's release UPDATE to set `plan_review_approved_by_composer_id = NULL, plan_review_approved_at = NULL`. Same posture as how author_*_composer_id is cleared today.

2. **DB-level constraint tying state to plan_review_approved_***. Tempting but breaks because once a contribution is in_progress (state-wise), the plan_review_approved_* columns SHOULD be populated (audit-trail value). So the constraint cannot be "state IN ('open','claimed') => columns NULL" — that would invalidate the merged row's audit history.

3. **Trigger on state transition to 'open'.** A BEFORE-UPDATE trigger that sets plan_review_approved_* to NULL when the new state is 'open'. This works at the DB layer regardless of whether the call comes through the write library or service_role. Marginally more robust than (1).

**Recommended fix.** Option 1 — extend write library `release()` (and the M2 endpoint extension that calls it) to clear `plan_review_approved_*` on transition to state=open. Option 3 (trigger) is over-engineering for a service-role-controlled write surface.

Add a smoke test asserting: claim → plan_review → in_progress (approved) → release → re-claim → assert `plan_review_approved_by_composer_id IS NULL` and `plan_review_approved_at IS NULL` on the re-claimed row. This locks the invariant in the test suite.

**Severity rationale.** HIGH because ADR-039 names the invariant load-bearing for audit trail integrity ("an auditor reading the canonical state for a contribution that passed through plan_review sees: who approved, when they approved"). Inheriting prior reviewer's approval on a re-claim corrupts that primitive.

---

### M1 — Missing pair CHECK on `plan_review_approved_*` (MEDIUM; check 4: constraint surface)

**Smell.** ADR-039 specifies the pair: `plan_review_approved_by_composer_id` and `plan_review_approved_at` populate together (on plan approval) or remain NULL (rejection or never engaged). The existing G2 audit added the analogous constraint for `approved_by_composer_id` / `approved_at`:

```sql
CONSTRAINT contributions_approval_pair CHECK (
  (approved_by_composer_id IS NULL  AND approved_at IS NULL)
  OR (approved_by_composer_id IS NOT NULL AND approved_at IS NOT NULL)
)
```

No analog for `plan_review_approved_*` is in the M1 schema (correctly — ADR-039 hadn't landed). Migration 4 should add it.

**Recommended fix.** Migration 4:

```sql
ALTER TABLE contributions
  ADD CONSTRAINT contributions_plan_review_approval_pair CHECK (
    (plan_review_approved_by_composer_id IS NULL  AND plan_review_approved_at IS NULL)
    OR (plan_review_approved_by_composer_id IS NOT NULL AND plan_review_approved_at IS NOT NULL)
  );
```

---

### M2 — Missing self-approval CHECK on `plan_review_approved_by_composer_id` (MEDIUM; check 4: constraint surface)

**Smell.** ARCH 6.2.1.7 reviewer-approval validation: "Calling session's composer is NOT the contribution's `author_composer_id` (self-approval blocked, same as the audit-G2 owner-approval rule)."

Existing constraint for the analogous owner-approval surface:

```sql
CONSTRAINT contributions_no_self_approval CHECK (
  approved_by_composer_id IS NULL
  OR approved_by_composer_id <> author_composer_id
)
```

No analog for plan_review_approved_by_composer_id is in M1 schema. Migration 4 should add it.

**Recommended fix.** Migration 4:

```sql
ALTER TABLE contributions
  ADD CONSTRAINT contributions_no_plan_review_self_approval CHECK (
    plan_review_approved_by_composer_id IS NULL
    OR plan_review_approved_by_composer_id <> author_composer_id
  );
```

---

### M3 — `locks.lock_type='shared'` is a dead enum value (MEDIUM; check 3: enum coherence)

**Smell.** Schema:

```sql
CREATE TYPE lock_kind AS ENUM ('exclusive', 'shared');
...
locks.lock_type lock_kind NOT NULL DEFAULT 'exclusive'
```

ARCH 7.4 / 7.4.1 specifies fencing, glob semantics, multi-lock per contribution, overlap detection, expansion limits. Nowhere does it specify shared-lock semantics — what differentiates a shared lock from an exclusive one operationally, and how overlap detection treats two shared locks against the same scope.

The write library (`scripts/sync/lib/write.ts:660-674`) implements overlap detection as Postgres array intersection (`&&`) with no `lock_type` filter. Two shared locks against the same scope would conflict under this code path, identical to two exclusives. The 'shared' value carries no behavioral meaning today.

This is the same F2 / ADR-033 pattern: an enum value that exists in schema but is unreachable in practice, smuggling a second axis (lock semantics) into a structure (lock_type) that doesn't actually carry it.

**Resolution surface options:**

1. **Drop 'shared'.** Migration 4 alters the enum to a single value, OR replaces the column with a boolean / drops it entirely (no consumer reads it). The cleanest fix per the F2 / ADR-033 pattern.

2. **Spec shared-lock semantics.** ARCH 7.4 gains a "shared lock" subsection: shared locks against the same scope do not conflict; a shared and an exclusive against the same scope do conflict; the conflict-detection SQL gets a `lock_type` filter. Justifies the value's continued presence.

3. **Keep as future extension hook.** Drop in M2; restore at v1.x if shared-lock use case named. Per ADR-011 (destination-first), this is exactly the "v1 reserves config, v1.x flips functional" pattern that's prohibited. Reject this option.

**Recommended fix.** Option 1 (drop). Per discipline-tax meta-finding and ADR-033's reasoning: a dead enum value has documentation cost without behavioral payoff. If the team later identifies a shared-lock use case, the additive path back is straightforward (CREATE TYPE + ALTER TABLE). Migration 4:

```sql
ALTER TYPE lock_kind RENAME TO lock_kind_old;
CREATE TYPE lock_kind AS ENUM ('exclusive');  -- or just drop the column entirely
ALTER TABLE locks ALTER COLUMN lock_type TYPE lock_kind USING lock_type::text::lock_kind;
DROP TYPE lock_kind_old;
```

OR drop the column entirely (`ALTER TABLE locks DROP COLUMN lock_type`) since no consumer reads it. Recommendation: **drop the column entirely** — the cleanest possible fix for an unreachable enum value.

---

### M4 — `territories.contracts_consumed` missing (MEDIUM; check 4: constraint surface; spec drift)

**Smell.** ARCH 6.7.3 line 1244:

> `territories.owned` and `territories.consumed` are computed from `composers.default_role` joined against `territories.owner_role` / `territories.contracts_consumed`.

ARCH 6.7's ContextResponse shape line 1201:

> consumed: [ { name, contracts_consumed }, ... ]   // composer's role reads contracts from

The M1 schema (migration 1) defines `territories` with `name, owner_role, review_role, scope_kind, scope_pattern` — no `contracts_consumed` column. The get_context implementation cannot compute the `consumed` surface without this field.

**Diagnosis.** Spec-vs-schema drift, F11-style. The spec assumes the column; M1 didn't ship it (correctly — get_context lands at M2).

**Recommended fix.** Migration 4:

```sql
ALTER TABLE territories
  ADD COLUMN contracts_consumed text[] NOT NULL DEFAULT '{}'::text[];
```

The array holds contract `name` values that this territory subscribes to. The get_context flow joins `territories.contracts_consumed` against `contracts.name` (scoped to the project) to return the consumed-contracts surface. Empty array (default) means the territory consumes no contracts.

Note: also surfaces M5 (next finding) — the spec line that introduced this drift also references `composers.default_role` which is the post-ADR-038 stale name.

---

### M5 — ARCH 6.7.3 references `composers.default_role` after ADR-038 split (MEDIUM; check 4: constraint surface; spec consistency)

**Smell.** ARCH 6.7.3 line 1244:

> ...computed from `composers.default_role` joined against `territories.owner_role` / `territories.contracts_consumed`.

ADR-038 split `composers.default_role` into `composers.discipline + composers.access_level` (with `architect` added to the discipline enum). Migration 1 implements this correctly. ARCH 5.1's `composers` block lists `discipline` and `access_level`. ARCH 6.7.3 was not swept at ADR-038 commit.

**Diagnosis.** Spec drift not previously caught.

**Recommended fix.** ARCH 6.7.3 text edit (this commit batch):

> ...computed from `composers.discipline` joined against `territories.owner_role` / `territories.contracts_consumed`.

Lands as documentation tightening alongside this audit doc.

---

### M6 — "Proposal contribution" terminology drift in ARCH 6.5 / 6.6 / 7.5 (MEDIUM; check 3: enum coherence; cross-doc consistency)

**Smell.** Multiple ARCH passages still refer to "proposal contributions" after ADR-033 dropped `kind=proposal`:

- Line 38 (intro): "Triage external comments into proposal contributions that require human merge" — intro-level, less load-bearing.
- Line 968 (sync substrate, triage flow): "**triage** (external comments → proposal contributions)" — but the flow body at line 976 was correctly updated: "Creates contribution with kind matching the change's discipline (implementation/research/design), author_session_id pointing at the triage-system session, requires_owner_approval=true (per ADR-033)". So the header is stale, the body is correct.
- Line 1006 (Figma triage drafted-proposal content shape): mixed; refers to "the proposal contribution's `content_ref`" but the surrounding text describes a contribution with auto-set fields, no longer keyed on kind=proposal.
- Line 1036 (contracts flow): "If breaking: Create a proposal contribution requiring cross-territory approval" — this is the contracts publish flow that M2 implements. Reading literally, an M2 implementer would look up `kind=proposal` and find it doesn't exist. Operational drift.
- Line 1057 (contracts override): "...by escalating to a proposal contribution." Same drift pattern.
- Line 1419 (triage sandboxing security section): "External comments classified + drafted into proposal contributions." Stale header.

**Diagnosis.** Terminological drift. The structural fix from ADR-033 (kind enum reduction + requires_owner_approval gate) was applied to the schema and to the triage flow body (line 976) but not propagated through the spec narrative. M2 implementation that follows ARCH 6.6 verbatim will encounter "create a proposal contribution" with no clear mapping to the surviving primitives.

**Recommended fix.** ARCH text edits (this commit batch):

- Replace "proposal contribution" with "contribution with `kind` matching the change's discipline and `requires_owner_approval=true`" wherever it occurs in operational paths (lines 968 header, 1036, 1057, 1419 if load-bearing). The intro-level reference at line 38 can stay since it's prose-level.
- For Figma triage at line 1006, rephrase the section header from "Drafted proposal content shape" to "Drafted contribution content shape (Figma-sourced)" and adjust the prose accordingly.

ARCH 6.5 line 976 stays as-is (already correct).

---

### L1 — `composers` lacks "active composer has at least one auth path" CHECK (LOW; check 4: constraint surface)

**Smell.** Per ARCH 7.9, an active composer needs at least one of:
- `token_hash` (static API token path)
- `identity_subject` (OAuth dynamic path)

After H1 lands, the schema will have both columns. Without a CHECK, the schema permits an `active` composer with neither — operationally caught by `atelier invite` tooling, but DB-level backstop is missing.

**Recommended fix.** Migration 4 (lands with H1):

```sql
ALTER TABLE composers
  ADD CONSTRAINT composers_active_has_auth_path CHECK (
    status <> 'active'
    OR token_hash IS NOT NULL
    OR identity_subject IS NOT NULL
  );
```

The constraint is conditional on `status='active'`. Suspended or removed composers may have neither (legitimate — invitation lifecycle states).

**Severity rationale.** LOW because the operational tooling is expected to maintain the invariant; the DB-level check is defense-in-depth.

---

## Proposed migration 4 shape (for architect review)

Combining all HIGH and MEDIUM findings that resolve via DDL:

```sql
-- Atelier M2-entry schema additions
--
-- Trace:
--   BRD: Epic-2 (M2 endpoint surface), Epic-4 (lifecycle states)
--   ADR-013 (12-tool surface) [pending ADR-040 resolution per H2]
--   ADR-039 (plan-review state)
--   Audits: docs/architecture/audits/M2-entry-data-model-audit.md (H1, H3, M1, M2, M3, M4, L1)
--
-- Out of scope (lands separately):
--   - RLS policies tied to JWT claims (M2 endpoint hardening; follows once H1 column lands and the auth path is exercised)
--   - Vector index / embeddings (M5 entry)
--
-- Append-only baseline preserved: this migration only ALTERs in additive
-- shapes (ADD COLUMN, ADD CONSTRAINT, ADD VALUE for the enum). The decisions
-- table append-only triggers from migration 1 are not touched.

-- =========================================================================
-- H1 + L1: composers.identity_subject for OAuth JWT mapping (ARCH 7.9)
-- =========================================================================

ALTER TABLE composers
  ADD COLUMN identity_subject text;

ALTER TABLE composers
  ADD CONSTRAINT composers_project_identity_subject_uniq
    UNIQUE (project_id, identity_subject);

ALTER TABLE composers
  ADD CONSTRAINT composers_active_has_auth_path CHECK (
    status <> 'active'
    OR token_hash IS NOT NULL
    OR identity_subject IS NOT NULL
  );

COMMENT ON COLUMN composers.identity_subject IS 'ARCH 7.9: JWT sub claim from identity provider; UNIQUE per project per ADR-015';

-- =========================================================================
-- M3: drop locks.lock_type entirely (dead enum value 'shared'; only
-- 'exclusive' is used)
-- =========================================================================

ALTER TABLE locks DROP COLUMN lock_type;
DROP TYPE lock_kind;

-- =========================================================================
-- M4: territories.contracts_consumed (ARCH 6.7.3, ARCH 6.7 ContextResponse)
-- =========================================================================

ALTER TABLE territories
  ADD COLUMN contracts_consumed text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN territories.contracts_consumed IS 'ARCH 6.7.3: contract names this territory subscribes to; joined against contracts.name within project_id at get_context time';

-- =========================================================================
-- ADR-039: plan-review state + columns + territory opt-in
-- =========================================================================

-- Additive enum value (PostgreSQL: ALTER TYPE ADD VALUE is a single
-- non-transactional operation; safe to run as a top-level migration step)
ALTER TYPE contribution_state ADD VALUE 'plan_review' BEFORE 'in_progress';

ALTER TABLE contributions
  ADD COLUMN plan_review_approved_by_composer_id uuid REFERENCES composers(id),
  ADD COLUMN plan_review_approved_at timestamptz;

-- M1: pair CHECK
ALTER TABLE contributions
  ADD CONSTRAINT contributions_plan_review_approval_pair CHECK (
    (plan_review_approved_by_composer_id IS NULL  AND plan_review_approved_at IS NULL)
    OR (plan_review_approved_by_composer_id IS NOT NULL AND plan_review_approved_at IS NOT NULL)
  );

-- M2: self-approval blocked CHECK
ALTER TABLE contributions
  ADD CONSTRAINT contributions_no_plan_review_self_approval CHECK (
    plan_review_approved_by_composer_id IS NULL
    OR plan_review_approved_by_composer_id <> author_composer_id
  );

ALTER TABLE territories
  ADD COLUMN requires_plan_review boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contributions.plan_review_approved_by_composer_id IS 'ADR-039: immortal identity of the plan-reviewer; populated only when plan was approved (NOT on rejection); cleared on release back to state=open per ARCH 6.2.4 + ADR-039';
COMMENT ON COLUMN contributions.plan_review_approved_at IS 'ADR-039: timestamp of plan approval';
COMMENT ON COLUMN territories.requires_plan_review IS 'ADR-039: per-territory opt-in for plan-review gate; default false';
```

H2 (12-tool surface drift) does not land in migration 4 — it lands as ADR-040 + ARCH text + README vocabulary table edits, all spec-level, before M2 endpoint code starts. H3 (release clears plan_review_approved_*) lands in the M2 write library extension, not the migration; the smoke suite locks the invariant.

M5 (ARCH 6.7.3 stale `default_role` reference) and M6 (proposal-contribution terminology) land as ARCH text edits in the same commit batch.

---

## What this audit did not cover

Per the explicit-scope-enumeration rule from METHODOLOGY 11.5:

- **Per-tool wire format** (request / response / error envelope shapes for each of the 12 tools). The 12-tool list is in scope (H2); the per-tool shapes are an API contract surface that warrants its own audit at the moment the endpoint code is being written. Filed as M2-mid follow-up if drift surfaces.
- **OAuth flow specifics** (scope claims, audience binding, refresh-token cadence). ARCH 7.9 specifies the high-level shape; the M2 endpoint implementation will exercise the details and surface gaps as it goes.
- **ADR-013's exclusions list** (which capabilities are NOT tools — e.g., `notify`, `subscribe_broadcast`). Out of scope at M2 entry; the post-M4 broadcast substrate may reopen this.
- **Migration safety** (additive-preferred per ARCH 9.7). All proposed migration 4 changes are additive (ADD COLUMN, ADD CONSTRAINT, ADD VALUE) or drop a dead column (M3 lock_type). No data migration required. Verified at migration apply time.

---

## Sign-off

This audit identifies 3 HIGH (H1 schema gap, H2 surface drift, H3 lifecycle invariant), 6 MEDIUM (M1-M6), and 1 LOW (L1) findings. HIGH items resolve via:

- **H1** + **L1**: migration 4 (additive); no ADR (spec-vs-schema drift)
- **H2**: new ADR-040 (12-tool surface consolidation) + ARCH 6.6 / 6.7 text + README vocabulary table; before M2 endpoint code starts
- **H3**: M2 write library extension; smoke test locks invariant

MEDIUM items resolve via migration 4 DDL (M1, M2, M3, M4) or ARCH text edits (M5, M6). LOW item (L1) lands with H1 in migration 4.

**Architect approval pending.** Per the M2-entry instruction: "Show me the METHODOLOGY 11.5 audit findings before applying migration 4. After my approval on the audit + migration shape, execute end-to-end through step 5."

---

## Appendix A: tables in scope but with no findings

For audit traceability, these were checked under all five checks and produce no findings at this milestone gate:

- **`telemetry`**: ADR-039 introduces three new actions (`contribution.plan_submitted`, `contribution.plan_approved`, `contribution.plan_rejected`). The action column is free-form text per ARCH 8.1; no schema enforcement. The new actions slot in cleanly with the existing `contribution.*` naming family. Atomicity OK; constraint surface unchanged; lifecycle invariants unchanged.
- **`sessions`** (M2 endpoint surface gain): G4 documented active|idle|dead transitions; G5 documented agent_client opacity; F18 closed via ADR-036. All fields atomic; no derivable-vs-stored issues; enum coherence OK.
- **`contracts`** (M2 endpoint surface gain): F5 / ADR-035 closed the classifier-surface gap; effective_decision is GENERATED (correct denormalization); override_decision pair-constrained. Schema is M2-ready.

---

## Appendix B: confirming ADR-039 schema additions don't conflict with existing constraints

ADR-039 adds:
1. `contribution_state` enum: `plan_review` value between `claimed` and `in_progress`
2. `contributions.plan_review_approved_by_composer_id` (fk composers nullable)
3. `contributions.plan_review_approved_at` (timestamptz nullable)
4. `territories.requires_plan_review` (bool default false)

Existing constraints potentially affected:
- `contributions_author_when_claimed` CHECK: `state = 'open' OR author_composer_id IS NOT NULL`. Plan_review state requires author_composer_id (per ARCH 6.2.1.7 only the author may submit). The constraint already covers it (plan_review is not 'open', so author_composer_id must be NOT NULL). OK.
- `contributions.author_session_id` FK: nullable, ON DELETE SET NULL. Plan_review entries hold the author's session; if the session is reaped, author_session_id becomes NULL and the contribution returns to state=open via the reaper. This is consistent with the rest of the lifecycle. OK.
- `contributions_no_self_approval` CHECK on `approved_by_composer_id`: orthogonal to plan_review_approved_*. OK.
- `contributions.requires_owner_approval`: orthogonal — that flag gates the merge transition (per ARCH 7.5), which happens AFTER plan_review (which gates the in_progress transition). Both can coexist on the same contribution. OK.

No conflicts. The migration is additive-only with respect to existing M1 invariants.
