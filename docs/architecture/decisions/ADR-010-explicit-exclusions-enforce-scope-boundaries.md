---
id: ADR-010
trace_id: BRD:Epic-1
category: product
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:50:00Z
---

# Explicit exclusions enforce scope boundaries

**Summary.** Atelier is explicitly NOT: a SaaS, an agent framework, a workflow engine, a task tracker UI, a chat app, a code editor, a design tool, a doc editor, a wiki, a messaging platform. Each external tool remains canonical for its thing.

**Rationale.** Without explicit scope boundaries, products drift into adjacent categories as users request features. Drift destroys the destination. Atelier is the spine that connects tools, not a replacement for any.

**Consequences.** Feature requests are rejected when they would push Atelier into an adjacent category. Documentation makes the boundaries explicit. Integration work respects the "remains canonical" principle — external tools' own primitives are not duplicated in Atelier.
