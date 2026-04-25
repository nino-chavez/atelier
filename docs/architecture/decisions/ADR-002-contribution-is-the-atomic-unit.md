---
id: ADR-002
trace_id: BRD:Epic-4
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:10:00Z
---

# Contribution is the atomic unit

**Summary.** Tasks, decisions, PRs, proposals, and drafts all live in one `contributions` table. Distinguished by `kind` (implementation | decision | research | design | proposal). Governed by one state machine with 7 states.

**Rationale.** Simpler queries, simpler UI, one set of RLS policies, one set of lifecycle rules. A task is a contribution in `open`. A decision is a contribution with `kind=decision`. A triaged comment is a contribution with `kind=proposal`. The domain model collapses cleanly.

**Consequences.** Database schema has one `contributions` table instead of 3–4. Coordination primitives (claim, release, update) apply uniformly across all kinds. UI renders contributions through kind-specific views but shares lifecycle components.
