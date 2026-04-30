---
last_updated: 2026-04-29
status: M1 done; M2 not yet started
sunset_at: M2 (replaced by `get_context` per US-2.4)
---

# Session checkpoint

Ephemeral session-to-session state. Not canonical — see `../../docs/methodology/METHODOLOGY.md §6.1` for doc organization.

This file is a **pre-M2 stand-in for `get_context`**. Once the 12-tool endpoint ships at M2, this file is retired and session continuity becomes a protocol primitive.

---

## Where we are

- **Phase:** **M1 done** as of 2026-04-29. Audit at `../../docs/architecture/audits/milestone-M1-exit.md`. Implementation across 8 commits (`0a283b2..0f9b8c4`): four-table schema + supporting tables, internal write library (claim/update/release/logDecision + locks + sessions), five sync scripts + event bus + adapter interface, GitHub adapter + delivery_sync_state, round-trip integrity test (M1 exit gate; 6 doc classes), schema-invariants smoke (ADR-005 / RLS / ADR-036 / fencing / ADR-035), traceability validator + CI workflow, milestone-exit drift sweep doc.
- **Last milestone done:** M1 per `../../docs/strategic/BUILD-SEQUENCE.md`.
- **Test totals at M1 exit:** 170 assertions across 6 smoke suites + 43 canonical files round-trip clean. All green against single fresh DB reset. CI workflow at `.github/workflows/atelier-audit.yml` runs the same suite on every PR.
- **Stack locked:** GitHub + Supabase + Vercel + MCP, GCP-portability constrained (ADR-027/028/029).
- **Three-tier consumer model:** Specification / Reference Implementation / Reference Deployment, all first-class at v1 (ADR-031).
- **Open strategic decisions:** D24 (embedding model default -- M5 entry); plan_review checkpoint per BRD-OPEN-QUESTIONS section 19 (wants resolution before M2 endpoint work).
- **M2-entry follow-ups from M1 exit audit (per `../../docs/architecture/audits/milestone-M1-exit.md`):**
  - **F1 (HIGH; gateway for M2 entry):** Build-registry script (`scripts/traceability/build-registry.ts`) populates `traceability.json` `entries[]` with US-X.Y stories from BRD.md. Closes 278 trace_id_resolution failures + the empty traceability_coverage check + lets the validator's `--per-pr` mode become a hard CI gate.
  - **F2 (MEDIUM):** edges[] derivation by build-registry per scripts/README.md "graph-ready from M1" (paired with F1).
  - **F3, F4, F5 (LOW):** see audit doc.

## What the next session should do first

**M2 entry. M1 is closed; do not re-implement M1 work.**

1. Read `../../CLAUDE.md` (the agent charter) and `../../docs/architecture/audits/milestone-M1-exit.md` (M1 exit state + outstanding follow-ups).
2. **Run METHODOLOGY 11.5 data-model + contract audit at M2 entry** before any M2 implementation. M2 ships the remaining schema (composers/sessions/locks/contracts/telemetry are now in DB; the 12-tool endpoint is what's new at M2). Audit catches semantic conflations and constraint gaps while still cheap to fix.
3. **Land F1 (build-registry) first.** It's the gateway item -- closes the validator's per-PR gate and unblocks rigorous CI on every M2 PR thereafter. Scope per scripts/README.md "Structure" section: scan `docs/functional/BRD.md` US-X.Y headings, scan `docs/architecture/decisions/ADR-NNN-*.md` frontmatter, derive entries[] + edges[] per scripts/README.md "graph-ready from M1". The current `traceability.json` is hand-authored and the audit identified this as the single root cause of two sweep-area drifts.
4. After F1, M2's primary deliverable per `../../docs/strategic/BUILD-SEQUENCE.md` M2 section: 12-tool MCP endpoint surface + remaining schema tables landing on the M1 substrate.
5. Open questions to resolve in-flight at M2 entry: **§19 (plan_review)** wants resolution before contribution-lifecycle endpoint work.

**Do NOT:**
- Re-implement M1 deliverables; reach out to existing modules at `scripts/sync/lib/write.ts`, `scripts/sync/lib/event-bus.ts`, `scripts/sync/lib/adapters.ts`, `scripts/sync/lib/github.ts`. The endpoint at M2 wraps the write library, not replaces it.
- Edit migrations 1, 2, or 3. New schema lands in migration 4+.
- Add new MCP tools beyond the 12 locked at v1 per ADR-013.
- Re-author audit findings already documented in `milestone-M1-exit.md`. The audit is canonical for M1 exit state.

## Drift discipline

Do **not** copy ADR counts, decision counts, route counts, or other state-derived numbers into this file. Refer to canonical state; don't replicate. (See `../../docs/methodology/METHODOLOGY.md §6.1` for the no-parallel-summary rule and the worked example.)

If something feels wrong while reading the canonical docs, file a `../../docs/functional/BRD-OPEN-QUESTIONS.md` entry rather than silently fixing it.
