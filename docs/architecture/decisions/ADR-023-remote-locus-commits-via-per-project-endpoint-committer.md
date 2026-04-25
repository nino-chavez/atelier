---
id: ADR-023
trace_id: BRD:Epic-16
category: architecture
session: walk-analyst-week-1-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T16:10:00Z
---

# Remote-locus commits via per-project endpoint committer

**Summary.** Remote-locus composers (locus=web; terminal sessions without repo access) write to the repo via a per-project endpoint git committer. Commits authored as `<composer.display_name> via Atelier <atelier-bot@<project>>` with `Co-Authored-By: <composer email>`. `update` blocks until commit succeeds; on failure, datastore is not updated and tool returns a retry-safe error. Audit log captures `(commit_sha, composer_id, session_id)`.

**Rationale.** Surfaced by the analyst-week-1 walk (`walks/analyst-week-1.md` Gap #2). ARCH §6.2 implies agents write to artifacts, but a web-locus analyst has no local filesystem — the endpoint must commit on their behalf. Identity, signing, failure handling, and sync timing were unspecified, leaving both a security gap and a durability gap. Synchronous commit by a per-project committer with composer co-authorship preserves attribution, keeps repo-first semantics (ADR-005), and bounds failure to retry-safe states.

**Consequences.** New ARCH §7.8 — Remote-locus write attribution. Endpoint holds a project-scoped deploy key, rotatable via `atelier rotate-committer-key`. Audit log queryable in `/atelier/observability`. Datastore mirror only follows successful commit. CLI gains the rotation subcommand.
