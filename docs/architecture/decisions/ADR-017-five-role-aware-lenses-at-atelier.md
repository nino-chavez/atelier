---
id: ADR-017
trace_id: BRD:Epic-15
category: design
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:25:00Z
---

# Five role-aware lenses at /atelier

**Summary.** The `/atelier` coordination route has five lenses at v1: analyst, dev, PM, designer, stakeholder. Each is a default-view configuration — same canonical state, different first-view cuts, sort orders, and which panels expand by default.

**Rationale.** Each persona has a different first-view question. Role-specific defaults minimize friction. Composers can switch lenses via a selector.

**Consequences.** Lens config lives in `.atelier/lenses.yaml` (or similar). UI renders the lens matching the composer's role claim by default. Role-based default filters are server-side-enforced for scale.
