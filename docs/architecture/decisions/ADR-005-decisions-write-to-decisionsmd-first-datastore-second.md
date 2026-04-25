---
id: ADR-005
trace_id: BRD:Epic-5
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T14:25:00Z
---

# Decisions write to decisions.md first, datastore second

**Summary.** `log_decision` is a four-step atomic operation: (1) append to `decisions.md` in repo, (2) insert row in datastore decisions table, (3) generate embedding and upsert to vector index, (4) broadcast via pub/sub. Step 1 is the sole success criterion. Steps 2–4 are retried on failure.

**Rationale.** Makes graceful degradation real. Datastore outage cannot lose decision rationale. Vector-index outage cannot lose the decision either — keyword fallback continues to work. The repo is the canonical source of truth; the datastore is a read-model.

**Consequences.** `log_decision` implementation enforces ordering. CI check validates repo/datastore sync on every push. Reversals are new decisions with `reverses` frontmatter.
