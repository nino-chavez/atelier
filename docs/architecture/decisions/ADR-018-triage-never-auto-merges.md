---
id: ADR-018
trace_id: BRD:Epic-9
category: product
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:30:00Z
---

# Triage never auto-merges

**Summary.** External-sourced content (comments from published-doc system, delivery tracker, design tool) is classified and drafted into `kind=proposal` contributions. Proposals cannot transition to `merged` without explicit human approval recorded in the datastore.

**Rationale.** External input is unsanitized. Auto-merging violates the authority model. Proposals are the safe channel for external voices.

**Consequences.** Triage pipeline exits at proposal-created state. Merge check (both datastore policy and CI) requires human approval flag. Messaging alerts notify appropriate role when high-confidence proposals await.
