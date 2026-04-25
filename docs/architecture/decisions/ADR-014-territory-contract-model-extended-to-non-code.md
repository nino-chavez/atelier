---
id: ADR-014
trace_id: BRD:Epic-8
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:10:00Z
---

# Territory + contract model, extended to non-code

**Summary.** Territories are named domains with owner_role, scope_kind, scope_pattern, contracts_published, contracts_consumed. Contracts are typed interfaces published by territory owners and consumed by downstream territories. Cross-territory work routes through proposals.

**Rationale.** Inherits ai-hive's department/contract model. Extended so that non-code territories (strategy, research, design) are first-class. Contracts make cross-territory interfaces explicit and monitorable for breaking changes.

**Consequences.** Territories table + contracts table in datastore. Publish/get contract endpoints. Cross-territory work goes through the proposal flow. Breaking-change heuristics drive automatic proposal creation.
