---
id: ADR-027
trace_id: BRD:Epic-1
category: architecture
session: stack-pick-2026-04-25
composer: nino-chavez
timestamp: 2026-04-25T10:00:00Z
---

# Reference implementation stack: GitHub + Supabase + Vercel + MCP

**Summary.** The Atelier reference implementation uses GitHub (versioned file store), Supabase (Postgres + Realtime + Auth + pgvector for relational datastore + pub/sub + identity + vector index), Vercel (Functions + Hosting + Cron for serverless runtime + static hosting + scheduled jobs), and MCP (agent interop protocol). This is **one valid implementation**, not the architecture (per ADR-012). Each capability remains capability-level in `../../strategic/NORTH-STAR.md` §13 and `../ARCHITECTURE.md`.

**Capability mapping:**

| Capability (NORTH-STAR §13) | Reference choice | Why |
|---|---|---|
| Versioned file store | GitHub | Existing repo; deploy keys for ADR-023 endpoint committer; widest agent-client compatibility |
| Relational datastore | Supabase Postgres | RLS-native (matches ARCH §5.3), GIN indexes for ADR-021 trace_ids, hosts the next three capabilities as extensions |
| Pub/sub broadcast | Supabase Realtime | Built on Postgres NOTIFY/LISTEN; no extra service; client SDKs already MCP-friendly |
| Identity service | Supabase Auth | Resolves D23 — see ADR-028. Bundled with datastore, OIDC federation, RLS integration |
| Vector index | pgvector on Supabase | No extra service; sufficient for documented scale envelope (BRD-OPEN-QUESTIONS §7) |
| Serverless runtime | Vercel Functions | Bundled with static hosting; Node runtime matches the inherited hackathon-hive code; GitHub integration |
| Static hosting | Vercel | CI/CD from GitHub push; edge network; one provider for hosting + functions |
| Protocol | MCP (streamable-http) | ADR-013, ADR-019 |
| Cron / scheduled | Vercel Cron Jobs | Per-script schedule for reaper, mirror-delivery, reconcile (ARCH §6.5); keeps Postgres lean |
| Observability sink | OpenTelemetry → local `telemetry` table (default) | Schema-resident default per ARCH §5.1; pluggable external (Honeycomb/Datadog/etc.) |

**Rationale.** The "evolve hackathon-hive in place" approach (strategic-direction conversation, 2026-04-24) already implies Supabase + Vercel + MCP — hackathon-hive runs on this stack today, with the fencing-token, fit_check, and `decisions.md` writer gaps that Atelier's v1 fixes. Adopting hackathon-hive's stack for the reference impl avoids an unnecessary stack-rewrite cost on top of the methodology fix-up cost. The stack also consolidates four NORTH-STAR §13 capabilities (datastore + pub/sub + identity + vector) into a single managed Postgres surface, which matches Atelier's "self-hosted, low operational burden" goal.

The reference stack is **not** privileged in any architecture doc. ADR-012 (capability-level architecture, no vendor lock-in) is reaffirmed: any of the 10 capabilities can be swapped without architectural change. This ADR documents the choice for the reference impl only.

**Consequences.** `../../strategic/BUILD-SEQUENCE.md` M2 onward implements against this stack. `.atelier/config.yaml` env-var bindings get reference comments naming the default vendor. M7 hardening tasks (D22, D23, D24) collapse: D22 resolved (own-impl, ADR-026), D23 resolved (Supabase Auth, ADR-028), D24 still OPEN until M5 prep. `atelier init` deploy story targets this stack as the one-command default.

**Re-evaluation triggers.**
- Supabase pricing or RLS-policy ceiling materially changes: re-pick datastore.
- Vercel runtime / pricing ceiling: re-pick serverless + hosting.
- pgvector p95 degrades past the documented scale envelope: re-pick vector index.
