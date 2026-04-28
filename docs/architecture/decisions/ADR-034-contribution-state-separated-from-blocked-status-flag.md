---
id: ADR-034
trace_id: BRD:Epic-2
category: architecture
session: pre-m1-data-model-audit-2026-04-28
composer: nino-chavez
timestamp: 2026-04-28T16:35:00Z
---

# Contribution lifecycle state separated from blocked status flag

**Summary.** `contributions.state` enum reduces from `open | claimed | in_progress | review | merged | rejected | blocked` to `open | claimed | in_progress | review | merged | rejected`. The blocked condition is represented by the existing `blocked_by` column being non-null. A contribution is blocked iff `blocked_by IS NOT NULL`, regardless of lifecycle position.

**Rationale.**

Surfaced by `pre-M1-data-model-audit.md` finding F4.

The seven-value `state` enum mixed two orthogonal axes:
- **Lifecycle position** (open / claimed / in_progress / review / merged / rejected) -- where in the flow.
- **Status flag** (blocked) -- whether progress is paused.

A contribution can be claimed-but-blocked or in_progress-but-blocked or even review-but-blocked (review held pending external dependency). The single `state` field could only carry one of "blocked" or the lifecycle position; the truth was both.

The schema already had a separate `blocked_by` column, suggesting someone recognized blocked needed extra metadata. The split was half-done.

**Operational consequences of the conflation (pre-fix):**
- Querying "what's actively in flight?" with `state IN ('claimed', 'in_progress')` missed blocked work that should still surface as in-flight (just paused).
- Querying "what's stuck?" with `state='blocked'` lost the prior lifecycle position -- you couldn't tell whether the contribution was blocked during claim or during in_progress.
- A contribution unblocked from blocked had ambiguous return state -- back to claimed? in_progress? Spec didn't say.

**Decision.**

- `state` enum: `open | claimed | in_progress | review | merged | rejected` (six values, pure lifecycle).
- `blocked_by` (existing column, FK nullable to contributions) -- when non-null, this contribution is blocked on the named contribution. Lifecycle position is preserved in `state`.
- Add `blocked_reason` (text, nullable) -- captures the human-readable reason (e.g., "waiting on auth contract from the protocol territory"). Optional but encouraged.
- A contribution unblocks by setting `blocked_by=NULL` and (optionally) `blocked_reason=NULL`. Lifecycle position does not change on unblock -- the contribution resumes from where it paused.
- The `update` operation per ARCH 6.2.2 accepts `blocked_by` and `blocked_reason` as separate parameters; setting `blocked_by` to a non-null value is permitted from any active state (claimed / in_progress / review).

**Consequences.**

- ARCH 5.1 contributions schema updated.
- ARCH 6.2.2 update operation signature drops `state="blocked"` as a value; gains explicit `blocked_by` and `blocked_reason` parameters.
- ARCH 6.7 `get_context.contributions_summary.by_state` no longer reports a `blocked` count; instead reports `blocked_count` as a separate field (count where blocked_by IS NOT NULL across all active states).
- BRD acceptance criteria mentioning state=blocked rewrite to "blocked_by IS NOT NULL".
- /atelier dashboard renders blocked contributions with both their lifecycle position and the blocked indicator (e.g., a "claimed (blocked)" pill).

**Migration impact.** Pre-M1 schema -- no migration needed; the schema is corrected before first use.

**Trade-off considered and rejected.** Keep `blocked` as a state, treat blocked_by as informational. Rejected: every consumer would need to special-case the blocked state to surface the underlying lifecycle position, which is the actual operational concern. The split is the cleaner primitive.
