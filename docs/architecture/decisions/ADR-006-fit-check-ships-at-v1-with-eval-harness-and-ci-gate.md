---
id: ADR-006
trace_id: BRD:Epic-6
category: product
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:30:00Z
---

# fit_check ships at v1 with eval harness and CI gate

> **Vocabulary note (post-2026-04-30):** `fit_check` was renamed to `find_similar` per commit `7713913`. This ADR's body retains the original `fit_check` name for historical fidelity; all current references use `find_similar`.
>
> **Wedge-framing demoted (post-M5 / M6 strategic re-evaluation, 2026-05-01):** This ADR's original framing of find_similar as "the single most differentiated primitive" was overstated relative to what the capability delivers at v1 quality. Post-M5 measurement (P=0.672, R=0.626 on Atelier's own corpus per ADR-042) and the M6 strategic re-evaluation reframed the load-bearing differentiation as the substrate as a whole — territories + contracts + atomic claim + fenced locks + broadcast + repo-canonical decisions + per-project committer + the methodology — with find_similar as one auxiliary capability within it. ADR-043 split the gate into advisory (v1 default; cleared) and blocking (v1.x opt-in; gated on cross-encoder reranker). ADR-045 added pre-claim file-overlap awareness via `get_context(scope_files)` as a sibling capability — distinct from semantic similarity. ADR-045 also flipped the CI eval gate to informational-by-default (advisory-tier semantics already framed warn-don't-block per ADR-043; per-PR noise floor exceeded the gate margin; blocking on noise was a discipline tax). See `STRATEGY.md §4 + §7`, `NORTH-STAR.md §7 + §16`, `BRD.md US-2.5` for the realigned framing.
>
> The ADR's original DECISION (ship find_similar at v1 with eval harness + CI gate) stands; the framing of *why* it ships and *what it delivers* is updated above.

**Summary.** Fit_check is the semantic-search primitive that detects "is this already done or in flight?" It ships at v1 with a labeled eval set in `atelier/eval/fit_check/*.yaml` and a CI gate at ≥75% precision at ≥60% recall.

**Rationale.** Fit_check is the single most differentiated primitive in Atelier. Shipping without it would remove the defensible commercial wedge. Shipping keyword-only would not test the semantic hypothesis. The CI gate ensures precision doesn't drift as the codebase evolves.

**Consequences.** Vector index is part of the v1 datastore. Eval set + runner + CI job all ship at v1. Accept/reject feedback loop feeds eval improvements. Keyword fallback exists with explicit UI banner when vector index is unavailable.
