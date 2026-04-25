---
id: ADR-009
trace_id: BRD:Epic-16
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:45:00Z
---

# Remote-principal actor class (web agents as first-class composers)

**Summary.** The actor model has six classes at v1 (was five in bc-subscriptions). Principal + IDE harness and Principal + web harness are distinct. Web-principals authenticate with per-composer tokens and call the same 12-tool endpoint via remote protocol transport.

**Rationale.** The mixed-team thesis (analyst + devs + PM + designer) requires that analysts in browsers with web agents are first-class composers, not second-class reviewers. Forcing analysts into terminals defeats the thesis.

**Consequences.** Session `locus` enum includes `web`. Endpoint supports remote protocol transport. Auth flow works via browser-safe token delivery. Non-code territory primitives (doc_region, research_artifact) are required for web-principals' work.
