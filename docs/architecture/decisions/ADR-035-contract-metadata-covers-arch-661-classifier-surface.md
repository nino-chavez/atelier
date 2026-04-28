---
id: ADR-035
trace_id: BRD:Epic-6
category: architecture
session: pre-m1-data-model-audit-2026-04-28
composer: nino-chavez
timestamp: 2026-04-28T16:40:00Z
---

# Contract metadata schema covers ARCH 6.6.1 classifier surface

**Summary.** The `contracts` table replaces the single `breaking_change` boolean with four columns capturing the breaking-change classifier surface specified in ARCH 6.6.1: `classifier_decision`, `override_decision`, `override_justification`, and a generated `effective_decision`. A CHECK constraint enforces that overrides carry a justification.

**Rationale.**

Surfaced by `pre-M1-data-model-audit.md` finding F5.

ARCH 6.6.1 specifies a richer breaking-change classification than the schema captured:
- The classifier reads multiple criteria (field removed, field renamed, narrowed type, required field added, default changed, etc.) to produce a "breaking" or "additive" decision.
- The publisher may override the classifier with `override_classification="additive"` and a required `override_justification` string.
- The override is surfaced in `/atelier/observability` for audit.
- Consumer territories may escalate an override to a proposal contribution.

The single `breaking_change bool` collapsed all of this. Where did override_justification live? Where did the classifier's reasoning go? Telemetry might capture the events, but the contracts row that consumers query had no record. Audit and forensics would require joining telemetry events back to contract versions.

**Decision.**

The `contracts` table schema:

```
contracts
  id (uuid, pk)
  project_id (fk)
  territory_id (fk)
  name
  schema (jsonb)
  version (integer)                             -- semver-encoded as major*1000+minor (per ARCH 6.6.1)
  published_at
  classifier_decision (breaking | additive)     -- the classifier's reading
  classifier_reasons (jsonb)                    -- the criteria triggered: ["field_removed:foo", "type_narrowed:bar"]
  override_decision (breaking | additive | null) -- publisher override; null when no override applied
  override_justification (text)                 -- required when override_decision is non-null
  effective_decision (breaking | additive)      -- GENERATED: COALESCE(override_decision, classifier_decision)

  CHECK (override_decision IS NULL OR override_justification IS NOT NULL)
  CHECK (override_decision IS NULL OR length(trim(override_justification)) > 0)
```

The `breaking_change` column is removed. Consumers querying "is this version breaking" read `effective_decision = 'breaking'`.

**Consequences.**

- ARCH 5.1 contracts schema updated.
- ARCH 6.6 publish_contract flow gains explicit override-handling: when publisher passes `override_classification`, the endpoint records it on the row alongside the classifier's decision; both are visible in /atelier/observability.
- The proposal-flow path described in ARCH 6.6 (breaking changes require cross-territory approval) keys on `effective_decision = 'breaking'`, so the override mechanism naturally governs whether the proposal flow runs.
- Consumer territories observing an override they disagree with file a proposal contribution per ARCH 6.6 to escalate. The escalation path is unchanged; only the data backing it is now first-class.
- BRD acceptance criteria for the contract publish flow gain explicit override-recording requirements.

**Migration impact.** Pre-M1 schema -- no migration needed; the schema is corrected before first use.

**Trade-off considered and rejected.** Store override-related state in a sidecar table (`contract_overrides`). Rejected: every contract row needs a decision, and the override path is the same lifecycle as the publish path. A sidecar would force a join on every contract read just to know whether an override applied. Inline columns + a generated effective decision is the cheaper pattern.
