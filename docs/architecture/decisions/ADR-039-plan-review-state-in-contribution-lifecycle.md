---
id: ADR-039
trace_id: BRD:Epic-4
category: architecture
session: m2-entry-strategic-call-2026-04-30
composer: nino-chavez
timestamp: 2026-04-30T00:00:00Z
---

# Plan-review state added to contribution lifecycle (per-territory opt-in, default off)

**Summary.** `contributions.state` enum gains a seventh value: `plan_review`. The state slots between `claimed` and `in_progress`. Activation is per-territory via a new `territories.yaml: requires_plan_review: bool` field (default `false`). When the territory has `requires_plan_review=true`, an agent must transition `claimed -> plan_review` with a free-form markdown plan in `content_ref` before transitioning to `in_progress`. The territory's `review_role` approves via `update(state="in_progress")` or rejects via `update(state="claimed")` with a reason. Locks are not required at `plan_review` (no artifact body is being written yet); locks acquire at `in_progress` per existing semantics. Resolves BRD-OPEN-QUESTIONS section 19.

**Rationale.**

Surfaced by the 2026-04-28 strategy addendum on AI-speed coordination. The addendum identified that PR review is the only alignment touchpoint in the existing 5-state lifecycle, and that human-latency-as-bottleneck is the v1 commitment of the AI-speed pivot. Three independent projects (ACE, SpecLang, Copilot Workspace) converge on the same primitive: agent generates plan -> team edits collaboratively -> code follows.

**Why now, at v1, not v1.x.** Per ADR-011 (destination-first design, no feature deferral), Atelier specifies the full v1 destination and sequences the build. "Plan-review at v1.x if deployment data shows..." would be exactly the "Phase 2 / coming soon" pattern ADR-011 prohibits. The honest call is binary: in v1 scope or not. Three reasons it belongs in v1:

1. **AI-speed pivot internal consistency.** v1 already commits to addressing human-latency-as-bottleneck. Two mechanisms exist: this ADR (move alignment earlier) and section 21 of BRD-OPEN-QUESTIONS (compress existing review-state latency via AI auto-reviewers). At least one must ship at v1 or the pivot's commitment is unmet. This one is a primitive (intent vs execution as a lifecycle slot); section 21 is an optimization on top of an existing primitive. The primitive belongs in v1.

2. **Regulated-team positioning value.** Atelier's Tier-1 audience is regulated, audit-trail-required teams. The intent vs execution separation -- "approver X reviewed agent Y's plan at time T before the work began" -- is a load-bearing audit-trail primitive for these teams independently of latency arguments. A regulated auditor reviewing the canonical state should see plan-review as a first-class lifecycle slot, not as a convention buried in `transcript_ref`.

3. **Three independent reference projects converge on the pattern.** ACE, SpecLang, and Copilot Workspace each implement plan-then-implement as a structural lifecycle stage, not as a convention. The market signal is strong; rejecting outright is a defensible position only if the convention path is sufficient for Atelier's audience -- and per (2), it is not.

**Why per-territory opt-in (default off).** Per the discipline-tax meta-finding, every methodology addition risks adoption cost. Default-off means existing simple workflows (config edits, minor doc fixes, low-risk code) are unaffected -- the lifecycle behaves exactly as it does today. Territories that opt in (likely: methodology, architecture, decisions, designs, contracts) pay the latency cost in exchange for the alignment touchpoint. The default-off posture matches the same reasoning that produced section 24's branch-reaping default-off (opt-in until operational data shows the right enable threshold).

**Decision.**

The contribution lifecycle reshapes:

```
open -> claimed -> [plan_review ->] in_progress -> review -> merged
                                          \                  /
                                           \                / (back to claimed on rejection)
                                            \              /
                                             \-> rejected /
```

The `plan_review` gate activates iff `territories.requires_plan_review = true` for the contribution's territory. When inactive, the lifecycle is unchanged from prior shape.

**Schema additions:**

- `contributions.state` enum gains `plan_review` value (6 -> 7 values).
- `territories.yaml` schema: new optional field `requires_plan_review: bool` (default `false` when omitted).

**Endpoint surface (M2 work):**

- `update(contribution_id, state="plan_review", payload=<plan markdown>, content_ref=<plan path>)` -- author-only transition from `claimed`. The plan markdown is treated as the artifact body for this state; `content_ref` points at the plan file (e.g., `<contribution>/plan.md`). No fencing token required (no artifact-body lock applies; the plan IS the working content at this state).
- `update(contribution_id, state="in_progress")` from `plan_review` -- restricted to composers in `territory.review_role` AND not the contribution's `author_composer_id` (same self-review block as the existing G2 owner-approval rule). On success, `plan_review_approved_by_composer_id` and `plan_review_approved_at` populate. The agent now proceeds to acquire_lock + author the implementation.
- `update(contribution_id, state="claimed", reason=<text>)` from `plan_review` -- the reviewer rejects the plan. The agent revises and re-submits via another `claimed -> plan_review` transition, OR releases.

**Lock semantics at `plan_review`.** No lock is required to enter or exit `plan_review`. Rationale: the plan markdown is a document, not the implementation artifact. Two agents could not both be in plan_review for the same contribution (the contribution itself is single-claimed via `author_session_id`), so there is no conflict surface. Locks remain required at `in_progress` per ARCH 7.4.

**Plan format.** Free-form markdown at v1. Structured templates (intent / approach / files-touched / risks) can be added per-territory at v1.x as a config knob if a team's plan-review reviewers want a consistent shape. v1 ships the simplest viable surface.

**Telemetry actions (M2 work, on top of existing schema):**

- `contribution.plan_submitted` -- emitted on `claimed -> plan_review` transition.
- `contribution.plan_approved` -- emitted on `plan_review -> in_progress` transition.
- `contribution.plan_rejected` -- emitted on `plan_review -> claimed` transition; carries the `reason` field.

**Authorship and audit-trail behavior.**

- `author_composer_id` on the contribution row is unchanged through the plan_review gate (the agent stays the author regardless of who reviews the plan).
- `plan_review_approved_by_composer_id` is the immortal identity of the plan-reviewer per ADR-036 conventions; nullable; populated only when the plan was reviewed (i.e., when the territory had `requires_plan_review=true` and the plan was approved).
- An auditor reading the canonical state sees the contribution row's full lifecycle: who proposed it, who approved the plan and when, who reviewed the implementation and when, who merged.

**Per-territory configuration shape.** Adding `requires_plan_review: true` to a territory is a deliberate signal that the territory's work is high-stakes enough to warrant the alignment touchpoint cost. The repo's own `.atelier/territories.yaml` does NOT enable plan_review on any territory at the v1 ship -- enabling is a per-deployment opt-in, the same as section 24's branch-reaping config flag.

**Consequences.**

- ARCH 5.1 contributions schema gains the `plan_review` enum value + the two `plan_review_approved_*` columns.
- ARCH 5.1 territories block documents the `requires_plan_review` field + default behavior.
- ARCH 6.2 contribution lifecycle diagram updates to show the optional gate.
- New ARCH section 6.2.1.7 specifies plan_review semantics in detail (transitions, validation, telemetry).
- ARCH 6.2.2 update signature gains the `plan_review` value in the `state` parameter enum.
- ARCH 6.8 telemetry-actions table gains the three new actions.
- BRD-OPEN-QUESTIONS section 19 RESOLVED.
- BRD acceptance criteria for stories that touch contribution-lifecycle endpoints update to acknowledge the optional gate.
- M2 migration adds the enum value + the two columns (additive; non-breaking).
- M2 endpoint write library extends `update()` to validate the new transitions and emit the new telemetry.
- M2 smoke tests cover: opt-in territory plan_review path (claim -> plan_review -> in_progress); opt-out territory unchanged path; reviewer self-approval blocked; non-reviewer cannot approve; plan_rejected returns to claimed; agent revision and re-submission.

**Trade-off considered and rejected.** Convention-based plan capture (agent writes `plan.md` to `content_ref`, posts a PR comment, waits for explicit "go" before transitioning to in_progress). Rejected because (1) per (2) above, intent-vs-execution is a load-bearing primitive for the regulated-team audience, not a convention; (2) PR comments are not in the canonical datastore -- they're external GitHub state; an audit trail that lives in chat or PR comments fails the regulated-team audit; (3) a state-machine slot is the queryable, RLS-enforceable, telemetry-emitting surface that the convention cannot match.

**Trade-off considered and rejected.** Default-on plan_review for all territories. Rejected per the discipline-tax meta-finding: forcing every contribution through plan-review at v1 imposes latency cost on simple work where the alignment value is low. Default-off + per-territory opt-in lets teams calibrate per their audit needs.

**Trade-off considered and rejected.** Land plan_review at v1.x with a `territories.requires_plan_review` config knob reserved at v1 (no functional behavior). Rejected: this is exactly the "v1 reserves config; v1.x flips functional" pattern that ADR-011 prohibits in design docs. A reserved knob with no functional behavior is a feature-deferral disguised as forward-compatibility; the destination either includes plan_review or it does not.

**Re-evaluation triggers.**

- Adoption data after 6 months in production showing plan_review is enabled in zero deployed territories across the user base. Trigger: re-evaluate whether the surface is load-bearing or whether the convention path is in fact sufficient.
- A v1.x feature request to make plan_review default-on or to add structured plan templates per territory. Trigger: verify the per-territory opt-in calibration is still right.
