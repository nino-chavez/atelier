---
id: ADR-022
trace_id: BRD:Epic-2
category: architecture
session: walk-analyst-week-1-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T16:05:00Z
---

# Claim atomic-creates open contributions

**Summary.** `claim` overloads to support atomic create-and-claim when invoked with `contribution_id=null` plus `kind`, `trace_ids`, `territory_id`, and optional `content_stub`. Tool surface stays at 12 — ADR-013 is unaffected.

**Rationale.** Surfaced by the analyst-week-1 walk (`walks/analyst-week-1.md` Gap #1). Ad-hoc analyst research has no pre-existing `open` contribution to claim, but the 12-tool surface has no `create_contribution`. Adding one would push to 13 tools and require amending ADR-013. Overloading `claim` keeps the surface stable, makes the create+claim transaction atomic at the datastore boundary, and matches the way analyst-locus work actually flows — the act of starting research is the act of claiming it.

**Consequences.** NORTH-STAR §5 documents the dual-mode signature. ARCH §6.2 contribution lifecycle adds the create-and-claim path. A scaffold row (state=open, author_session_id=null, content_ref=null, transcript_ref=null) is inserted and immediately transitioned to claimed in one transaction. ADR-013 stands.
