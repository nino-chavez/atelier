---
id: ADR-003
trace_id: BRD:Epic-4
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:15:00Z
---

# scope_kind generalized from day one

**Summary.** Territory `scope_kind` is one of five values at v1: `files`, `doc_region`, `research_artifact`, `design_component`, `slice_config`. Not "files first, extend later."

**Rationale.** The analyst case and the designer case require non-file scopes at v1. Retrofitting the schema is more expensive than shipping generality on day one. Non-code territories are first-class.

**Consequences.** Territories table has `scope_kind` column with enum at creation. Lock and contribution code branches on `scope_kind` for artifact resolution. Documentation and eval set cover all five kinds.
