---
id: ADR-033
trace_id: BRD:Epic-2
category: architecture
session: pre-m1-data-model-audit-2026-04-28
composer: nino-chavez
timestamp: 2026-04-28T16:30:00Z
---

# Contribution.kind scoped to output discipline (drop proposal, drop decision)

**Summary.** `contributions.kind` enum reduces from `implementation | decision | research | design | proposal` to `implementation | research | design`. The five-value enum mixed two axes (output discipline + provenance) and contained one unreachable value. The corrected enum carries one axis: what the work produces.

**Rationale.**

Surfaced by `pre-M1-data-model-audit.md` findings F1 and F2.

**F1 -- `proposal` conflated provenance into a discipline enum.** The other four values describe output (implementation -> code; decision -> ADR; research -> artifact; design -> tokens/components). `proposal` describes origin (raised by an outsider to the territory or by triage). The merge-gate this implied is already enforced by the role check at claim time (ARCH 6.2.1 step 4): the calling session's composer must hold a role authorized for the territory; cross-role authoring requires `territories.allow_cross_role_authoring=true`. `kind=proposal` was a denormalized echo of the role-check outcome, not an independent semantic.

After dropping `proposal`:
- A research-discipline change raised by triage is `kind=research` (the work it would produce). The proposal nature is captured by the `author_session_id`'s composer role differing from the territory's `owner_role`.
- Filtering "all research-related contributions" returns research proposals AND owned research uniformly.
- Post-merge, the discipline field accurately describes the merged output.

**F2 -- `decision` was unreachable.** ARCH 6.2.3 specifies decisions flow via `log_decision` directly to the `decisions` table, not through contributions. ARCH 6.2.1 atomic-create accepted `kind=decision` but no specified flow authored against such a contribution. The value was dead enum surface that would mislead implementers.

After dropping `decision`:
- All decisions go through `log_decision` (the authoritative path per ADR-005, ADR-030).
- The contributions table represents implementation/research/design work; decisions are a peer concept in their own table.
- The `kind=decision` atomic-create call returns BAD_REQUEST per the new validation.

**Consequences.**

- ARCH 5.1 `contributions.kind` enum reduces to three values.
- ARCH 6.2.1 validation step 1 ("kind is in the enum") now rejects `proposal` and `decision`.
- ARCH 6.5 triage script (which previously created `kind=proposal` contributions) creates contributions tagged with the discipline of the change being proposed (typically `implementation` or `research` depending on the source). The "this came from triage" signal is preserved via `author_session_id` -> a designated triage system session.
- BRD acceptance criteria referencing `kind=proposal` or `kind=decision` rewrite to use the role-check mechanism.
- `get_context.contributions_kind_weights` per ARCH 6.7 lens defaults drops the `proposal` and `decision` weight entries.
- The merge gate ("cross-role authoring requires explicit human approval") is enforced by the role check + a new explicit `requires_owner_approval` flag on the contribution row, set at create time when the author's role is not the territory's owner_role. Approval recording per ARCH 7.5 reads this flag.

**Migration impact.** Pre-M1 schema -- no migration needed; the enum is corrected before first use. Documentation throughout BRD/ARCH/territories.yaml updated in the same commit as this ADR.

**Trade-off considered and rejected.** Keep `proposal` as a query-convenience denormalization. Rejected: the value would have to be maintained as derived state (compute on insert from role mismatch), and consumers would still need to special-case it (vs. uniform query-by-discipline). The role-check + `requires_owner_approval` flag carries the same information without the enum-overload cost.
