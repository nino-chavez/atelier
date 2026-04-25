---
id: ADR-025
trace_id: BRD:Epic-15
category: design
session: walk-analyst-week-1-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T16:20:00Z
---

# Review routing keyed by territory.review_role

**Summary.** Contributions transitioning to `state=review` are routed to lenses by `territories.review_role`. Default mappings: `strategy-research → pm`, `protocol → dev` (peer), `requirements → pm`, `prototype-app → dev` (peer), `prototype-design → designer` (peer), `methodology/architecture/decisions → architect`. Lenses query the union of (territories owned by composer's role) and (territories with review_role matching composer's role).

**Rationale.** Surfaced by the analyst-week-1 walk (`walks/analyst-week-1.md` Gap #5). NORTH-STAR §4 lens definitions partially covered review surfaces but did not specify which lens picks up which `kind × state` combination. Per-territory `review_role` is the smallest change that resolves it cleanly, reuses the existing territory-as-config pattern, and avoids global rule tables that would compete with territory ownership.

**Consequences.** `.atelier/territories.yaml` schema gains a `review_role` field per territory entry. NORTH-STAR §4 lens descriptions reference territory.review_role. Default values committed in this repo's territories.yaml serve as a reference example for projects scaffolded by `atelier init`.
