# Testing

**Audience question:** How is quality assured? How does the disconfirming test (find_similar precision) actually work?

**Primary tier served:** Tier 2 — Reference Implementation extenders writing or extending tests.

## Status

**Pre-M5.** Most contents are placeholders. Testing docs land here at M5 per [`../strategic/BUILD-SEQUENCE.md`](../strategic/BUILD-SEQUENCE.md).

**Exception: `embedding-model-benchmark-plan.md` is populated as a design draft now** (authored 2026-04-28). The plan resolves D24 (embedding model default), which gates M5 entry per BUILD-SEQUENCE section 7 question 3. Authoring early lets seed-eval-set construction begin at M2 exit and the benchmark run during M3/M4, so M5 starts with a chosen model rather than designing the selection process under implementation pressure.

## Contents

| Doc | Purpose | Status |
|---|---|---|
| `embedding-model-benchmark-plan.md` | Scopes the D24 benchmark: candidate shortlist, seed-set design, methodology, decision criteria, deliverables, effort | **Design draft (2026-04-28).** Plan is detailed enough to brief a contractor or analyst. Benchmark execution requires the find_similar pipeline (M5) or a standalone harness. |
| `eval-harness.md` | How `atelier eval find_similar` runs; eval-set format; output format | Placeholder; lands at M5 |
| `find-similar-methodology.md` | Why ≥75% precision at ≥60% recall (per ADR-006); how thresholds are tuned; implications for commercial wedge | Placeholder; lands at M5 |
| `ci-gate.md` | The CI gate that enforces precision/recall on every push | Placeholder; lands at M5 |
| `writing-evals.md` | How to write a new eval case (positive pair, negative pair, adversarial) | Placeholder; lands at M5 |
| `integration-tests.md` | End-to-end tests including fencing-token enforcement | Placeholder; lands at M2 (initial) / M5 (consolidated) |
| `performance-benchmarks.md` | NFR validation (endpoint p95, pub/sub latency, sync lag) | Placeholder; lands at M5/M7 |

## Related layers

- For the disconfirming test's role in strategy: [`../strategic/STRATEGY.md`](../strategic/STRATEGY.md)
- For the canonical decision: [`../architecture/decisions/`](../architecture/decisions/) (ADR-006)
