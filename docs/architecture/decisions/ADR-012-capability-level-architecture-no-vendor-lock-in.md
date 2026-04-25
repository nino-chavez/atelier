---
id: ADR-012
trace_id: BRD:Epic-1
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:00:00Z
---

# Capability-level architecture; no vendor lock-in

**Summary.** All architecture documents describe capabilities (versioned file store, relational datastore, pub/sub broadcast, identity service, vector index, serverless runtime, static hosting, agent interop protocol). Vendor choice is an implementation decision.

**Rationale.** Self-hosted OSS means teams have heterogeneous compliance constraints, hosting preferences, and existing stacks. Architecture that presumes specific vendors (e.g., Supabase, Vercel) excludes teams that can't use them. Capability-level architecture allows any conforming stack.

**Consequences.** Documentation uses capability terms, not vendor names. Reference implementation will pick a specific stack but document it as one valid choice. Adapter interfaces exist for every external system class.
