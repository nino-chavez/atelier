---
id: ADR-030
trace_id: BRD:Epic-1
category: methodology
session: doc-organization-2026-04-25
composer: nino-chavez
timestamp: 2026-04-25T13:00:00Z
---

# Per-ADR file split — DECISIONS.md becomes a directory

**Summary.** The single-file `.` is split into one file per ADR under `docs/architecture/decisions/`. File naming: `ADR-NNN-<slug>.md` (e.g., `ADR-001-prototype-canonical-artifact.md`). An index/TOC lives at `docs/architecture/decisions/README.md`. The original `.` at root is removed; CLAUDE.md and traceability.json are updated to reference the new location.

**Rationale.** At 29 ADRs (and growing — 32 after this PR), the single-file scroll causes three real problems: (1) per-ADR PR diffs are obscured by the file's full content, (2) `git blame` on an ADR returns the latest mass edit, not the ADR's authorship, (3) cross-doc references can only target the file (`DECISIONS.md#adr-021`) not a stable per-ADR URL. The toolkit's `docs/architecture/decisions/` pattern solves all three. Reading order is preserved by the index README. Append-only discipline (ADR-005) is preserved by convention: a new ADR is a new file; existing files are never edited (reversals create new files referencing old).

**Consequences.**
- 29 existing ADRs become 29 files; ADR-030, ADR-031, ADR-032 become files at the same time.
- `decisions/README.md` is the canonical index — listed in chronological order with one-line summary per ADR + status (active / reversed / superseded).
- ADR-005 ("decisions write to repo first") still holds; "the repo" now means "the directory" for new ADRs. The `log_decision` MCP tool (US-2.11) writes to a new file in the directory, not appends to the old single file.
- Every cross-reference to `DECISIONS.md#adr-NNN` becomes `docs/architecture/decisions/ADR-NNN-<slug>.md`. Mechanical sweep across CLAUDE.md, README.md, BUILD-SEQUENCE.md, PRD-COMPANION.md, BRD-OPEN-QUESTIONS.md, walks/, and traceability.json.
- The CI traceability validator (M1) treats the directory as the source of truth.
- Future tooling (`/atelier/decisions` route, fit_check vector index) ingests the directory, which is simpler than parsing one large file.

**Re-evaluation triggers.**
- ADR count drops below 10 (split overhead exceeds value).
- A future tool requires single-file ADR storage (unlikely; modern tooling assumes per-file).
