# Ops

**Audience question:** How do I self-host Atelier and keep it running?

**Primary tier served:** Tier 1 — Reference Deployment operators.

## Status

**Pre-M7.** Empty placeholder. Self-host operational docs land here at M7 per [`../strategic/BUILD-SEQUENCE.md`](../strategic/BUILD-SEQUENCE.md).

## Contents (planned)

| Path | Purpose | Lands at |
|---|---|---|
| `deploy/vercel-supabase.md` | Reference stack deploy runbook (per ADR-027) | M7 |
| `deploy/gcp.md` | GCP deploy runbook (per ADR-029 portability constraint) | M7 |
| `migration/vercel-to-gcp.md` | Migration runbook (per ADR-029) | M2 (initial) / M7 (polished) |
| `observability.md` | Observability setup, dashboards, alerts (per Epic 12) | M7 |
| `incident-response/stuck-locks.md` | Recover from a stuck lock | M7 |
| `incident-response/fit-check-degraded.md` | Recover when vector index is unavailable (per US-6.5 keyword fallback) | M7 |
| `incident-response/session-reaper.md` | Tune the session reaper, recover from over/under-reaping | M7 |
| `token-rotation.md` | Rotate composer tokens (per US-13.6) | M7 |

## Related layers

- For tier-2 readers running locally for development: [`../developer/setup.md`](../developer/) (populates at M2/M3)
- For tier-1 readers deploying for the first time: [`../user/tutorials/getting-started.md`](../user/tutorials/) (populates at v1)
