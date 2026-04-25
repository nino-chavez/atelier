---
id: ADR-019
trace_id: BRD:Epic-10
category: design
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:35:00Z
---

# Figma is feedback surface, not design source

**Summary.** Design components live in the prototype (repo-canonical). Figma receives projections of components. Comments on Figma projections flow back through triage.

**Rationale.** Repo-as-canonical applies to design. Figma is to design as Confluence is to BRDs — feedback surface, not authority. Avoids the "design lives in two places" drift.

**Consequences.** `publish-design.mjs` ships components to Figma with trace-ID metadata. Figma webhook triages comments to proposals. Designers author in the prototype (component primitives) with Figma as a review companion.
