---
last_updated: 2026-04-30
status: M2-mid in progress (transport-adapter wrapper landing this commit on top of substrate); per-project git committer + real client consumption outstanding
sunset_at: M2 (replaced by `get_context` per US-2.4 once a real MCP client first consumes the live endpoint with a Supabase-Auth-issued bearer)
---

# Session checkpoint

Ephemeral session-to-session state. Not canonical — see `../../docs/methodology/METHODOLOGY.md §6.1` for doc organization.

This file is a **pre-M2 stand-in for `get_context`**. The 12-tool dispatcher and `getContext` substrate landed 2026-04-30; this file retires once the Streamable HTTP transport-adapter wraps the dispatcher and clients connect.

---

## Where we are

- **Phase:** **M2-mid: transport-adapter wrapper landing** as of 2026-04-30 (this commit on top of M2 substrate at `95e30ea`). Implementation in this commit: prototype/ Next.js App Router scaffold (package.json + tsconfig + minimal layout/page), `prototype/src/app/api/mcp/route.ts` (Streamable HTTP MCP transport per ARCH 7.9), `prototype/src/app/.well-known/oauth-authorization-server/route.ts` (RFC 8414 discovery), framework-agnostic transport core at `scripts/endpoint/lib/transport.ts` (Web-standard Request/Response handler; initialize / tools/list / tools/call mapping), `scripts/endpoint/lib/jwks-verifier.ts` (production BearerVerifier replacing stubVerifier; jose-backed createRemoteJWKSet), `scripts/endpoint/lib/oauth-discovery.ts` (RFC 8414 metadata builder). Wire-level smoke at `scripts/endpoint/__smoke__/transport.smoke.ts` (47 assertions: real ES256-signed JWTs against synthetic JWKS issuer, real http.createServer mounting handleMcpRequest, end-to-end ARCH 6.1.1 four-step over the wire, log_decision + propose_contract_change + find_similar stub gaps observable, FORBIDDEN paths for bogus signature + ghost sub). CI workflow extended with both endpoint smoke + transport smoke as blocking gates.
- **Phase preceding (closed):** **M2 substrate landed** as of 2026-04-30. M2-entry audit at `../../docs/architecture/audits/M2-entry-data-model-audit.md` (10 findings; all resolved at landing). Implementation across that session: ADR-040 (12-tool surface consolidation per audit H2), ARCH 6.6 / 6.7 / 6.5 / 7.5 spec edits (M5 / M6), migration 4 (composers.identity_subject + audit-H1/L1 CHECKs; locks.lock_type dropped per audit M3; territories.contracts_consumed per audit M4; contribution_state += plan_review with audit-M1/M2 CHECKs per ADR-039; territories.requires_plan_review per ADR-039), F1 build-registry script (closes M1-exit follow-up F1; traceability.json now carries 188 entries + 40 edges), write.ts extensions (deregister + getContext + 4 plan-review handlers + audit-H3 release clearing), 12-tool MCP endpoint substrate at `scripts/endpoint/lib/{auth,handlers,dispatch}.ts` (TOOL_NAMES locked at 12 with compile-time check), endpoint smoke + plan-review tests at `scripts/endpoint/__smoke__/endpoint.smoke.ts` (41 assertions covering ARCH 6.1.1 + ADR-039 paths + audit H3 + 3 telemetry actions + auth FORBIDDEN).
- **M1 phase (closed):** **M1 done** as of 2026-04-29. Audit at `../../docs/architecture/audits/milestone-M1-exit.md`. Implementation across 8 commits (`0a283b2..0f9b8c4`): four-table schema + supporting tables, internal write library (claim/update/release/logDecision + locks + sessions), five sync scripts + event bus + adapter interface, GitHub adapter + delivery_sync_state, round-trip integrity test (M1 exit gate; 6 doc classes), schema-invariants smoke (ADR-005 / RLS / ADR-036 / fencing / ADR-035), traceability validator + CI workflow, milestone-exit drift sweep doc.
- **Last milestone done:** M1 per `../../docs/strategic/BUILD-SEQUENCE.md`. **M2 substrate**: in progress (this session: dispatcher + plan-review gate green; transport-adapter wrapper outstanding -- see "M2 follow-ups not blocking exit" below).
- **Test totals after M2-mid transport-adapter landing (2026-04-30):** 256 assertions across 8 smoke suites (write 39, schema-invariants 31, substrate 19, github 31, endpoint+plan-review 41, transport-wire 47 NEW, roundtrip-negative 7, roundtrip-corpus 45 files / 6 doc classes) -- all green against single fresh DB reset. CI workflow at `.github/workflows/atelier-audit.yml` now runs both endpoint smokes as blocking gates on every PR.
- **Stack locked:** GitHub + Supabase + Vercel + MCP, GCP-portability constrained (ADR-027/028/029).
- **Three-tier consumer model:** Specification / Reference Implementation / Reference Deployment, all first-class at v1 (ADR-031).
- **Open strategic decisions:** D24 (embedding model default -- M5 entry). BRD-OPEN-QUESTIONS sections 22 (semantic contradiction check) and 23 (contribution annotations) remain open per AI-speed pivot; deferred per the M2-entry brief.
- **M1-exit follow-ups (resolved this session):**
  - **F1 (HIGH; M2-entry gateway):** **DONE.** `scripts/traceability/build-registry.ts` lands; traceability.json carries 188 entries + 40 edges; validator unresolved citations 278 -> 18 (residual is intentional fixtures + historical audit NFR refs in 2 source files).
  - **F2 (MEDIUM):** **DONE alongside F1.** edges[] derivation per scripts/README.md "graph-ready from M1".
  - **F3, F4, F5 (LOW):** unchanged from M1 exit audit; see that doc.

## M2-mid follow-ups (transport-adapter shipped; remaining items)

The transport-adapter wrapper landed in this commit. Remaining M2-mid work, in recommended pickup order:

1. **Per-project endpoint git committer (ARCH 7.8 / ADR-023).** The transport mounts the dispatcher with `decisionCommit` omitted, so `log_decision` returns `INTERNAL: log_decision requires a decisionCommit callback configured on the dispatcher`. The committer itself is the next deliverable: per-project deploy key, attribution-preserving commits as `<composer.display_name> via Atelier <atelier-bot@<project>>` with `Co-Authored-By: <composer email>`, retry-safe failure semantics. Lands behind a feature flag because real-repo commits write outside the test boundary; gate before flipping on for the Atelier-self project. Once it lands, swap the route's dispatch deps to include `decisionCommit` and the M2-mid stub gap is closed.

2. **Real-client consumption smoke.** The transport-wire smoke uses a synthetic JWKS issuer (jose-generated ES256 keypair) so it runs deterministically without manual provider setup. The next step is validating the same flow with a real MCP client (claude.ai Connectors, Claude Code, or Cursor) against a real Supabase Auth issuer. This is a documentation + connector-setup task, not a code task -- see `docs/user/connectors/` (lands at M2-late). When this clears, `.atelier/checkpoints/SESSION.md` retires per the file's `sunset_at` field.

3. **`propose_contract_change` wire-up (handler currently throws INTERNAL with `lands_at: M2-mid`).** Wires through write.ts after the contracts-publish helper lands. Lands when a territory actually publishes a contract for the first time -- either the prototype-design territory or the protocol territory, whichever first crosses the contract surface. Flag in the handler signals callers correctly that the surface exists but is not yet active.

4. **find_similar wire-up (handler currently stubs degraded=true).** Gates on D24 (embedding model default) at M5 entry per BUILD-SEQUENCE. Until then the stub correctly signals `degraded: true` so callers behave per ARCH 6.4 fallback semantics. No action required at M2-mid.

5. **Out of scope at M2-mid (deferred to M2-late or later):** OAuth dynamic-client-registration (RFC 7591); rate limiting (ARCH 7.7); transcript capture (ADR-024 / ARCH 7.8.1); SSE upgrade path on `GET /api/mcp` (Streamable HTTP server-initiated messages). Each is independently scopable when first need arises.

## What the next session should do first

**M2 transport-adapter is shipped; M2-mid continues with the per-project git committer for log_decision.**

1. Read `../../CLAUDE.md` (the agent charter), `../../docs/architecture/audits/M2-entry-data-model-audit.md` (M2-entry findings + resolutions), and the freshly-landed transport surfaces at `scripts/endpoint/lib/{transport,jwks-verifier,oauth-discovery}.ts` + `prototype/src/app/api/mcp/route.ts`.
2. **Land the per-project endpoint git committer** per ARCH 7.8 / ADR-023. Wire it as the dispatcher's `decisionCommit` callback; flip `log_decision` from INTERNAL stub to working. New work goes under `scripts/endpoint/lib/committer.ts` (likely) with attribution preserving `<composer.display_name> via Atelier <atelier-bot@<project>>` + `Co-Authored-By`. Smoke extension: append a `[15] log_decision committer integration` block to `scripts/endpoint/__smoke__/transport.smoke.ts` that asserts the commit lands with the right author shape against a temp git repo fixture.
3. After the committer, the next pickup is whichever of (a) `propose_contract_change` wire-up, (b) real-client consumption smoke against Supabase Auth, or (c) `/atelier` route lighting up (M3 entry per BUILD-SEQUENCE) is most valuable to the team's current path.

**Do NOT:**
- Re-implement M1 or M2-substrate deliverables; reach out to `scripts/sync/lib/write.ts`, `scripts/sync/lib/event-bus.ts`, `scripts/sync/lib/adapters.ts`, `scripts/sync/lib/github.ts`, `scripts/endpoint/lib/{auth,handlers,dispatch,transport,jwks-verifier,oauth-discovery}.ts`. The committer wraps the dispatcher's `decisionCommit` slot, does not replace it.
- Edit migrations 1, 2, 3, or 4. New schema lands in migration 5+ when M2-mid surfaces require it.
- Add new MCP tools beyond the 12 locked at v1 per ADR-013 + ADR-040. The dispatcher has compile-time check that `TOOL_NAMES.length === 12`.
- Re-author audit findings already documented in `M2-entry-data-model-audit.md`. The audit is canonical for M2 entry state.

## Drift discipline

Do **not** copy ADR counts, decision counts, route counts, or other state-derived numbers into this file. Refer to canonical state; don't replicate. (See `../../docs/methodology/METHODOLOGY.md §6.1` for the no-parallel-summary rule and the worked example.)

If something feels wrong while reading the canonical docs, file a `../../docs/functional/BRD-OPEN-QUESTIONS.md` entry rather than silently fixing it.
