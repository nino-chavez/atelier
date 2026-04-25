---
id: ADR-006
trace_id: BRD:Epic-6
category: product
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:30:00Z
---

# fit_check ships at v1 with eval harness and CI gate

**Summary.** Fit_check is the semantic-search primitive that detects "is this already done or in flight?" It ships at v1 with a labeled eval set in `atelier/eval/fit_check/*.yaml` and a CI gate at ≥75% precision at ≥60% recall.

**Rationale.** Fit_check is the single most differentiated primitive in Atelier. Shipping without it would remove the defensible commercial wedge. Shipping keyword-only would not test the semantic hypothesis. The CI gate ensures precision doesn't drift as the codebase evolves.

**Consequences.** Vector index is part of the v1 datastore. Eval set + runner + CI job all ship at v1. Accept/reject feedback loop feeds eval improvements. Keyword fallback exists with explicit UI banner when vector index is unavailable.
