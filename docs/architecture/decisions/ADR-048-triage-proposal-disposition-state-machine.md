---
id: ADR-048
trace_id: BRD:Epic-9
category: product
session: design-session-2026-05-03
composer: nino-chavez
timestamp: 2026-05-03T17:00:00Z
---

# Triage proposal disposition state machine

**Summary.** v1.x adds `triage_proposal(contribution_id, decision, reason?)` as the 13th MCP tool. The disposition vocabulary is `scope_in | defer | reject`. Each disposition is a one-way transition recorded as a new column on the `contributions` table (`triage_decision`) plus a triage decision row in the existing `decisions` table for audit.

**Rationale.** ADR-018 specifies that external content becomes proposal-shaped contributions awaiting human approval. It does not specify *the vocabulary of the human's decision* — currently the disposition is implicit in whether the contribution gets created at all (rejected = never created), gets routed to active work (scope_in = state advances toward `claimed`), or sits indefinitely (defer = no transition). Implicit dispositions are unauditable. A formal state machine surfaces the decision as a first-class event the analyst-workflow lens can render.

The vocabulary `scope_in | defer | reject` mirrors the BigBlueprint `/blueprint-triage` skill (matt-pocock-influenced) and matches how analyst teams already reason about incoming work: *take it in, push it out, or close the door*. No fourth disposition is needed; `clarify` (a fourth candidate) is properly modeled as remaining in `needs-triage` with comments, not a terminal state.

The tool surfaces M6's existing `scripts/sync/lib/triage.ts` logic as an MCP-callable surface. The script already classifies; it just doesn't formalize the disposition decision as a callable tool.

**Consequences.**

- **Schema migration.** Add column to `contributions`: `triage_decision triage_decision_t` (nullable; null = not yet triaged). Create enum `triage_decision_t` with values `scope_in | defer | reject`. Add partial index `contributions_triage_open_idx` on `(project_id, created_at DESC) WHERE triage_decision IS NULL` for "what needs triage" queries.
- **Decision audit.** Each `triage_proposal` call writes a row to `decisions` with `category='triage'` and `triggered_by_contribution_id` set (per ADR-037's link). The disposition + reason are in the decision body. This makes the triage history queryable via the same path as ADRs.
- **State machine interaction.** Disposition is *orthogonal* to lifecycle state (per ADR-034's pattern). A `scope_in` disposition does not auto-transition the contribution; it makes it eligible to advance via `claim`/`update`. A `defer` disposition is similar to `blocked_by`/`blocked_reason` but at the triage layer, not the dependency layer. A `reject` disposition transitions `state` to `rejected` (existing terminal state per ADR-034).
- **MCP surface expansion.** Surface grows from 12 to 13 tools at v1.x. ADR-040's lock applies to v1; the v1.x expansion is governed by this ADR (which is the analogous lock for the v1.x surface point at which `triage_proposal` lands). When this tool ships, `dispatch.ts` TOOL_NAMES expands to 13 and the compile-time `_twelveCheck` assertion becomes `_thirteenCheck`.
- **Lens impact.** The analyst lens at `/atelier` gains a "triage queue" view powered by the partial index. The PM lens gains a "triaged-and-deferred" view as a follow-up backlog signal.
- **No reversal of ADR-018.** ADR-018's "triage never auto-merges" invariant holds — `scope_in` advances eligibility, not state. Human approval still required for `merged`.

**Alternatives considered.**

- *Disposition stored only in decisions, no contribution column.* Rejected: makes the "what needs triage" query require a join+anti-join pattern (every contribution + LEFT JOIN decisions WHERE category='triage' IS NULL). Partial index on a contribution column is faster and simpler.
- *Add `clarify` as a fourth disposition.* Rejected: clarify is properly modeled as comments + remaining in `needs-triage`. A fourth disposition adds a state without adding semantics — clarify is a process step, not a terminal disposition.
- *Disposition implicit in state transitions (no new tool).* Rejected: this is the current state and is the gap this ADR resolves. Without a formal tool, the analyst lens has no signal for "what was triaged when, by whom, why" beyond reading the script's output logs.

**Build prerequisites.**

- Schema migration writing the column + enum + partial index (estimate: 1 migration file)
- New handler in `scripts/endpoint/lib/handlers.ts` (parallels existing `claim`/`update` patterns)
- Surface declaration in `dispatch.ts` TOOL_NAMES (and assertion update)
- Smoke test in `scripts/endpoint/__smoke__/` covering the three disposition paths
- Update to `scripts/sync/lib/triage.ts` to call the new tool instead of producing implicit dispositions

**Trace.** Resolves part of `BRD:Epic-9` (analyst workflow). Documented at v1 exit per BUILD-SEQUENCE §5.5; built when adopter signal triggers. ADR-018 (predecessor: triage classification rule), ADR-034 (state-vs-blocked pattern), ADR-037 (triggered_by_contribution_id link) are load-bearing context.
