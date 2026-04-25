---
id: ADR-004
trace_id: BRD:Epic-7
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:20:00Z
---

# Fencing tokens mandatory on all locks from v1

**Summary.** Every lock acquisition returns a monotonic per-project fencing_token. Every write to a locked artifact validates the token server-side. Stale tokens rejected unconditionally.

**Rationale.** Hackathon-hive ships without fencing; Kleppmann's critique of Redlock applies literally — a GC pause past TTL causes silent overwrite. Known data-loss risk. Retrofitting fencing is an API break and a migration; shipping at v1 is cheap.

**Consequences.** Every write path in the endpoint validates fencing. Lock table includes `fencing_token bigint`. Per-project monotonic counter in a dedicated table with advisory-lock isolation. Documentation explains fencing to users.
