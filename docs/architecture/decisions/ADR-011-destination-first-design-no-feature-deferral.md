---
id: ADR-011
trace_id: BRD:Epic-1
category: convention
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:55:00Z
---

# Destination-first design; no feature deferral

**Summary.** The complete v1 design scope is specified in `../../strategic/NORTH-STAR.md`. No phasing in the design docs. No "Phase 2" or "coming soon." Build order is separate from design scope.

**Rationale.** Feature-at-a-time building creates drift. Big-blueprint's methodology exists specifically to counter this. Atelier applies its own methodology to itself.

**Consequences.** `../../strategic/NORTH-STAR.md` covers every capability at v1. Subordinate docs (`../../functional/PRD.md`, `../../functional/BRD.md`, `../ARCHITECTURE.md`) expand but do not scope-reduce. Build sequencing is planning-level; it doesn't appear in design docs.
