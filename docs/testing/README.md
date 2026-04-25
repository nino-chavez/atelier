# Testing

**Audience question:** How is quality assured? How does the disconfirming test (fit_check precision) actually work?

**Primary tier served:** Tier 2 — Reference Implementation extenders writing or extending tests.

## Status

**Pre-M5.** Empty placeholder. Testing docs land here at M5 per [`../strategic/BUILD-SEQUENCE.md`](../strategic/BUILD-SEQUENCE.md).

## Contents (planned)

| Doc | Purpose | Lands at |
|---|---|---|
| `eval-harness.md` | How `atelier eval fit_check` runs; eval-set format; output format | M5 |
| `fit-check-methodology.md` | Why ≥75% precision at ≥60% recall (per ADR-006); how thresholds are tuned; implications for commercial wedge | M5 |
| `ci-gate.md` | The CI gate that enforces precision/recall on every push | M5 |
| `writing-evals.md` | How to write a new eval case (positive pair, negative pair, adversarial) | M5 |
| `integration-tests.md` | End-to-end tests including fencing-token enforcement | M2 (initial) / M5 (consolidated) |
| `performance-benchmarks.md` | NFR validation (endpoint p95, pub/sub latency, sync lag) | M5/M7 |

## Related layers

- For the disconfirming test's role in strategy: [`../strategic/STRATEGY.md`](../strategic/STRATEGY.md)
- For the canonical decision: [`../architecture/decisions/`](../architecture/decisions/) (ADR-006)
