---
id: ADR-049
trace_id: BRD:Epic-16
category: architecture
session: design-session-2026-05-03
composer: nino-chavez
timestamp: 2026-05-03T17:15:00Z
---

# Contribution decomposition via parent-child relationship

**Summary.** v1.x adds `decompose_contribution(epic_id, strategy)` as an MCP tool that splits an epic-level contribution into atomic claimable child contributions. Schema gains `parent_contribution_id uuid REFERENCES contributions(id)` (self-FK, nullable, ON DELETE SET NULL) on `contributions`, plus a `decomposition_strategy_t` enum (`vertical_slice | horizontal_layer | cross_cutting`) recorded on the parent. Parent contributions cannot transition to `merged` until all children are merged.

**Rationale.** Today's `contributions` table is flat. A multi-week analyst-workflow epic and a single-line bug fix occupy the same shape. The analyst-workflow case from BRD-OPEN-QUESTIONS §1 (and BRD Epic 16 generally) implies a stage where an epic-level contribution is *accepted* (via triage / `scope_in` per ADR-048) and then *decomposed* into atomic units that can be claimed independently — the "vertical slice" pattern from matt-pocock/skills `to-issues`, applied to atelier's contribution unit.

Without parent-child relationships:
- Epic-level contributions either occupy `claimed` for weeks (blocking the lens of "who's working on what" at the granularity that matters), or get *manually* split with no traceability between the original epic and its atoms.
- Manual splitting via `claim(null, ...)` works (per ADR-022) but produces orphaned siblings — no way to ask "show me all contributions decomposed from epic X" without text-matching titles or trace_ids.
- The merge gate on the epic ("don't close until all the work is done") has no schema enforcement; closure is by convention.

The parent-child relationship makes decomposition first-class and queryable.

**Rationale for `decomposition_strategy_t`.** Three strategies, each with different downstream rules:

- **vertical_slice** — each child cuts through every layer end-to-end (the matt-pocock tracer-bullet pattern). Children may be merged independently and the epic still ships value incrementally. Default for analyst-workflow decompositions.
- **horizontal_layer** — children are layer-by-layer (schema, API, UI). Children have ordered dependencies; parent merges only after all layers complete. Sometimes correct (e.g., when the epic depends on a load-bearing schema change shared across all UI work).
- **cross_cutting** — children are concern-by-concern (auth, observability, error-handling) applied across multiple existing contributions. Parent serves as a coordination ledger, not a deliverable; merges when the cross-cutting concern is uniformly applied.

The strategy is recorded so future readers (and the lens) can reason about *why* the decomposition is shaped a particular way.

**Consequences.**

- **Schema migration.**
  - Add column `parent_contribution_id uuid REFERENCES contributions(id) ON DELETE SET NULL` (nullable; null = atom or unsplit).
  - Add column `decomposition_strategy decomposition_strategy_t` (nullable on children; required on parents that have been decomposed).
  - Create enum `decomposition_strategy_t` with values `vertical_slice | horizontal_layer | cross_cutting`.
  - Add index `contributions_parent_idx` on `(parent_contribution_id, state)` for "show me all children of epic X" queries.
- **Merge-gate rule.** Parent contribution cannot transition to `merged` while any child is in a non-terminal state (`open | claimed | plan_review | in_progress | review`). Enforced at `update` handler layer (application-level check, not DB constraint, to keep the constraint diagnosable). When a child transitions to `merged`, check whether all siblings are also terminal; if so, surface a "ready to close parent" event.
- **Lens impact.** PM lens gains an "epic decomposition" view (parents + children + strategy + child progress %). Analyst lens benefits from the same view in its workflow.
- **Trace_id inheritance.** Children inherit the parent's `trace_ids` plus optionally extend with their own (via the existing `text[]` model per ADR-021). Decomposition does not REPLACE trace_ids; it composes them.
- **Decomposition is one-way.** No `recompose_contribution` tool. If a decomposition is wrong, mark parent + children as `rejected`, log a decision explaining, and re-decompose into a new parent. Reversal via re-create, not in-place edit (consistent with ADR-005 and ADR-030 append-only patterns).
- **decompose_contribution does NOT auto-create children atomically with placeholder content.** Each child is created with a meaningful title + scope provided by the caller (typically the analyst, possibly via assistant generation). The tool's contract is "establish parent-child link + record strategy"; the children are real contributions, not stubs.
- **ADR-022 still holds.** `claim` with `contribution_id=null` continues to atom-create open contributions. Decompose is the *batch* version when the input is an existing epic.

**Alternatives considered.**

- *No schema change — decomposition by convention via shared trace_id.* Rejected: trace_ids are many-to-many; using them as a parent-child surrogate makes "show me children" require pattern matching on trace_id strings. Direct FK is simpler and faster.
- *`parent_contribution_id` without `decomposition_strategy`.* Rejected: strategy materially affects merge-gate rules (vertical slices merge independently; horizontal layers don't). Recording the strategy makes the rules deterministic and lens-renderable.
- *Multi-level hierarchy (grandparents).* Deferred. v1.x ships single-level decomposition (epic → atoms). If multi-level emerges as a need (epic → mid-level → atoms), a future ADR resolves the recursion shape. Closing this design space prematurely risks the wrong abstraction.
- *Auto-decompose via heuristic.* Rejected. Decomposition is a judgment call (which slices, what scope per slice, what strategy). The tool establishes the structure once the human has decided; it does not propose the decomposition.

**Build prerequisites.**

- Schema migration (1 file: column adds, enum, index, generated `parent_terminal` helper view if needed)
- Update to `update` handler enforcing the merge-gate rule
- New handler `decomposeContribution` in `handlers.ts`
- Surface declaration in `dispatch.ts` (per ADR-048's surface-expansion governance, this lands in the same ADR-governed expansion or a successor ADR)
- Smoke tests for the merge-gate rule and the parent-child query path
- PM lens query update (separate PR)

**Trace.** Resolves the analyst-workflow decomposition gap from BRD-OPEN-QUESTIONS §1 (BRD Epic 16). Documented at v1 exit per BUILD-SEQUENCE §5.5; built when adopter signal triggers. ADR-022 (atomic create), ADR-034 (state machine), ADR-037 (triggered_by link), ADR-021 (multi-trace) are load-bearing context.
