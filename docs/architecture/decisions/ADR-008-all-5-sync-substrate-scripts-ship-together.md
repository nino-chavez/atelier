---
id: ADR-008
trace_id: BRD:Epic-9
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:40:00Z
---

# All 5 sync substrate scripts ship together

**Summary.** `publish-docs`, `publish-delivery`, `mirror-delivery`, `reconcile`, and `triage` all ship at v1. No phased rollout.

**Rationale.** Destination-first design (ADR-011). Teams adopting a phase-1 substrate develop usage patterns that phase-2 adds may not fit. Shipping all five at v1 means teams see the full shape from the beginning.

**Consequences.** v1 scope is larger than a phased rollout. Testing and documentation cover all five. Adapter interface must be ready for all externally-connected scripts at v1.
