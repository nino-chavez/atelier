---
last_updated: 2026-04-30
status: M2 substrate landed (entry audit + migration 4 + 12-tool dispatcher + plan-review gate); transport-adapter wrapper outstanding
sunset_at: M2 (replaced by `get_context` per US-2.4 once the transport-adapter wrapper ships and clients consume it directly)
---

# Session checkpoint

Ephemeral session-to-session state. Not canonical — see `../../docs/methodology/METHODOLOGY.md §6.1` for doc organization.

This file is a **pre-M2 stand-in for `get_context`**. The 12-tool dispatcher and `getContext` substrate landed 2026-04-30; this file retires once the Streamable HTTP transport-adapter wraps the dispatcher and clients connect.

---

## Where we are

- **Phase:** **M2 substrate landed** as of 2026-04-30. M2-entry audit at `../../docs/architecture/audits/M2-entry-data-model-audit.md` (10 findings; all resolved at landing). Implementation across this session: ADR-040 (12-tool surface consolidation per audit H2), ARCH 6.6 / 6.7 / 6.5 / 7.5 spec edits (M5 / M6), migration 4 (composers.identity_subject + audit-H1/L1 CHECKs; locks.lock_type dropped per audit M3; territories.contracts_consumed per audit M4; contribution_state += plan_review with audit-M1/M2 CHECKs per ADR-039; territories.requires_plan_review per ADR-039), F1 build-registry script (closes M1-exit follow-up F1; traceability.json now carries 188 entries + 40 edges), write.ts extensions (deregister + getContext + 4 plan-review handlers + audit-H3 release clearing), 12-tool MCP endpoint substrate at `scripts/endpoint/lib/{auth,handlers,dispatch}.ts` (TOOL_NAMES locked at 12 with compile-time check), endpoint smoke + plan-review tests at `scripts/endpoint/__smoke__/endpoint.smoke.ts` (41 assertions covering ARCH 6.1.1 + ADR-039 paths + audit H3 + 3 telemetry actions + auth FORBIDDEN).
- **M1 phase (closed):** **M1 done** as of 2026-04-29. Audit at `../../docs/architecture/audits/milestone-M1-exit.md`. Implementation across 8 commits (`0a283b2..0f9b8c4`): four-table schema + supporting tables, internal write library (claim/update/release/logDecision + locks + sessions), five sync scripts + event bus + adapter interface, GitHub adapter + delivery_sync_state, round-trip integrity test (M1 exit gate; 6 doc classes), schema-invariants smoke (ADR-005 / RLS / ADR-036 / fencing / ADR-035), traceability validator + CI workflow, milestone-exit drift sweep doc.
- **Last milestone done:** M1 per `../../docs/strategic/BUILD-SEQUENCE.md`. **M2 substrate**: in progress (this session: dispatcher + plan-review gate green; transport-adapter wrapper outstanding -- see "M2 follow-ups not blocking exit" below).
- **Test totals after M2 substrate landing (2026-04-30):** 209 assertions across 7 smoke suites (write 39, schema-invariants 31, substrate 19, github 31, endpoint+plan-review 41 NEW, roundtrip-negative 7, roundtrip-corpus 45 files / 6 doc classes) -- all green against single fresh DB reset. CI workflow at `.github/workflows/atelier-audit.yml` continues to run the suite on every PR.
- **Stack locked:** GitHub + Supabase + Vercel + MCP, GCP-portability constrained (ADR-027/028/029).
- **Three-tier consumer model:** Specification / Reference Implementation / Reference Deployment, all first-class at v1 (ADR-031).
- **Open strategic decisions:** D24 (embedding model default -- M5 entry). BRD-OPEN-QUESTIONS sections 22 (semantic contradiction check) and 23 (contribution annotations) remain open per AI-speed pivot; deferred per the M2-entry brief.
- **M1-exit follow-ups (resolved this session):**
  - **F1 (HIGH; M2-entry gateway):** **DONE.** `scripts/traceability/build-registry.ts` lands; traceability.json carries 188 entries + 40 edges; validator unresolved citations 278 -> 18 (residual is intentional fixtures + historical audit NFR refs in 2 source files).
  - **F2 (MEDIUM):** **DONE alongside F1.** edges[] derivation per scripts/README.md "graph-ready from M1".
  - **F3, F4, F5 (LOW):** unchanged from M1 exit audit; see that doc.

## M2 follow-ups not blocking exit

These items were factored out of the M2 substrate landing per BUILD-SEQUENCE pacing. Each has concrete scope and a recommended pickup order. The next M2 session walks them in this order:

1. **Streamable HTTP transport-adapter wrapper around `scripts/endpoint/lib/dispatch.ts`.**
   - **Scope.** A Vercel Functions handler at (likely) `prototype/api/mcp/route.ts` (Next.js App Router) or `api/mcp.ts` (Vite-prototype shape) that:
     - Implements the Streamable HTTP MCP transport per ARCH 7.9 (`POST /mcp` + the SSE upgrade path; one endpoint per project per `.atelier/config.yaml: agent_protocol.endpoint`).
     - Extracts `Authorization: Bearer <jwt>` from the request headers; verifies via the configured identity provider (Supabase Auth by default per ADR-028) using `jose` or equivalent JWKS fetcher. Replaces `stubVerifier` with the production verifier.
     - Maps incoming MCP `tools/call` messages to `dispatch({ tool, bearer, body })` from `scripts/endpoint/lib/dispatch.ts`. The dispatcher is the substrate; the adapter is the wire.
     - Maps `DispatchResult` back to MCP response envelopes (success vs. error + error.code -> MCP error class).
     - Exposes `/.well-known/oauth-authorization-server` (RFC 8414) pointing at the configured identity provider's issuer per ARCH 7.9 discovery requirements.
     - Wires `decisionCommit` to the per-project endpoint git committer (ARCH 7.8). The committer itself is M2-mid; until it lands, `log_decision` returns `INTERNAL: log_decision requires a decisionCommit callback configured on the dispatcher`.
   - **Why this is the natural first commit after find_similar + propose_contract_change wires land.** The dispatcher already advertises 12 tools and has handlers for all of them (with find_similar + propose_contract_change stubbed). Once those two stubs are filled in, the substrate is feature-complete and the only remaining piece is the wire transport. Doing it earlier paints the bikeshed of "what does an MCP message look like" twice (once with stubs, once with real handlers).
   - **Smoke test extension.** Endpoint smoke at `scripts/endpoint/__smoke__/endpoint.smoke.ts` exercises the dispatcher in-process. The transport adapter gets its own smoke at `prototype/api/mcp/__smoke__/transport.smoke.ts` (or equivalent for the chosen prototype shape) that:
     - Stands up the route via `next dev` (or Vercel CLI dev) on a random port.
     - Posts a synthetic MCP `tools/call` for each of the 12 tools with a real bearer obtained via the local Supabase Auth.
     - Asserts the smoke sequence per ARCH 6.1.1 (register/heartbeat/get_context/deregister) succeeds end-to-end through the wire.
   - **Out of scope at this follow-up.** OAuth dynamic-client-registration (RFC 7591); rate limiting (ARCH 7.7); transcript capture (ADR-024 / ARCH 7.8.1). Those land at M2-mid alongside the per-project committer.

2. **find_similar wire-up (handler currently stubs degraded=true).** Gates on D24 (embedding model default) at M5 entry per BUILD-SEQUENCE. Until then the stub correctly signals `degraded: true` so callers behave per ARCH 6.4 fallback semantics. No action required at M2.

3. **propose_contract_change wire-up (handler currently throws INTERNAL with `lands_at: M2-mid`).** Wires through write.ts after the contracts-publish helper lands. Lands when a territory actually publishes a contract for the first time -- either the prototype-design territory or the protocol territory, whichever first crosses the contract surface. Flag in the handler signals callers correctly that the surface exists but is not yet active.

## What the next session should do first

**M2 substrate is done; M2 mid-work picks up the transport-adapter wrapper as the natural first commit per "M2 follow-ups not blocking exit" above.**

1. Read `../../CLAUDE.md` (the agent charter; load-bearing decisions list now includes ADR-040), `../../docs/architecture/audits/M2-entry-data-model-audit.md` (M2-entry findings + their resolutions), and `../../docs/architecture/decisions/ADR-040-12-tool-surface-consolidation-propose-contract-change.md` (the 12-tool surface lock).
2. **Land the Streamable HTTP transport-adapter wrapper** per "M2 follow-ups not blocking exit" item 1 above. Concrete scope: Vercel Functions handler around `scripts/endpoint/lib/dispatch.ts`; replaces `stubVerifier` with a JWKS-backed bearer verifier; maps MCP `tools/call` <-> dispatcher; exposes `/.well-known/oauth-authorization-server`. Smoke at `prototype/api/mcp/__smoke__/transport.smoke.ts` exercises the four-step ARCH 6.1.1 sequence end-to-end through the wire.
3. After the transport-adapter wrapper, the next pickup is whichever of (a) per-project committer for `log_decision` (ARCH 7.8 / ADR-023), (b) actual `propose_contract_change` wire-up (M2-mid), or (c) `/atelier` route lighting up (M3 entry per BUILD-SEQUENCE) is most valuable to the team's current path. The dispatcher's stubs for `find_similar` (degraded=true) and `propose_contract_change` (INTERNAL with lands_at marker) are correct intermediate shapes; both are ready to be filled in without changing the surface.

**Do NOT:**
- Re-implement M1 or M2-substrate deliverables; reach out to `scripts/sync/lib/write.ts`, `scripts/sync/lib/event-bus.ts`, `scripts/sync/lib/adapters.ts`, `scripts/sync/lib/github.ts`, `scripts/endpoint/lib/{auth,handlers,dispatch}.ts`. The transport adapter wraps the dispatcher, does not replace it.
- Edit migrations 1, 2, 3, or 4. New schema lands in migration 5+ when M2-mid surfaces require it (likely none at M2-mid; the substrate is feature-complete schema-wise).
- Add new MCP tools beyond the 12 locked at v1 per ADR-013 + ADR-040. The dispatcher has compile-time check that `TOOL_NAMES.length === 12`.
- Re-author audit findings already documented in `M2-entry-data-model-audit.md`. The audit is canonical for M2 entry state.

## Drift discipline

Do **not** copy ADR counts, decision counts, route counts, or other state-derived numbers into this file. Refer to canonical state; don't replicate. (See `../../docs/methodology/METHODOLOGY.md §6.1` for the no-parallel-summary rule and the worked example.)

If something feels wrong while reading the canonical docs, file a `../../docs/functional/BRD-OPEN-QUESTIONS.md` entry rather than silently fixing it.
