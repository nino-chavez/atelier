---
id: ADR-037
trace_id: BRD:Epic-4
category: architecture
session: pre-m1-data-model-audit-2026-04-28
composer: nino-chavez
timestamp: 2026-04-28T16:50:00Z
---

# Decisions table cleanup: drop "convention" category, add triggering-contribution link

**Summary.** `decisions.category` enum reduces from `architecture | product | design | research | convention` to `architecture | product | design | research`. The `convention` value was vestigial -- it broke the discipline-classification axis with a category-of-decision instead of a discipline. New nullable column `triggered_by_contribution_id` adds the link from a decision back to the contribution that prompted it (when applicable).

**Rationale.**

Surfaced by `pre-M1-data-model-audit.md` findings F6 and F7.

**F6 -- `convention` broke the enum's classification axis.** Four values mapped to disciplines (architecture, product, design, research). `convention` did not -- it was a category of decision (e.g., naming convention, code style convention), not a discipline. The spec did not specify what made a decision a "convention" decision, when an author would choose it, or what happened differently if they did.

This is the "other / misc" anti-pattern in enum design -- one value sneaks in a second classification axis. Authors faced with `convention` would either dump everything ambiguous into it (defeating the categorization) or never use it (proving it was vestigial).

After dropping `convention`:
- A repo-convention decision (commit-message format, branch naming) -> `architecture` (it governs how the repo is structured).
- A coding-style decision -> `architecture` (same).
- If a fifth genuine discipline emerges (e.g., security, governance), it gets added deliberately with explicit semantics -- not as a catchall.

**F7 -- decisions had no link back to the triggering contribution.** Decisions are sometimes raised in the context of a contribution (a dev's PR raises an architectural question that becomes an ADR). Before this ADR, the only way to reconstruct the link was via citations in the ADR body or by trace_id correlation -- neither structurally enforced.

**Decision.**

- `decisions.category` enum: `architecture | product | design | research` (drop `convention`).
- Add `decisions.triggered_by_contribution_id` (FK to contributions, nullable) -- when a contribution prompted the decision, this links them. Optional because some decisions stand alone (top-down architectural choice, retroactive recording of an existing pattern).
- The `log_decision` signature per ARCH 6.3.1 gains an optional `triggered_by_contribution_id` parameter. When provided, the endpoint validates that the named contribution exists in the project and the calling session's composer was associated with it (was the author or has authored a related contribution). When omitted, the decision is unattributed to any contribution.

**Consequences.**

- ARCH 5.1 decisions schema updated.
- ARCH 6.3.1 log_decision signature updated.
- /atelier dashboard's decision-detail view gains a "triggered by" link when present.
- /atelier dashboard's contribution-detail view gains a "decisions raised from this work" panel reading the same field from the other side.
- BRD acceptance criteria around log_decision pick up the new optional parameter.

**Migration impact.** Pre-M1 schema -- no migration needed; schema corrected before first use.

**Trade-off considered and rejected.** Capture trigger context in telemetry events instead of a column. Rejected: telemetry is observability, not query state. Asking "which contribution triggered this decision" should not require a telemetry scan.
