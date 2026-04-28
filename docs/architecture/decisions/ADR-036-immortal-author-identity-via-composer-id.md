---
id: ADR-036
trace_id: BRD:Epic-2
category: architecture
session: pre-m1-data-model-audit-2026-04-28
composer: nino-chavez
timestamp: 2026-04-28T16:45:00Z
---

# Immortal author identity via composer_id; session_id is operational only

**Summary.** Tables that record authorship gain an immortal `author_composer_id` (FK to composers, NOT NULL when the row represents committed work) alongside the existing operational `session_id` (FK nullable, SET NULL on session deletion). The session reference captures "which session was holding it during work"; the composer reference captures "who authored it" and survives session cleanup.

**Rationale.**

Surfaced by `pre-M1-data-model-audit.md` findings F9, F10, F15, F18.

The reaper (ARCH 6.1.2) deletes session rows older than `policy.session_dead_retention_seconds` (default 24 hours). Before this ADR, several tables held FK references to `sessions.id` that needed to outlive that retention window:

- `contributions.author_session_id` -- merged contributions retain the session that did the work; broken FK after 24 hours.
- `decisions.session_id` -- decisions cite the session that logged them; broken FK after 24 hours.
- `telemetry.session_id` -- telemetry events reference the originating session; broken FK after 24 hours.
- `locks.session_id` -- in practice released by the reaper at session-death (ARCH 6.1) before the row deletion, but the FK semantics weren't specified; an implementation defect could leave dangles.

Three options were available without this ADR, none acceptable:

- **CASCADE delete** -- deletes all merged contributions when their session is reaped. Catastrophic data loss.
- **REJECT delete** -- prevents session cleanup as long as any merged work references it. Defeats the cleanup policy; sessions accumulate indefinitely.
- **SET NULL** -- preserves rows but loses authorship attribution forever. Acceptable for some, not all.

**Decision.**

Authorship is split into two references with different durability guarantees:

- **`author_composer_id`** (FK to composers, NOT NULL when row represents committed work) -- the immortal authorship reference. Composers persist as long as they exist on the team; FK is durable.
- **`session_id`** (FK to sessions, nullable, ON DELETE SET NULL) -- the operational reference for "which session was active during the work". May dangle to NULL after session reap.

Applied to four tables:

| Table | Field added | Existing field behavior |
|---|---|---|
| `contributions` | `author_composer_id` (NOT NULL when state > open) | `author_session_id` becomes ON DELETE SET NULL |
| `decisions` | `author_composer_id` (NOT NULL) | `session_id` becomes ON DELETE SET NULL |
| `telemetry` | `composer_id` (nullable -- some events are system-emitted) | `session_id` ON DELETE SET NULL (already nullable) |
| `locks` | `holder_composer_id` (NOT NULL) | `session_id` ON DELETE SET NULL (defense in depth -- reaper releases first) |

**Authorship queries** ("who authored this") use the `*_composer_id` fields and are durable.

**Operational queries** ("which session was holding this lock at the time of acquisition") use the `*_session_id` fields and gracefully null out as sessions are cleaned up.

**Lock specifics.** Per ARCH 6.1, the reaper releases (deletes) all locks held by a session at session-death, before the session row itself is deleted (24h post-reap). In normal operation `locks.session_id` is never observed dangling because the lock row is gone first. The ON DELETE SET NULL is defense-in-depth for implementation defects.

**Consequences.**

- ARCH 5.1 schema updated for all four tables.
- ARCH 5.3 authorization rules unchanged at the conceptual level: writes are still session-scoped (the calling session's composer must match `author_composer_id`); reads still project-scoped via RLS.
- ARCH 6.2.1 atomic-create populates `author_composer_id` from the calling session's composer.
- ARCH 6.3 log_decision populates `decisions.author_composer_id` from the calling session.
- The session-reap flow (ARCH 6.1) gains an explicit step: before deleting a `status=dead` session row older than retention, NULL out `*_session_id` references in contributions, decisions, telemetry, and locks (FK ON DELETE SET NULL handles this automatically).
- /atelier observability queries that previously joined session_id to display author attribution switch to composer_id; behavior improves for historical queries.

**Migration impact.** Pre-M1 schema -- no migration needed; schema corrected before first use.

**Trade-off considered and rejected.** Make sessions append-only (never delete, only mark `status=dead`). Rejected: violates ARCH 6.1.2 session-row cleanup policy which exists to bound table growth at scale. The current decision is cheaper -- two FK fields per attribution-bearing table is light overhead and it preserves the cleanup policy's behavior.
