---
last_updated: 2026-04-30
status: M2-mid in progress (per-project git committer landing this commit on top of transport-adapter); real-client consumption + propose_contract_change wire-up outstanding
sunset_at: M2 (replaced by `get_context` per US-2.4 once a real MCP client first consumes the live endpoint with a Supabase-Auth-issued bearer)
---

# Session checkpoint

Ephemeral session-to-session state. Not canonical — see `../../docs/methodology/METHODOLOGY.md §6.1` for doc organization.

This file is a **pre-M2 stand-in for `get_context`**. The 12-tool dispatcher and `getContext` substrate landed 2026-04-30; this file retires once the Streamable HTTP transport-adapter wraps the dispatcher and clients connect.

---

## Where we are

- **Phase:** **M2-mid: per-project git committer landing** as of 2026-04-30 (this commit on top of transport-adapter at `08cdc60`). Implementation in this commit: `scripts/endpoint/lib/committer.ts` (framework-agnostic per-project git committer per ARCH 7.8 / ADR-023; ADR file rendering with frontmatter per ADR-030 + ADR-037; commit author = `<displayName> via Atelier <bot-email>` + `Co-Authored-By` trailer; per-instance mutex serializing commits + in-memory idempotency cache `(sessionId, idempotencyKey)` -> sha for 1h per ARCH 6.3.1; push retries 5s/15s/45s with retryable=true on final failure), `gitCommitterFromEnv()` factory consuming `ATELIER_COMMITTER_*` env vars, `scripts/endpoint/lib/handlers.ts` logDecision now snake_case-projects the response per ARCH 6.3.1 + accepts `idempotency_key`, dispatch.ts `decisionCommit` slot accepts the higher-level `AdrCommitter` interface, prototype route wires the committer in. Smoke extensions: `scripts/endpoint/__smoke__/committer.smoke.ts` (33 assertions covering rendering, happy-path commit + push, idempotency replay, mutex-serialized concurrency, commit-fails rollback, slug edge cases, push=false toggle); transport.smoke.ts `[9]` block flips from INTERNAL stub to real-commit happy-path with ADR file presence, frontmatter shape, commit-author shape, Co-Authored-By trailer, push reaches remote, idempotent replay returns original SHA. CI workflow gains the committer smoke as a blocking gate.
- **Phase preceding (closed):** **M2-mid transport-adapter wrapper landed** as of 2026-04-30 at commit `08cdc60`. Implementation across that session: prototype/ Next.js App Router scaffold (package.json + tsconfig + minimal layout/page), `prototype/src/app/api/mcp/route.ts` (Streamable HTTP MCP transport per ARCH 7.9), `prototype/src/app/.well-known/oauth-authorization-server/route.ts` (RFC 8414 discovery), framework-agnostic transport core at `scripts/endpoint/lib/transport.ts` (Web-standard Request/Response handler; initialize / tools/list / tools/call mapping), `scripts/endpoint/lib/jwks-verifier.ts` (production BearerVerifier replacing stubVerifier; jose-backed createRemoteJWKSet), `scripts/endpoint/lib/oauth-discovery.ts` (RFC 8414 metadata builder). Wire-level smoke at `scripts/endpoint/__smoke__/transport.smoke.ts` (47 assertions: real ES256-signed JWTs against synthetic JWKS issuer, real http.createServer mounting handleMcpRequest, end-to-end ARCH 6.1.1 four-step over the wire, log_decision + propose_contract_change + find_similar stub gaps observable, FORBIDDEN paths for bogus signature + ghost sub). CI workflow extended with both endpoint smoke + transport smoke as blocking gates.
- **Phase preceding (closed):** **M2 substrate landed** as of 2026-04-30. M2-entry audit at `../../docs/architecture/audits/M2-entry-data-model-audit.md` (10 findings; all resolved at landing). Implementation across that session: ADR-040 (12-tool surface consolidation per audit H2), ARCH 6.6 / 6.7 / 6.5 / 7.5 spec edits (M5 / M6), migration 4 (composers.identity_subject + audit-H1/L1 CHECKs; locks.lock_type dropped per audit M3; territories.contracts_consumed per audit M4; contribution_state += plan_review with audit-M1/M2 CHECKs per ADR-039; territories.requires_plan_review per ADR-039), F1 build-registry script (closes M1-exit follow-up F1; traceability.json now carries 188 entries + 40 edges), write.ts extensions (deregister + getContext + 4 plan-review handlers + audit-H3 release clearing), 12-tool MCP endpoint substrate at `scripts/endpoint/lib/{auth,handlers,dispatch}.ts` (TOOL_NAMES locked at 12 with compile-time check), endpoint smoke + plan-review tests at `scripts/endpoint/__smoke__/endpoint.smoke.ts` (41 assertions covering ARCH 6.1.1 + ADR-039 paths + audit H3 + 3 telemetry actions + auth FORBIDDEN).
- **M1 phase (closed):** **M1 done** as of 2026-04-29. Audit at `../../docs/architecture/audits/milestone-M1-exit.md`. Implementation across 8 commits (`0a283b2..0f9b8c4`): four-table schema + supporting tables, internal write library (claim/update/release/logDecision + locks + sessions), five sync scripts + event bus + adapter interface, GitHub adapter + delivery_sync_state, round-trip integrity test (M1 exit gate; 6 doc classes), schema-invariants smoke (ADR-005 / RLS / ADR-036 / fencing / ADR-035), traceability validator + CI workflow, milestone-exit drift sweep doc.
- **Last milestone done:** M1 per `../../docs/strategic/BUILD-SEQUENCE.md`. **M2 substrate**: in progress (this session: dispatcher + plan-review gate green; transport-adapter wrapper outstanding -- see "M2 follow-ups not blocking exit" below).
- **Test totals after M2-mid committer landing (2026-04-30):** 9 smoke suites (write, schema-invariants, substrate, github, endpoint+plan-review, committer NEW, transport-wire, roundtrip-negative, roundtrip-corpus 45 files / 6 doc classes) -- all green against single fresh DB reset. Committer smoke contributes 33 assertions; transport-wire `[9]` block expanded with real-commit + idempotency replay assertions. CI workflow at `.github/workflows/atelier-audit.yml` runs all three endpoint smokes (endpoint + committer + transport) as blocking gates on every PR.
- **Stack locked:** GitHub + Supabase + Vercel + MCP, GCP-portability constrained (ADR-027/028/029).
- **Three-tier consumer model:** Specification / Reference Implementation / Reference Deployment, all first-class at v1 (ADR-031).
- **Open strategic decisions:** D24 (embedding model default -- M5 entry). BRD-OPEN-QUESTIONS sections 22 (semantic contradiction check) and 23 (contribution annotations) remain open per AI-speed pivot; deferred per the M2-entry brief.
- **M1-exit follow-ups (resolved this session):**
  - **F1 (HIGH; M2-entry gateway):** **DONE.** `scripts/traceability/build-registry.ts` lands; traceability.json carries 188 entries + 40 edges; validator unresolved citations 278 -> 18 (residual is intentional fixtures + historical audit NFR refs in 2 source files).
  - **F2 (MEDIUM):** **DONE alongside F1.** edges[] derivation per scripts/README.md "graph-ready from M1".
  - **F3, F4, F5 (LOW):** unchanged from M1 exit audit; see that doc.

## M2-mid follow-ups (committer shipped; remaining items)

The per-project git committer landed in this commit. Remaining M2-mid work, in recommended pickup order:

1. **Real-client consumption smoke.** The transport-wire smoke uses a synthetic JWKS issuer (jose-generated ES256 keypair) so it runs deterministically without manual provider setup. The next step is validating the same flow with a real MCP client (claude.ai Connectors, Claude Code, or Cursor) against a real Supabase Auth issuer. This is a documentation + connector-setup task, not a code task -- see `docs/user/connectors/` (lands at M2-late). When this clears, `.atelier/checkpoints/SESSION.md` retires per the file's `sunset_at` field.

2. **`propose_contract_change` wire-up (handler currently throws INTERNAL with `lands_at: M2-mid`).** Wires through write.ts after the contracts-publish helper lands. Lands when a territory actually publishes a contract for the first time -- either the prototype-design territory or the protocol territory, whichever first crosses the contract surface. Flag in the handler signals callers correctly that the surface exists but is not yet active.

3. **Persistent idempotency state surface (event-triggered; lands with the broader claim+log_decision idempotency work at M2-late or M3).** The committer-level cache is in-memory and per-instance. Cold-start re-entrance with the same `idempotency_key` does NOT hit the cache, so write.ts proceeds to allocate a fresh ADR-NNN and the committer commits a NEW file -- result is ADR pollution: two ADR files at different NNNs, two commits with different SHAs, two `decisions` rows, all keyed to one logical "intended" decision. Persistent `(session_id, idempotency_key)` storage per ARCH 6.3.1 needs to land at the write.ts level (short-circuit before allocation) AND/OR at the committer level (short-circuit before file write) to close this. Trigger condition: when the M2-late idempotency state table lands for `claim` (per ARCH 6.2.1), extend it to cover `log_decision` in the same migration. No calendar timer; lands when the broader idempotency surface does.

4. **Multi-instance ADR-NNN allocation (event-triggered; lands when production deploy first uses >1 Vercel Function instance).** ADR-NNN allocation is serialized at the DB (`allocate_adr_number(project_id)` is an atomic UPDATE on `projects.next_adr_number`), so two instances cannot allocate the same NNN. However, each Vercel Function instance holds its own working clone, and the committer does NOT `git fetch` before commit nor rebase on push rejection: it retries the same push 3x then surfaces `INTERNAL` with `retryable: true`, retaining the local commit. Concurrent `log_decision` calls across instances thus see one push succeed and the other(s) fail with non-fast-forward. The retried call from the caller would re-allocate a NEW NNN (cold-start cache miss as above) and try again -- correct on the retry but expensive on diverged-clone recovery. M2-late fix: add `git fetch` + rebase-onto-remote between commit and push, retry once on non-fast-forward; failing that, surface to caller as retryable (current behavior, documented). Trigger condition: when the team's deploy first auto-scales beyond a single warm instance.

5. **find_similar wire-up (handler currently stubs degraded=true).** Gates on D24 (embedding model default) at M5 entry per BUILD-SEQUENCE. Until then the stub correctly signals `degraded: true` so callers behave per ARCH 6.4 fallback semantics. No action required at M2-mid.

6. **Out of scope at M2-mid (deferred to M2-late or later):** OAuth dynamic-client-registration (RFC 7591); rate limiting (ARCH 7.7); transcript capture (ADR-024 / ARCH 7.8.1); SSE upgrade path on `GET /api/mcp` (Streamable HTTP server-initiated messages); committer deploy-key rotation runbook (`atelier rotate-committer-key`). Each is independently scopable when first need arises.

## What the next session should do first

**Committer is shipped; M2-mid continues with whichever of the remaining follow-ups (real-client consumption / propose_contract_change wire-up) the team's path needs first.**

1. Read `../../CLAUDE.md` (the agent charter), `../../docs/architecture/audits/M2-entry-data-model-audit.md` (M2-entry findings + resolutions), and the freshly-landed committer at `scripts/endpoint/lib/committer.ts` + the wired-in route at `prototype/src/app/api/mcp/route.ts`.
2. Pick the next deliverable:
   (a) **Real-client consumption smoke** (claude.ai Connectors / Claude Code / Cursor against real Supabase Auth) -- documentation + connector-setup work; retires this SESSION.md per its `sunset_at`.
   (b) **`propose_contract_change` wire-up** -- handler currently throws INTERNAL with `lands_at: M2-mid`; wires through write.ts after the contracts-publish helper lands.
   (c) **`/atelier` route lighting up (M3 entry per BUILD-SEQUENCE)** -- the prototype web app's first lens.

**Do NOT:**
- Re-implement M1 or M2-substrate deliverables; reach out to `scripts/sync/lib/write.ts`, `scripts/sync/lib/event-bus.ts`, `scripts/sync/lib/adapters.ts`, `scripts/sync/lib/github.ts`, `scripts/endpoint/lib/{auth,handlers,dispatch,transport,jwks-verifier,oauth-discovery,committer}.ts`. The committer plugs into the dispatcher's `decisionCommit` slot via the `AdrCommitter` interface; bridge logic lives in `handlers.logDecision`.
- Edit migrations 1, 2, 3, or 4. New schema lands in migration 5+ when M2-mid surfaces require it.
- Add new MCP tools beyond the 12 locked at v1 per ADR-013 + ADR-040. The dispatcher has compile-time check that `TOOL_NAMES.length === 12`.
- Re-author audit findings already documented in `M2-entry-data-model-audit.md`. The audit is canonical for M2 entry state.
- Persist log_decision idempotency state in this commit -- that's a separate M2-late/M3 surface alongside the broader claim+log_decision idempotency state table per ARCH 6.3.1.

## Drift discipline

Do **not** copy ADR counts, decision counts, route counts, or other state-derived numbers into this file. Refer to canonical state; don't replicate. (See `../../docs/methodology/METHODOLOGY.md §6.1` for the no-parallel-summary rule and the worked example.)

If something feels wrong while reading the canonical docs, file a `../../docs/functional/BRD-OPEN-QUESTIONS.md` entry rather than silently fixing it.
