---
id: ADR-040
trace_id: BRD:Epic-2
category: architecture
session: m2-entry-data-model-audit-2026-04-30
composer: nino-chavez
timestamp: 2026-04-30T14:00:00Z
---

# 12-tool surface consolidation: propose_contract_change replaces publish_contract + get_contracts

**Summary.** ADR-013 fixed the 12-tool agent endpoint surface at v1 but listed 13 tool names if `publish_contract` and `get_contracts` were treated as distinct (which they were, per BRD US-2.6 / US-8.x). The list was internally inconsistent ("exactly 12" declared; 13 enumerated). This ADR consolidates the contracts surface into a single tool named `propose_contract_change` and removes `get_contracts`, with contract reads served via `get_context`. The 12-tool list at v1 is locked at: register, heartbeat, deregister, get_context, find_similar, claim, update, release, log_decision, acquire_lock, release_lock, propose_contract_change.

**Rationale.**

Surfaced by the M2-entry data-model + contract audit (`docs/architecture/audits/M2-entry-data-model-audit.md` finding H2). ADR-013's body lists `register, heartbeat, deregister, get_context, fit_check, claim, update, release, acquire_lock, release_lock, log_decision, publish_contract+get_contracts` — 11 plus a `+`-joined pair. The "+" reads as "and" rather than as a single combined tool, making the count 13. ADR-013's declared count of "exactly 12" cannot both be true and consistent with the list.

**Why this resolution, not the alternatives.**

Three resolution paths were considered:

**Path A (this ADR): consolidate to `propose_contract_change`; fold `get_contracts` into `get_context`.** The contracts publish flow per ARCH 6.6 always goes through a classification step (additive vs breaking; ADR-035 surfaces the override mechanism). Whether the result is an automatic publish (additive) or a proposal contribution awaiting approval (breaking), the semantics are uniformly "the publisher is *proposing* a change" — the endpoint decides, based on classifier output, whether to apply directly or to create a proposal. `propose_contract_change` names the operation rather than the optimistic-case outcome (`publish_contract`), consistent with the `fit_check → find_similar` rename pattern in the README vocabulary table (name the operation, not the use case). Reads collapse onto `get_context` because the ContextResponse already returns `territories.consumed[].contracts_consumed` — extending it to return contract bodies (when requested) eliminates the need for a separate `get_contracts` tool. Endpoint surface stays at 12 as ADR-013 declared.

**Path B (rejected): retain both as separate tools; declare ADR-013 was a count error and the surface is 13.** Defensible if the team values keeping the publish/read paths textually distinct, but introduces three drag points: (1) ADR-030's append-only convention requires a reversal of ADR-013's "12" claim — a heavyweight move for a count fix; (2) the protocol-version line in ADR-013's consequences ("additions post-v1 require version bump") would break, since the v1 surface itself is being changed; (3) `get_contracts` duplicates surface that `get_context` already covers. The duplication compounds with ARCH 6.7's lens model — a designer or dev session reading the contracts surface via `get_context` already gets project-scoped, RLS-filtered, lens-tuned results; routing that read through a separate tool yields no incremental capability.

**Path C (rejected): retain `publish_contract`; drop `get_contracts` only.** Hybrid of A and B. Lands the 12-count consolidation but keeps `publish_contract` as the name. Rejected because the operational reality of the contracts flow per ARCH 6.6 is "propose a change; the endpoint decides via classifier whether to apply directly or queue for approval." The name `publish_contract` implies the publisher decides the outcome, which contradicts the ADR-035 override mechanism (the publisher's classification override is itself subject to consumer-territory escalation). `propose_contract_change` is the honest name; this ADR aligns name to operation.

**Decision.**

The 12-tool surface at v1, locked:

```
register, heartbeat, deregister,
get_context, find_similar,
claim, update, release, log_decision,
acquire_lock, release_lock,
propose_contract_change
```

`get_contracts` is removed from the v1 surface. Consumers read contracts via `get_context`; ContextResponse extended at M2 to include contract bodies when the requesting lens or `kind_filter` indicates the consumer needs them.

**`propose_contract_change` signature (M2 implementation; full per-tool wire format is the M2 endpoint deliverable).**

```
propose_contract_change(
  territory_id:               uuid,
  name:                       string,                                  // contract name; unique within (project, name)
  schema:                     jsonb,                                   // the proposed contract schema
  override_classification:    "breaking" | "additive" | null,          // optional publisher override per ADR-035
  override_justification:     string | null                            // required when override_classification non-null
) -> ProposeContractChangeResponse

ProposeContractChangeResponse {
  contract_id:                uuid,                                    // the contracts row id (new or pre-existing major version)
  version:                    integer,                                 // semver-encoded major*1000+minor per ARCH 6.6.1
  classifier_decision:        "breaking" | "additive",                 // what the classifier read
  classifier_reasons:         string[],                                // why
  effective_decision:         "breaking" | "additive",                 // COALESCE(override, classifier) per ADR-035
  outcome:                    "published" | "proposal_created",        // additive => published; breaking => proposal contribution awaits approval
  contribution_id:            uuid | null                              // populated when outcome=proposal_created (the contribution awaiting cross-territory approval per ARCH 6.6)
}
```

The endpoint atomically:
1. Validates the caller holds the territory's `owner_role` discipline (per ARCH 5.3).
2. Runs the classifier (ARCH 6.6.1) against the prior version's schema.
3. If `effective_decision = "additive"`: inserts a new contracts row with minor-bumped version; broadcasts `contract.published` (post-M4); returns `outcome = "published"`.
4. If `effective_decision = "breaking"`: creates a contribution with `kind=design` (or `kind=implementation` per the consumer's discipline), `requires_owner_approval=true`, tagged with the proposed contracts row; consumers approve via the existing `update(owner_approval=true)` flow per ARCH 6.2.2. Inserts the new contracts row at major-bumped version when the proposal is approved (the merge-time hook). Returns `outcome = "proposal_created"`.

This mirrors the ARCH 6.6 flow exactly; the API surface is the entry point.

**`get_context` extension for contract reads (M2 implementation).**

ContextResponse's `territories.consumed[]` extends from `{name, contracts_consumed}` to:

```
consumed: [
  {
    name: "<territory_name>",
    contracts_consumed: [
      {
        name: "<contract_name>",
        version: <integer>,                  // current default version per consumer's pin
        schema: <jsonb> | null,              // populated when lens/kind_filter requests it
        effective_decision: "breaking" | "additive",
        last_published_at: <timestamp>
      },
      ...
    ]
  },
  ...
]
```

When `lens=designer` or `lens=dev`, the schema bodies populate by default. Other lenses receive names + versions only (token budget per ARCH 6.7.2). Callers can opt-in to schema bodies via a `with_contract_schemas: true` parameter (added at M2 with this consolidation).

**Authorization for contract reads.** Same as the rest of `get_context`: project membership via session token; no per-territory role gating beyond that (any project member can read any project's contract bodies). RLS scopes via project_id per ARCH 5.3. The territory's `owner_role` gate applies only to writes (propose_contract_change), not reads.

**Consequences.**

- **ADR-013 is preserved verbatim** per the append-only convention (ADR-030). The README vocabulary table gains a row recording the rename + consolidation, mirroring how the `fit_check → find_similar` rename is documented.
- **ARCH 6.6 (territory contract flow) updates** to use the `propose_contract_change` name, the explicit ProposeContractChangeResponse shape, and the additive-vs-breaking branch behavior described above.
- **ARCH 6.7 (get_context) extends** the ContextResponse shape with the contracts schema-body surface and the `with_contract_schemas` parameter.
- **BRD US-2.6 (claim) and US-8.x (territory contracts)** retain their existing acceptance criteria; the `propose_contract_change` name replaces `publish_contract` in the surface citations only. No story rescoped; the capability is intact.
- **The 12-tool count is canonical at v1** and is the wire-format contract M2 implements. No hidden 13th tool, no deferred tools, no expansion knobs.

**Trade-off considered and rejected.** Add `propose_contract_change` AND retain `publish_contract` as a deprecated alias. Rejected: aliases imply the deprecated form is still callable, which is a v1.x phasing the methodology forbids per ADR-011. The v1 surface is binary — a tool exists or it doesn't. `publish_contract` does not exist at v1.

**Trade-off considered and rejected.** Keep `get_contracts` as a 13th tool and bump ADR-013's count to 13. Rejected per the operational reality of the consolidation (Path A rationale above) and per the heaviness of reversing ADR-013's count claim for marginal value.

**Trade-off considered and rejected.** Defer the consolidation to v1.x and ship M2 with both `publish_contract` and `get_contracts`. Rejected: the 12-tool count is locked at v1 per ADR-013; shipping 13 at M2 and "fixing" at v1.x is exactly the "Phase 2 / coming soon" pattern ADR-011 prohibits in design surfaces. The destination either includes 12 tools (this ADR's posture) or the count was wrong (Path B); pick one. Path A is the one with lowest churn cost.

**Re-evaluation triggers.**

- A consumer-territory reviewing a published contract requests the ability to read the contract body via a dedicated tool, not via `get_context`. Trigger: re-evaluate whether the lens-tuned read on `get_context` actually meets consumer-territory ergonomics, or whether `get_contracts` should land at v1.x.
- A team's `propose_contract_change` calls consistently bypass the proposal flow via `override_classification="additive"` despite the classifier reading "breaking", and consumer territories never escalate. Trigger: re-evaluate the override mechanism (ADR-035) and whether the proposal flow's value justifies its surface.
