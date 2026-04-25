---
id: ADR-026
trace_id: BRD:Epic-7
category: architecture
session: d22-switchman-eval-2026-04-25
composer: nino-chavez
timestamp: 2026-04-25T09:30:00Z
---

# Atelier owns the lock + fencing implementation; Switchman not adopted

**Summary.** Atelier ships its own lock-and-fencing implementation in M2 of `../../strategic/BUILD-SEQUENCE.md` rather than integrating Switchman. Resolves D22 (`../../functional/PRD-COMPANION.md`) and BRD-OPEN-QUESTIONS §2.

**Rationale.** Evaluation of `github.com/switchman-dev/switchman` (2026-04-25) showed Switchman is MIT-licensed and MCP-native — promising — but its lock model is lease-based with `scope_pattern + subsystem_tags`, with no fencing-token (monotonic per-resource counter) exposed in the public API. ADR-004 makes fencing tokens mandatory on every lock from v1 specifically to handle the stale-holder-comeback case: a partitioned session whose lease was reassigned can still write to the artifact unless the storage layer rejects on a stale token. A lease-only model is not fencing-equivalent. Integrating Switchman would either require layering fencing on top (defeating the integration's value) or accepting the gap (violating ADR-004).

Additional concerns reinforced the decision: Switchman is at v0.1.28 with no semver commitment after 6 weeks of active churn, effectively solo-maintained (`seanwessmith` + automation), and ships a 15+ tool surface centered on file-write helpers (`switchman_write_file`, `_append_file`, …) that competes with Atelier's repo-first principle (ADR-005).

Switchman's `scope_pattern + subsystem_tags` model is independent confirmation that the territory-as-scope-pattern shape works in practice (validates ADR-014). We borrow validation, not code.

**Consequences.** M2 lock subsystem in `../../strategic/BUILD-SEQUENCE.md` proceeds as own-implementation. BRD-OPEN-QUESTIONS §2 → RESOLVED. Re-evaluation trigger: if Switchman ships 1.0 with explicit fencing-token API and a semver commitment, re-open D22 with a new ADR that references this one.
