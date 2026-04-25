---
id: ADR-016
trace_id: BRD:Epic-1
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:20:00Z
---

# Two orthogonal substrates: SDLC sync + coordination

**Summary.** SDLC sync substrate (5 scripts, repo ↔ external tools, hours-to-days timescale) and coordination substrate (blackboard + 12-tool endpoint, seconds-to-minutes timescale) are independently deployable. They share trace IDs as cross-reference but are not conflated.

**Rationale.** Different timescales, different failure modes, different competitive landscapes. Conflating them caused red-team findings about one to be misapplied to the other.

**Consequences.** Documentation keeps them separate. Deploy order can differ (e.g., sync substrate without coordination, or vice versa). Competitive analysis treats them independently.
