---
id: ADR-013
trace_id: BRD:Epic-2
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:05:00Z
---

# 12-tool agent endpoint surface

**Summary.** The agent-facing endpoint exposes exactly 12 tools at v1: register, heartbeat, deregister, get_context, fit_check, claim, update, release, acquire_lock, release_lock, log_decision, publish_contract+get_contracts.

**Rationale.** Minimum viable surface for the full coordination protocol. Every tool maps to a BRD story. No over-engineering (e.g., no `hive/notify` as a tool — messaging is an external integration).

**Consequences.** Documentation enumerates all 12. Client libraries (if any) expose 12 methods. Protocol version is tracked; additions post-v1 require version bump.
