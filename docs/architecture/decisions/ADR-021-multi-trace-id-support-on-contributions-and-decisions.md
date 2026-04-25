---
id: ADR-021
trace_id: BRD:Epic-4
category: architecture
session: walk-analyst-week-1-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T16:00:00Z
---

# Multi-trace-ID support on contributions and decisions

**Summary.** `contributions.trace_id` and `decisions.trace_id` become `trace_ids text[]`. Singular case is a one-element array. GIN indexes replace btree on the trace columns. Endpoint tools accept either `trace_ids: string[]` or a singular `trace_id: string` (treated as one-element).

**Rationale.** Surfaced by the analyst-week-1 walk (`walks/analyst-week-1.md` Gap #4). Cross-cutting work — research on US-1.3 that reveals implications for US-1.5, an architectural decision that affects two epics — must be modelable as a single contribution or decision. Forcing splits into separate rows fragments rationale; a "primary trace_id with mentions in body" pattern breaks `WHERE trace_id='X'` queries. An array is the smallest schema change that supports the real shape of work without compromising query semantics.

**Consequences.** ARCH §5.1 schema updates. ARCH §5.2 changes the trace_id indexes to GIN. NORTH-STAR §5 endpoint signatures accept both forms. Reversal cost is bounded: drop the array, keep the first element.
