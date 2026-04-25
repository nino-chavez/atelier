---
id: ADR-001
trace_id: BRD:Epic-1
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:00:00Z
---

# Prototype is the canonical artifact AND coordination dashboard

**Summary.** The prototype web app serves as both the product artifact (strategy + design + current-state panels) and the coordination dashboard (`/atelier` route with role-aware lenses).

**Rationale.** Eliminates a second dashboard surface. Forces artifact and coordination to co-evolve under one design system, one nav, one deploy. Makes the analyst case work — they already visit the prototype to see strategic context; coordination is right there. Avoids the duplication cost of a separate hive-dashboard app.

**Consequences.** Every feature that would have lived in a separate dashboard gets a route or component inside the prototype. Role-based auth affects what renders at `/atelier`. Five routes total: `/`, `/strategy`, `/design`, `/slices/[id]`, `/atelier`, `/traceability`.
