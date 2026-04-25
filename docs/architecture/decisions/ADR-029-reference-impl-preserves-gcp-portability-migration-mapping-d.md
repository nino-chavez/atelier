---
id: ADR-029
trace_id: BRD:Epic-1
category: architecture
session: portability-constraint-2026-04-25
composer: nino-chavez
timestamp: 2026-04-25T11:00:00Z
---

# Reference impl preserves GCP-portability; migration mapping documented

**Summary.** The Atelier reference implementation (per ADR-027: Supabase + Vercel) is constrained at v1 to use only features with documented GCP equivalents. Any deviation (Supabase Realtime, Vercel-specific runtime APIs, Supabase Edge Functions, Vercel KV, etc.) is wrapped in a thin abstraction so a future GCP migration is mechanical, not architectural. ADR-027 is reaffirmed; this ADR adds a constraint, not a reversal.

**Rationale.** The stack-pick conversation (2026-04-25) settled on Vercel + Supabase for v1 ergonomics with an explicit forward-looking constraint: GCP migration must remain a viable future option. Without portability discipline, the reference impl accumulates Supabase/Vercel-specific code (Realtime channels, Vercel KV, Edge Config, Supabase Edge Functions, RPC helpers) that compounds migration tax. Constraining now keeps migration cost bounded — the cost is one small abstraction layer in M2 around the two amber capabilities (Realtime, Auth claim helpers) and a "no proprietary imports" discipline elsewhere.

**Per-capability portability mapping:**

| Capability | Supabase/Vercel feature | GCP equivalent | Portability | Action for v1 |
|---|---|---|---|---|
| Relational datastore | Supabase Postgres (standard PG 15+) | Cloud SQL for Postgres | Direct | Use standard Postgres only; no Supabase RPC functions outside `BroadcastService` |
| RLS | Postgres RLS policies | Postgres RLS policies | Direct | RLS SQL is portable as-is |
| Identity | Supabase Auth (signed JWTs) | Identity Platform (signed OIDC JWTs) | Partial | Atelier verifies JWT via OIDC standard; reads `sub`/`email`/`role` only. No Supabase claim helpers. User re-import is a one-time migration step |
| Pub/sub | Supabase Realtime | NOTIFY/LISTEN + WebSocket adapter | Wrappable | Wrap in `BroadcastService` interface; reference impl uses Realtime; migration impl uses NOTIFY-based handler on Cloud Run |
| Vector | pgvector on Supabase | pgvector on Cloud SQL | Direct | pgvector is the abstraction |
| Serverless runtime | Vercel Functions (Node) | Cloud Run (Node container) | Direct (with constraint) | No `@vercel/edge`, `@vercel/kv`, Edge Config, or Vercel-specific globals. Node-standard only. Cloud Run packaging is one Dockerfile away |
| Static hosting | Vercel | Cloud Storage + Cloud CDN | Direct | Static output is framework-portable |
| Cron | Vercel Cron | Cloud Scheduler → HTTPS endpoints | Direct | Cron handlers are HTTPS endpoints; same shape under both |
| Observability | OpenTelemetry → telemetry table | Cloud Logging via OTEL collector | Direct | OTEL is the abstraction; sink swap is config |

**Consequences.**
- M2 introduces a `BroadcastService` interface. Default impl: Supabase Realtime. Documented migration impl: Postgres NOTIFY/LISTEN with a WebSocket adapter suitable for Cloud Run.
- M2/M3 code uses standard Node + OIDC JWT verification. Imports from `@vercel/*` (other than the framework's own) and Supabase RPC helpers are banned outside named adapters. A lint rule enforces this in M7 hardening.
- Migration runbook ships with v1 as `docs/migration-to-gcp.md` once M2 lands (or earlier if useful for testing the constraint).
- ADR-027 stack pick stays. This ADR adds the rule that keeps that pick reversible.

**Re-evaluation triggers.**
- GCP discontinues Cloud SQL Postgres or Identity Platform.
- Atelier's user base shows zero migration interest after 12 months in production (then this constraint may be paying carrying cost for no benefit).
- Vercel or Supabase ships a feature so compelling that its absence breaks the v1 value prop (re-open and weigh).
