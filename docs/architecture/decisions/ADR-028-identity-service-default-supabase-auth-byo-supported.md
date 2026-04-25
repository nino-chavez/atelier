---
id: ADR-028
trace_id: BRD:Epic-13
category: architecture
session: stack-pick-2026-04-25
composer: nino-chavez
timestamp: 2026-04-25T10:15:00Z
---

# Identity service default: Supabase Auth (BYO supported)

**Summary.** Atelier's reference identity service is Supabase Auth. Resolves D23 (`../../functional/PRD-COMPANION.md`) and BRD-OPEN-QUESTIONS §5. Teams can override with any OIDC-compliant identity provider (Auth0, Clerk, self-hosted Keycloak, etc.) via `.atelier/config.yaml: identity.provider`.

**Rationale.** Sub-decision of ADR-027 (reference stack). Once Supabase is the datastore choice, Supabase Auth is the path of least operational resistance: it ships with the datastore, issues signed JWTs that match ARCH §7.1 token semantics, integrates natively with row-level security (matches ARCH §5.3 and §7.2), and supports OIDC federation for SSO-having teams. Alternatives (Auth0, Clerk) are equally capable but add a second managed dependency on every deploy. Self-hosted OIDC (Keycloak, Hydra) is a heavier operational commitment than a v1 reference should impose.

The "BYO" framing matters: Atelier is template-and-protocol-first. A team may already run Auth0 or Keycloak — Atelier should not force a swap. The default is what `atelier init` provisions; the override is a config switch.

**Consequences.** `.atelier/config.yaml` gains `identity:` section with `provider: supabase-auth` default. ARCH §7.1 references this default explicitly while keeping the identity-service capability vendor-neutral. CLI gains `atelier identity provision` for first-run setup. Token rotation flow uses Supabase's session-management primitives. M2/M3 auth wiring proceeds against this default.

**Re-evaluation triggers.**
- Supabase Auth deprecation or breaking JWT-claim change.
- Adoption pattern shifts: if >50% of `atelier init` users override identity, reconsider whether the default is worth carrying.
