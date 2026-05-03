# Ops

**Audience question:** How do I self-host Atelier and keep it running?

**Primary tier served:** Tier 1 — Reference Deployment operators.

## Status

**Partially populated.** Some operational docs landed in adjacent locations during M2-M7 build-out and were not moved here. This README points at the live runbooks; the `docs/ops/` tree itself remains thin until adopter signal informs which v1.x runbooks are most needed.

## Live operational docs (cross-tree)

| Concern | Location |
|---|---|
| Deploy reference stack (Vercel + Supabase Cloud per ADR-046) | [`../user/tutorials/first-deploy.md`](../user/tutorials/first-deploy.md) |
| Local-stack bringup | [`../user/tutorials/local-bootstrap.md`](../user/tutorials/local-bootstrap.md) |
| Migration to GCP (per ADR-029 portability constraint) | [`../migration-to-gcp.md`](../migration-to-gcp.md) |
| Bearer rotation | [`../user/guides/rotate-bearer.md`](../user/guides/rotate-bearer.md) |
| Auto-deploy enablement | [`../user/guides/enable-auto-deploy.md`](../user/guides/enable-auto-deploy.md) |
| Observability setup + dashboards | `/atelier/observability` route in deployed prototype (admin-gated per ARCH 8.2) |
| MCP client connectors | [`../user/connectors/`](../user/connectors/) (claude-code, claude-ai, cursor, chatbot-pattern) |

## v1.x adopter-signal-triggered runbooks

These were planned at M7 but not authored — adopter signal will inform which land first:

| Path | Purpose | Trigger |
|---|---|---|
| `incident-response/stuck-locks.md` | Recover from a stuck lock | First operator-reported stuck-lock incident |
| `incident-response/find-similar-degraded.md` | Recover when vector index is unavailable (per US-6.5 keyword fallback) | First find_similar degraded-mode incident |
| `incident-response/session-reaper.md` | Tune the session reaper, recover from over/under-reaping | First reaper-tuning ask |
| `token-rotation.md` | Rotate composer tokens (per US-13.6) — distinct from bearer rotation above | First token-rotation ask beyond the bearer flow |

## Related layers

- For tier-2 readers running locally for development: [`../developer/fork-and-customize.md`](../developer/fork-and-customize.md)
- For tier-1 readers deploying for the first time: [`../user/tutorials/local-bootstrap.md`](../user/tutorials/local-bootstrap.md) (local) or [`../user/tutorials/first-deploy.md`](../user/tutorials/first-deploy.md) (cloud)
