---
id: ADR-007
trace_id: BRD:Epic-1
category: product
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:35:00Z
---

# No multi-tenant SaaS; self-hosted OSS only

**Summary.** Atelier ships as an OSS template that teams self-host. No central Atelier service, no tenant database, no billing infrastructure at v1. Commercial surface (e.g., managed fit_check) is conditional on ADR-006's disconfirming test.

**Rationale.** Two red-team rounds converged. SDLC sync substrate is commoditized by GitHub Spec-Kit, Linear Agents, Atlassian Rovo Dev. Coordination substrate has Anthropic Agent Teams and Switchman closing file-level coordination. Production SaaS year-1 cost ~$750k–$1.2M against free incumbents is wrong math.

**Consequences.** Deployment model assumes self-host. CLI installs to team's own infrastructure. Documentation focuses on self-host recipes. Go-to-market is OSS-first with no marketing funnel until fit_check precision confirms commercial viability.
