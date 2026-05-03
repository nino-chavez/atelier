---
id: ADR-050
trace_id: BRD:Epic-12
category: architecture
session: design-session-2026-05-03
composer: nino-chavez
timestamp: 2026-05-03T17:30:00Z
---

# Endpoint error telemetry + diagnose_failure semantics

**Summary.** v1.x adds `diagnose_failure(trace_id)` as an MCP tool that walks the failure path: error telemetry → contributions referencing the trace_id → decisions referencing the trace_id → reversal chain. Prerequisite: the dispatcher's `mapError` path must write to `telemetry` (post-auth errors only — pre-auth failures lack `project_id` and go to system logs). `AtelierClient.recordTelemetry` is currently `private`; a public `recordError` method exposes it for the endpoint layer.

**Rationale.** Atelier is uniquely positioned to do *decision-grounded debug*. Every architectural choice is an ADR with a trace_id. Every contribution carries trace_ids. Every error in production *could* carry a trace_id linking it back to the decisions and contributions that produced the failing code path. No other system in the workspace has this graph.

Today's failure-path observability:
- The endpoint dispatcher returns `AtelierError` wire shape on failure (`scripts/endpoint/lib/dispatch.ts`, `mapError` function at line 178). **Errors are NOT written to `telemetry`.** Successful operations write `outcome='ok'` rows; failures vanish from telemetry.
- ADRs and contributions ARE indexed by trace_id (`text[]` with GIN per ADR-021). The data exists; the query path doesn't.
- An operator debugging a production failure has the error wire response and the application logs. They do not have a single MCP-callable surface that walks the trace_id graph.

`diagnose_failure(trace_id)` returns:
- The most recent error telemetry row(s) for that trace_id within a time window
- All contributions referencing the trace_id, in state order (terminal first)
- All decisions referencing the trace_id, oldest first
- Any reversal chain (`reverses: ADR-N` frontmatter walked transitively)
- Optional: linked contributions via `triggered_by_contribution_id` (per ADR-037)

This produces a "failure path" — what was decided, what was built, what failed, and what reversed what.

**Rationale for telemetry write-through.**

The dispatcher's `mapError` function is purely transformational: error → wire shape. It has no DB access. Adding telemetry write requires either:

(a) Refactoring `mapError` to take `deps` + `auth` parameters and write before mapping
(b) Wrapping error throws inside dispatch's outer `try/catch` (line 109-114) with a telemetry write before calling `mapError`

Option (b) is preferred — `mapError` stays pure (testable in isolation), and the telemetry write lives at the dispatcher's boundary where `auth` is in scope.

The telemetry row uses `outcome='error'` and `metadata` jsonb carries `{error_code, error_message, request_body_keys}`. Body content is NOT logged (security: bearer tokens, identifiers); only the *shape* of the request that failed.

**Pre-auth errors are not telemetry-logged.** The auth path (line 100-107) catches before `auth: AuthContext` is set. `telemetry.project_id` is `NOT NULL`; we cannot write a project-scoped row without a project. Pre-auth failures (invalid bearer, expired token, wrong project subject) go to the system log only. This is correct — pre-auth failures are operator/identity concerns, not project-coordination concerns.

**Consequences.**

- **`AtelierClient.recordTelemetry` becomes public** (or: a new public `recordError` method delegates to it with sensible defaults for the error case). The private encapsulation served the in-class write pattern; the dispatcher needs cross-class access. One-line privacy change OR ~10-line wrapper method.
- **Dispatch error path gains 1 telemetry write per error.** Negligible perf cost (single insert; same connection pool as the failing operation). Failures to write telemetry are caught and swallowed — telemetry write must NEVER block the error response (per ADR-005 invariant family: canonical operation result is the contract; observability is downstream).
- **Schema: no change.** Existing telemetry table fields are sufficient (`action` = MCP tool name, `outcome='error'`, metadata jsonb).
- **`diagnose_failure` returns a structured payload** (not a markdown report). The shape:
  ```ts
  {
    trace_id: string,
    error_telemetry: TelemetryRow[],
    contributions: ContributionSummary[],   // referencing trace_id
    decisions: DecisionSummary[],            // referencing trace_id
    reversal_chain: DecisionSummary[],       // walked from decisions
    linked_contributions: ContributionSummary[]  // via triggered_by_contribution_id
  }
  ```
- **MCP surface expansion.** Same governance as ADR-048 — surface grows at v1.x; `dispatch.ts` TOOL_NAMES expands; the compile-time count assertion updates.
- **Operator UX.** The `/atelier/observability` route gains a "diagnose by trace_id" panel calling `diagnose_failure`. The CLI gains `atelier diagnose <trace_id>` (v1.x — added to the §9 CLI sequencing convention).
- **No retroactive backfill of error telemetry.** Pre-v1.x errors are not in telemetry and won't appear in `diagnose_failure` results. Documented as a known limitation in the diagnose response (`error_telemetry_window_started_at`).

**Alternatives considered.**

- *Separate `endpoint_errors` table instead of using `telemetry`.* Rejected: telemetry is the existing per-action audit; errors are actions that didn't complete. Conceptually `outcome='error'` IS what telemetry's outcome field is for. A second table would be schema sprawl.
- *Log errors only at the application logger level (no telemetry).* Rejected: application logs are not project-scoped and not queryable from MCP. The whole point of `diagnose_failure` is project-scoped, MCP-queryable failure paths.
- *Synchronous telemetry write blocking the error response.* Rejected: error responses must return promptly. Async write with `.catch(() => {})` is the right pattern (matches ADR-005's downstream-broadcast invariant).
- *Include request body in metadata.* Rejected: bearer tokens and PII concerns. Body keys (top-level field names) capture the shape without leaking content.

**Build prerequisites.**

- Make `recordTelemetry` accessible from outside `AtelierClient` (privacy change OR new public wrapper method)
- Edit `dispatch.ts` outer try/catch to write error telemetry before calling `mapError` (post-auth path only)
- New handler `diagnoseFailure` in `handlers.ts` running the trace-graph query
- Surface declaration in `dispatch.ts` (governed per ADR-048's expansion ADR pattern)
- Smoke test: trigger a known failure, call `diagnose_failure`, assert the failure appears in `error_telemetry` and any referencing contributions/decisions appear in the result
- `/atelier/observability` route component for the diagnose panel (separate PR)

**Why this lands at v1.x, not v1.** Observability hardening is not a v1 critical path — the smoke tests + IA/UX suite at M7 exit cover correctness; this tool covers diagnosability *after* a production deployment generates failure events worth diagnosing. Adopter signal: first sustained production deployment requesting failure-path observability, OR first M6+ build session where a non-trivial endpoint failure goes uninvestigated for >1 hour because the trace_id graph wasn't queryable.

**Trace.** Resolves the failure-path observability gap noted in M7 follow-ups (BRD Epic 12 / observability). Documented at v1 exit per BUILD-SEQUENCE §5.5; built when adopter signal triggers. ADR-021 (multi-trace), ADR-005 (canonical-vs-downstream invariant), ADR-036 (immortal author identity for error attribution), ADR-037 (triggered_by link) are load-bearing context.
