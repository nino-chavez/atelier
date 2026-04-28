# Testing

**Audience question:** How is quality assured? How does the disconfirming test (find_similar precision) actually work?

**Primary tier served:** Tier 2 — Reference Implementation extenders writing or extending tests.

## Status

**Pre-M5.** Most contents are placeholders. Testing docs land here at M5 per [`../strategic/BUILD-SEQUENCE.md`](../strategic/BUILD-SEQUENCE.md).

**Exception: `embedding-model-benchmark-plan.md` and `scale-ceiling-benchmark-plan.md` are populated as design drafts now** (authored 2026-04-28). Each resolves an OPEN BRD question (section 3 and section 7 respectively). Authoring early lets the prep work (eval set construction, load harness) begin before the milestones that gate the actual benchmark runs.

## Contents

| Doc | Purpose | Status |
|---|---|---|
| `embedding-model-benchmark-plan.md` | Scopes the D24 benchmark: candidate shortlist, seed-set design, methodology, decision criteria, deliverables, effort | **Design draft (2026-04-28).** Plan is detailed enough to brief a contractor or analyst. Benchmark execution requires the find_similar pipeline (M5) or a standalone harness. |
| `scale-ceiling-benchmark-plan.md` | Scopes the BRD section 7 scale benchmark: dimensions + v1 envelope, architectural sizing predictions, 5 load-test scenarios across milestones, decision criteria, side-deliverables (sessions cleanup policy, pub/sub channel topology spec) | **Design draft (2026-04-28).** Plan runs incrementally as each scale dimension goes live (M2 through M6). Two architectural gaps surfaced by analysis are tracked as ARCH addition deliverables. |
| `eval-harness.md` | How `atelier eval find_similar` runs; eval-set format; output format | Placeholder; lands at M5 |
| `find-similar-methodology.md` | Why ≥75% precision at ≥60% recall (per ADR-006); how thresholds are tuned; implications for commercial wedge | Placeholder; lands at M5 |
| `ci-gate.md` | The CI gate that enforces precision/recall on every push | Placeholder; lands at M5 |
| `writing-evals.md` | How to write a new eval case (positive pair, negative pair, adversarial) | Placeholder; lands at M5 |
| `integration-tests.md` | End-to-end tests including fencing-token enforcement | Placeholder; lands at M2 (initial) / M5 (consolidated) |
| `performance-benchmarks.md` | NFR validation per scale-ceiling-benchmark-plan.md scenarios | Placeholder; the plan lives in scale-ceiling-benchmark-plan.md, results land here at M2/M4/M5/M6 as scenarios run |

## Related layers

- For the disconfirming test's role in strategy: [`../strategic/STRATEGY.md`](../strategic/STRATEGY.md)
- For the canonical decision: [`../architecture/decisions/`](../architecture/decisions/) (ADR-006)
