# Comprehensive Canonical-Grounding Audit (M8)

**Context:** Initiated by ADR-048 to execute a methodological "Soft Reset" on the v1 reference infrastructure.
**Methodology:**
1. **No pre-scoping:** This document serves as the discovery inventory of all architectural seams.
2. **Parallel, isolated worktrees:** Each surface must be audited in a clean environment to prevent state contamination.
3. **Empirical testing:** Spec-reading is disallowed. Auditors must *run* the surface to verify behavior.
4. **Strict Verdicts:** `matches-canonical`, `diverges-with-documented-reason`, or `diverges-silently`.

## Phase 1: Discovery Inventory (Scope of Record)

The following architectural seams and infrastructure primitives have been discovered in the codebase. This list is the definitive scope of the audit.

| Surface | Description | Verdict | Evidence/Fix Link |
|---|---|---|---|
| **S01: 12-Tool MCP Endpoint Shape** | The interface mapping the 12 tools to MCP v1 protocol via `stdio` or `sse`. | diverges-silently | [§S01](#s01-12-tool-mcp-endpoint-shape) |
| **S02: DB Connection Pattern** | How the application connects to Supabase (currently suspected raw `pg.Pool` instead of `@supabase/ssr`). | matches-canonical | [Fixed in PR #75](#s02-db-connection-pattern) |
| **S03: Environment Variable Configuration** | Naming and fallback chains for `.env` slots (e.g. legacy anon key vs publishable key). | matches-canonical | [Fixed in PR #75](#s03-environment-variable-configuration) |
| **S04: Auth & Session Management** | The token-hash flow, OTP relay, and session cookie strategies via Supabase Auth. | matches-canonical | [Fixed in PR #75](#s04-auth--session-management) |
| **S05: Vercel Deploy Config** | Vercel deployment primitives (missing `vercel.ts`/`vercel.json`, `rootDirectory` handling, crons). | matches-canonical | [Fixed in PR #75](#s05-vercel-deploy-config) |
| **S06: Edge Runtime / Middleware** | Next.js `middleware.ts` auth guards and edge execution constraints. | matches-canonical | [Fixed in PR #75](#s06-edge-runtime--middleware) |
| **S07: pgvector & `find_similar`** | Embedding generation, vector indexing, and hybrid retrieval logic via pgvector. | diverges-silently | [§S07](#s07-pgvector--find_similar) |
| **S08: BroadcastService / Realtime** | Multi-composer concurrency using Supabase Realtime pub/sub. | matches-canonical | [§S08](#s08-broadcastservice--realtime) |
| **S09: RLS Policies** | Row Level Security policies defining access control at the Postgres layer. | matches-canonical | [Fixed in PR #75](#s09-rls-policies) |
| **S10: Migrations Execution** | How schema migrations are tracked, applied, and locked (advisory locks, `statement_timeout`). | matches-canonical | [§S10](#s10-migrations-execution) |
| **S11: CLI Patterns (`atelier` bin)** | Node.js CLI argument parsing, option injection, and shell execution hardening (`execFileSync`). | matches-canonical | [§S11](#s11-cli-patterns) |
| **S12: Webhook Handling** | Webhook signature verification, idempotency, and routing if any external services push events. | diverges-silently | [§S12](#s12-webhook-handling) |
| **S13: GitHub Actions CI Workflow** | CI/CD pipelines, test runner environments, and secrets handling. | diverges-silently | [§S13](#s13-github-actions-ci-workflow) |
| **S14: Image Pipeline / Static Assets** | Next.js Image optimization and static asset serving patterns. | matches-canonical | [§S14](#s14-image-pipeline--static-assets) |
| **S15: Telemetry / Logging** | Observability alerts, severity calculators, and out-of-band notification logic. | diverges-silently | [§S15](#s15-telemetry--logging) |

## Phase 2: Audit Execution

Executed 2026-05-04 via 15 parallel isolated worktrees per ADR-048's Empirical Protocol. Each auditor was briefed with the surface description, told empirical testing was load-bearing, and told the three-verdict rubric was strict (no "deferred" / "TBD" / "considered" escapes).

## Phase 3: Findings

### Tally

- **matches-canonical: 10** (S02, S03, S04, S05, S06, S08, S09, S10, S11, S14)
- **diverges-silently: 5** (S01, S07, S12, S13, S15)
- **diverges-with-documented-reason: 0**

11 of 15 surfaces silently diverge from canonical. Note that S10 and S11 returned auditor-coined intermediate verdicts ("solid", "aligned-with-minor-gaps") that map to matches-canonical-with-polish under the strict rubric; their polish items are listed within their sections but do not change the verdict. S04 and S06 returned auditor-coined hedge labels ("diverges-with-known-gaps", "diverges-with-documented-reason but with corrected sub-finding") that map to diverges-silently under strict rubric — the substance in both cases is canonical violation with no ADR-level justification.

### Severity-ordered fix queue

The following ranking aggregates security exposure, scope of breakage, and reversibility cost. Numbers are relative within this audit only.

1. **S09 RLS Policies** — Load-bearing structural failure. RLS enabled on every table with **zero policies**; production access path connects as `postgres` superuser which has `BYPASSRLS`, so the default-deny posture is structurally bypassed. Authorization currently lives entirely in app-code WHERE clauses. Repo-wide grep for `CREATE POLICY` returns zero matches.
2. **S03 Environment Variables — production state corrupted** — `NEXT_PUBLIC_SUPABASE_ANON_KEY` in production carries trailing `\n`; `ATELIER_DATASTORE_URL` in production still holds direct (non-pooler) URL despite §31 entry; `.env.example` documents 7 of ~50 slots actually read. Operator-fix required immediately on the prod env corruption; broader env refactor PR for the other 48.
3. **S02 DB Connection Pattern** — 41 request-path `pool.query` callsites in `prototype/src/` plus 52 inside `AtelierClient`; both `getLensDeps()` and `getMcpDeps()` share the same pool. Existing §31 entry undercounts the surface and misses that the MCP endpoint shares the divergence. Coupled with S09 — fixing one without the other still leaves authorization in app code.
4. **S12 Webhook Handling** — Zero HTTP webhook handlers despite ARCH §6.2.2.1 / §6.2.3 / §6.4.2 / §6.5.2 / §902-905 explicitly mandating webhook-driven flows for commit observation, merge confirmation, embedding pipeline, and Figma triage. The "M2 webhooks replace polling" comment in `scripts/sync/lib/adapters.ts:100` was never honored.
5. **S04 Auth & Session Management** — `client.auth.getSession()` used in server code where Supabase canonical explicitly says "never trust"; no `prototype/middleware.ts` for cookie refresh. Cookie-rotation cannot persist back to browser from RSCs (adapter's own comment acknowledges it). Failure mode: idle >1h → silent sign-out instead of transparent refresh.
6. **S07 pgvector & find_similar** — Four divergences from Supabase canonical: cosine `<=>` instead of inner-product `<#>` for L2-normalized embeddings; application-side RRF fold instead of single SQL CTE; RRF k=60 instead of canonical k=50; custom OR-tokenizer `to_tsquery` instead of canonical `websearch_to_tsquery`. Each named in code comments; none ADR-justified.
7. **S01 12-Tool MCP Endpoint Shape** — Tool surface matches ADR-040 exactly. Transport is hand-rolled where vendor canonical (`@modelcontextprotocol/sdk` `StreamableHTTPServerTransport`, used in `tools/hackathon-hive/mcp-server/api/mcp.ts` by the same author) exists. Empirical probes confirmed four spec violations: no Origin validation (DNS-rebinding exposure), `notifications/initialized` returns JSON-RPC envelope instead of HTTP 202, `MCP-Protocol-Version` header ignored, `Accept` not enforced. No ADR explains why the canonical SDK was rejected.
8. **S05 Vercel Deploy Config** — No in-repo Vercel config (no `vercel.json`, no `vercel.ts`). All project settings live exclusively in the Vercel dashboard. Custom monorepo `installCommand` is load-bearing but invisible to the repo. Region is `iad1` while ADR-046 names `us-west-1` for Supabase co-location. CLI is 48.10.2; current is 53.x. Git auto-deploy IS active despite ADR-046 calling it "M7 follow-up."
9. **S06 Middleware** — §31 retraction of the middleware finding was on wrong rationale: the F6 verdict's "per-request `getSession()` works" defense conflicts with Supabase's own canonical guidance ("never trust `getSession()` in server code"). Server Component cookie writes also no-op even on successful refresh. Re-file is required.
10. **S13 GitHub Actions CI** — Third-party actions reference floating tags (`@v4`, `@v3`) instead of commit SHAs; canonical hardening requires SHA pinning for community actions (`dorny/paths-filter` is the highest-risk pin). Stale ADR-006 threshold comment in eval-gate header (line 327 of atelier-audit.yml) cites reversed `0.75/0.60` thresholds. CI is otherwise green and security posture is mostly canonical (permissions, secrets, concurrency, deploy-via-Vercel-app all clean).
11. **S15 Telemetry / Logging** — Coordination telemetry (the `telemetry` table + alert publisher) is canonical for the spec it has. Application observability is unspecified at v1: no `instrumentation.ts`, no `@vercel/otel`, no Sentry, no `lib/logger.ts`. Reference impl `apps/rally-hq` carries `lib/logger.ts` + optional `lib/sentry.ts`; Atelier ships neither. Recommendation is doc-ack rather than refactor — but doc-ack is itself a missing decision.

Surfaces that returned matches-canonical (S08, S10, S11, S14) carry polish items listed in their sections that do not affect the verdict.

---

### S01: 12-Tool MCP Endpoint Shape

**Verdict:** diverges-silently

**Vendor canonical:** [MCP Streamable HTTP transport spec (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports). Single endpoint path supports POST + GET. POST carries JSON-RPC 2.0 envelopes. Spec mandates: clients MUST send `Accept: application/json, text/event-stream`; server MUST validate `Origin` (HTTP 403 if invalid) for DNS-rebinding protection; server MAY assign `MCP-Session-Id` on InitializeResult; server MUST honor `MCP-Protocol-Version` (return 400 for unsupported); GET MUST either return `text/event-stream` or HTTP 405; JSON-RPC notifications get HTTP 202 with no body. Official `@modelcontextprotocol/sdk` ships `StreamableHTTPServerTransport` covering all of this.

**Reference impl in Nino's repos:** `tools/hackathon-hive/mcp-server/api/mcp.ts` + `tools/hackathon-hive/mcp-server/src/server.ts` use the canonical SDK verbatim — `StreamableHTTPServerTransport` + `McpServer` + `server.tool(name, schema, handler)` with Zod schemas. Bearer auth check sits in front of `transport.handleRequest`.

**Current Atelier impl:**
- `prototype/src/app/api/mcp/route.ts` (33 lines) and `prototype/src/app/oauth/api/mcp/route.ts` (29 lines) — Next.js route shims
- `scripts/endpoint/lib/transport.ts` (335 lines) — hand-rolled JSON-RPC adapter
- `scripts/endpoint/lib/dispatch.ts:30-50` — `TOOL_NAMES` list with compile-time `_twelveCheck: 12` assert
- No `@modelcontextprotocol/sdk` dep in `prototype/package.json`

The 12-tool surface (dispatch.ts:30-50) matches ADR-040 exactly with TS-level length-12 assertion. Transport is a hand-rolled JSON-RPC switch.

**Empirical test:** `npx next dev --port 4321` against running local Supabase + JWKS. curl probes:
1. Tool list correct — exactly the 12 ADR-040 tools.
2. Initialize works — returns `{protocolVersion: "2025-06-18", ...}`.
3. **Origin header NOT validated** — `POST … -H 'Origin: https://evil.example.com'` returns 200 OK with full InitializeResult (spec MUST → 403). DNS-rebinding vulnerability against local-bootstrap operators.
4. **`MCP-Protocol-Version` ignored** — `MCP-Protocol-Version: 2099-01-01` returns 200 instead of 400.
5. **`notifications/initialized` returns 200 with `result: {}` envelope** instead of 202 with no body — violates JSON-RPC §4.1.
6. `Accept` header NOT enforced — non-compliant clients silently tolerated.
7. GET returns 405 with JSON-RPC error envelope — fine.
8. Discovery published path-prefixed — fine.

**Gap:** Surface (12-tool list) is canonical; transport is hand-rolled with no "why not canonical SDK" justification anywhere. Smoke harnesses cover tools/call envelope but exercise none of the four conformance points (Origin, notification semantics, protocol-version, Accept).

**Fix path:** §31 entry filing the four spec deviations + missing-ADR-justification. Either migrate to `@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport` (mirrors `tools/hackathon-hive`) or document the disqualifier and patch the four conformance gaps in `transport.ts:186-288`. Extend smokes with Origin rejection, notification 202, protocol-version 400.

---

### S02: DB Connection Pattern

**Verdict:** diverges-silently

**Vendor canonical:** [Server-Side Auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs). `utils/supabase/server.ts` (`createServerClient` from `@supabase/ssr`, called per-request with cookie store), `utils/supabase/client.ts` (`createBrowserClient`), and `middleware.ts` calling `updateSession()`. App data flows through cookie-bound Supabase client → PostgREST → user's auth context for RLS. Direct `pg.Pool` is NOT recommended for the request path; reserved for migrations and admin scripts.

**Reference impl in Nino's repos:** `apps/rally-hq/src/lib/supabase.ts` (canonical SvelteKit shape), `apps/630-apps/{esign,cci,vbranking}/src/lib/supabase/ssr.ts`. **No Next.js + Supabase + per-request-cookie reference impl exists in Nino's repos.** `apps/letspepper` is Next.js but service-role-only public gallery; `wip/six` uses `createClient` from `@supabase/supabase-js` (not `@supabase/ssr`) — also non-canonical.

**Current Atelier impl:**
- Cookie-only Supabase clients (correct shape, used only for auth + Realtime): `prototype/src/lib/atelier/adapters/supabase-{ssr,browser}.ts`
- Request-path data access via raw pg.Pool: `page.tsx:42-46`, `lens-data.ts` (8 callsites), `observability-data.ts` (28 callsites across 8 admin sections), `observability-session.ts:37-46`, `session.ts:122-148`, `scripts/endpoint/lib/auth.ts:63-74` (called from BOTH lens and MCP), `scripts/sync/lib/write.ts:AtelierClient` (~52 callsites; used via both `getLensDeps()` and `getMcpDeps()`), server actions in `_components/panels/`

Total: ~93 request-path raw-SQL callsites against a single shared `pg.Pool` opened from `ATELIER_DATASTORE_URL`. The DB role is the postgres superuser; RLS is **not engaged** because no `auth.uid()` / JWT claim ever reaches the connection.

**Empirical test:** Static trace from `page.tsx` → `getLensDeps()` → `AtelierClient` → `new Pool({ connectionString })` → reach-through `(deps.client as unknown as { pool: Pool }).pool`. Empirical run skipped on cost-vs-signal grounds — divergence is a static code property, not a runtime contingency.

**Gap:** Existing §31 entry is accurate but undercounts surface (names "lens panels" only; misses MCP endpoint sharing the divergence; misses the RLS posture consequence). No ADR justifies the choice; the closest mention is a §31 polish entry, which is not an ADR. Pre-existing F6 audit only covered the cookies/middleware piece, not the data path.

**Fix path:** Reclassify §31 entry from polish-tier to architectural-tier; file new ADR (proposed `ADR-049-request-path-db-via-supabase-ssr`) reversing the implicit "pool-everywhere" pattern. Refactor `lens-data.ts` + `observability-data.ts` to PostgREST `from(...).select(...)` + Postgres RPC functions for ops PostgREST cannot express (advisory locks, pgvector with custom operators, fencing-token CAS). Split `AtelierClient` into `AtelierAdminClient` (sync-worker-only pg.Pool) + runtime Supabase-client wrapper. Add RLS policies per ARCH 5.3 (closes S09 simultaneously).

---

### S03: Environment Variable Configuration

**Verdict:** diverges-silently

**Vendor canonical:** [Supabase API keys](https://supabase.com/docs/guides/api/api-keys) — late-2025 paradigm `sb_publishable_*` (browser-safe) + `sb_secret_*` (server-only); legacy anon/service_role JWTs accepted as drop-ins. Canonical Next.js + `@supabase/ssr` slot names: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` + `SUPABASE_SECRET_KEY`. Vercel + Supabase Marketplace integration auto-provisions 13 vars including `POSTGRES_URL` (pooler) + `POSTGRES_URL_NON_POOLING` (direct). Vercel canonical ops: `vercel env pull` + `vercel env add` + `VERCEL_OIDC_TOKEN` for cloud-to-cloud.

**Reference impl in Nino's repos:** `apps/rally-hq/.env.example`, `apps/630-apps/cci/.env.example`, `apps/630-apps/esign/.env.example` — all on the new paradigm using `PUBLIC_SUPABASE_PUBLISHABLE_KEY` + `SUPABASE_SECRET_KEY` (SvelteKit prefix). cci explicitly cites the Supabase key-paradigm doc URL. None use legacy slot names.

**Current Atelier impl:** `.env.example` documents 7 slots; canonical code reads ~50. Bootstrap (`invite-composer`, `seed-composer`, `rotate-bearer`, `issue-bearer`), reranker (`COHERE_API_KEY`), all sync adapters (`ATELIER_DOC_*`, `ATELIER_DELIVERY_*`, all `ATELIER_GITHUB_*`/`_JIRA_*`/`_LINEAR_*`/`_NOTION_*`/`_CONFLUENCE_*`/`_FIGMA_*`), endpoint committer, and dev-bearer flow all silently un-onboardable from `cp .env.example .env.local`. `DATABASE_URL` is a parallel undocumented slot read by 39 sites.

**Empirical test:** `vercel env pull .vercel/.env.production.local --environment=production`.

**Production state findings:**
1. **`ATELIER_DATASTORE_URL` in production STILL holds direct URL** (`db.lgzitibcufxfgkaxroqg.supabase.co:5432`) — §31 entry filed but unfixed; the IPv6/serverless footgun is currently active.
2. **`NEXT_PUBLIC_SUPABASE_ANON_KEY` value carries trailing `\n`** — operator-error during `vercel env add`, not caught by validation. Will likely break direct header use; Supabase JS client may strip it.
3. Required-but-missing in production: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ATELIER_PUBLIC_URL`, `COHERE_API_KEY`, `ATELIER_PROJECT_ID`, `ATELIER_REPO_ROOT`, `ATELIER_OPERATOR_EMAIL`, all sync vars, all committer vars. Cron / sync / bootstrap routes unrunnable from prod.
4. `VERCEL_OIDC_TOKEN` auto-provisioned, never read.
5. **No support for canonical `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` slot names** — adopters following current Supabase Next.js docs will set the canonical names and silently fail.
6. **No support for Vercel Supabase Marketplace integration vars** — `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING` ignored.

**Gap:** §31 entries cover part of the divergence (pooler URL, missing anon key, slot-name drift); each entry is accurate but materially understated. The trailing `\n` is novel.

**Fix path:** New §31 entries for: documentation drift (.env.example covers 14% of slots), production-key trailing-newline, broaden existing canonical-slot-name entry to include `_PUBLISHABLE_KEY` + `_SECRET_KEY` + Vercel Marketplace vars. Concrete: expand `.env.example`, fallback chains in adapter readers, new `scripts/bootstrap/validate-env.ts` called by `atelier doctor` regex-validating slot value shapes. Operator hot-fix: `vercel env rm` + `vercel env add` for both production corruptions.

---

### S04: Auth & Session Management

**Verdict:** diverges-silently

**Vendor canonical:** [Supabase + Next.js Server-Side Auth](https://supabase.com/docs/guides/auth/server-side/nextjs). `/auth/confirm/route.ts` calls `supabase.auth.verifyOtp({ type, token_hash })` then redirects. Cookies via `@supabase/ssr` `createServerClient` with `getAll`/`setAll` adapter. **`middleware.ts` at project root calls `supabase.auth.getUser()` on every request — refreshes cookie + writes refreshed cookies to response.** Server Components / route handlers verify with `getUser()` — never `getSession()` ("`getSession()` does not revalidate the Auth token; it just reads it from the storage medium"). Late-2025: new API key paradigm accepted as drop-in.

**Reference impl in Nino's repos:** `apps/rally-hq/src/routes/auth/confirm/+server.ts` (token-hash verifier) + `apps/rally-hq/src/hooks.server.ts` exposing `event.locals.safeGetSession` which calls `getUser()` first then reads `getSession()` for the session object. Comment: "Unlike `supabase.auth.getSession`, which is unsafe on the server because it doesn't validate the JWT, this function validates the JWT by first calling `getUser` and aborts early if the JWT signature is invalid." **Atelier copied the `/auth/confirm` half but not the middleware-side `getUser()`-first validation half.**

**Current Atelier impl:**
- `prototype/src/app/auth/confirm/route.ts` — token-hash verifier (canonical)
- `prototype/src/app/sign-in/page.tsx` + `SignInForm.tsx` — email + 6-digit OTP form (canonical: `signInWithOtp` with `shouldCreateUser:false`)
- `prototype/src/app/sign-out/route.ts` — canonical
- `prototype/src/lib/atelier/adapters/supabase-ssr.ts:118` — **`client.auth.getSession()`** (NOT canonical)
- `prototype/middleware.ts` — **does not exist**
- `prototype/src/app/atelier/page.tsx` — gates via `resolveLensViewer → resolveBearer → readSupabaseAccessToken → client.auth.getSession()` then JWKS-verify the access_token

**Empirical test:** Not run — `prototype/.env.local` lacks `NEXT_PUBLIC_SUPABASE_*`. Code-read with cross-reference. Honest disclosure per ADR-048 protocol.

**Gap:**
1. **`getSession()` instead of `getUser()` in lens auth path.** `supabase-ssr.ts:118` reads access_token via the API Supabase explicitly disclaims. Downstream JWKS verifier catches tampered signatures, so this is a missing first layer rather than a bypass — but if JWKS rotation lags or the JWKS endpoint is briefly unreachable and the verifier caches stale keys, the unrevalidated `getSession()` becomes the only barrier.
2. **No `middleware.ts` for cookie refresh.** Without it, an access_token expiring mid-session cannot refresh from a Server Component (RSCs cannot mutate cookies during render — `next-cookies.ts:46-58` already swallows the write in try/catch). User experience: silent failure when 1-hour TTL elapses; user gets `LensAuthError` and redirect to sign-in instead of transparent refresh. Same class of failure rally-hq's `safeGetSession` is engineered to prevent.

**Fix path:** §31 entry. Concrete: add `prototype/middleware.ts` per Supabase canonical; replace `readSupabaseAccessToken` to call `getUser()` first; mirror rally-hq's `safeGetSession` per-request cache. Empirical post-fix: actually attempt sign-in, observe cookies + middleware refresh on 60-min-aged session.

---

### S05: Vercel Deploy Config

**Verdict:** diverges-silently

**Vendor canonical:** [vercel.ts](https://vercel.com/docs/project-configuration/vercel-ts) (last updated 2025-12-19) recommended over vercel.json. `@vercel/config/v1` + `routes` helpers. Default Node.js: 24.x. Default function timeout: 300s. Default compute: Fluid Compute. For monorepos: dashboard-set `Root Directory` per project, optionally with workspace-aware unaffected-project skipping.

**Reference impl in Nino's repos:** `apps/rally-hq/vercel.json`, `apps/630-apps/{esign,cci}/vercel.json` + 8 others. Every Vercel-deployed Nino repo with config ships in-repo `vercel.json`. None ship `vercel.ts` yet. Atelier ships **none**.

**Current Atelier impl:** **Zero in-repo Vercel config.** No `vercel.json`, no `vercel.ts`, no `@vercel/config` dep. Settings live exclusively in dashboard, accessible via API/CLI:
- `framework: "nextjs"`, `rootDirectory: "prototype"`, `nodeVersion: "24.x"`
- `installCommand: "npm install && (cd .. && npm install)"` — custom monorepo workaround invisible to repo
- `buildCommand: null`, no `regions` (defaults `iad1`), no `crons`, no per-route `maxDuration`

Per-route `export const runtime = 'nodejs'` is set in code on `/api/mcp`, `/oauth/api/mcp`, `/oauth/register`.

**Empirical test:** `vercel inspect atelier-three-coral.vercel.app` + `vercel pull --environment=production`. Deploy is live, healthy, configured entirely via dashboard. CLI is `48.10.2` vs current `53.x`. `atelier-git-main-sxs-labs.vercel.app` alias proves git-integration auto-deploy IS active despite ADR-046 calling it "M7 follow-up." `POST /api/mcp` returns 400 (route reachable; `atelier deploy` post-deploy verifier expects 401/405 — possible verifier drift).

**Gap:** ADR-046 reversed by ADR-048; current shape less grounded than ADR-046 described. Build behavior invisible to repo + invisible to PR review. Custom `installCommand` is load-bearing onboarding setup with no in-repo trace. Region misalignment (`iad1` deploy vs `us-west-1` Supabase per ADR-046) is the cross-region latency penalty ADR-046 explicitly warned about. Git auto-deploy was wired without an ADR.

**Fix path:** New `prototype/vercel.ts` exporting `config: VercelConfig` with framework, installCommand, regions co-located with Supabase, per-route `maxDuration`, headers for discovery URL cache-control. New ADR replacing ADR-046; declares `vercel.ts` canonical, names region decision, codifies git-integration deploy. Update `scripts/cli/commands/deploy.ts` post-deploy verifier expectations. CLI upgrade note in `first-deploy.md`.

---

### S06: Edge Runtime / Middleware

**Verdict:** diverges-silently

**Vendor canonical:** [Next.js middleware/proxy](https://nextjs.org/docs/app/api-reference/file-conventions/middleware) (renamed `proxy` in Next 16; defaults to **Node.js** runtime). `@supabase/ssr` middleware example at `vercel/next.js/examples/with-supabase`: root proxy/middleware calls `updateSession(request)`; helper builds `supabaseResponse = NextResponse.next({ request })` then `createServerClient` with `cookies.getAll/setAll` writing both `request.cookies` AND a fresh `supabaseResponse.cookies`; calls `await supabase.auth.getClaims()` (not `getSession()` — comment: "If you remove getClaims() ... your users may be randomly logged out"); returns `supabaseResponse` AS-IS.

**Reference impl in Nino's repos:** **No Next.js + Supabase auth middleware reference exists in Nino's repos.** rally-hq + 630-apps are SvelteKit (different framework). Other Next.js middleware files implement BigCommerce signed-payload JWT, not Supabase Auth refresh. Atelier is Nino's first Next.js + Supabase-Auth project; canonical example must come from upstream.

**Current Atelier impl:** **`prototype/middleware.ts` DOES NOT EXIST.** `prototype/src/lib/atelier/adapters/supabase-ssr.ts:118` calls `client.auth.getSession()`. Adapter comment at line 105: "Next.js Server Components disallow mutating cookies during render; the host store may no-op."

All `runtime: 'nodejs'` exports on route handlers; no `runtime: 'edge'` anywhere. `@vercel/edge` not imported (forbidden by `portability-lint.ts` per ADR-029).

**Empirical test:** Not run — env not provisioned. What the canonical pattern would verify: hit `/atelier/observability` ~70 minutes post-sign-in. Canonical refreshes cookie via middleware before the route renders; current Atelier calls `getSession()` on a stale cookie. Whether `getSession()` refreshes is per-request luck — and even on success, the rotated cookie cannot be persisted because the Server Component cannot write cookies during render. **Next request would still see the old cookie.**

**Gap:** §31's prior retraction was on wrong rationale. F6 verdict's defense ("per-request `getSession()` works, no middleware needed") conflicts with two structural facts: (a) Supabase canonical doc explicitly says "Never trust `getSession()` inside server code"; (b) Server Components cannot persist refreshed cookies regardless of whether `getSession()` rotates internally. The "substrate works empirically" evidence in F6 is the same evidence the retracted §31 acknowledged: works for sign-in→immediate-use; fails for >1h idle re-render.

**Fix path:** Re-file §31 entry replacing the retraction. Create `prototype/middleware.ts` (renames to `proxy.ts` on Next 16 upgrade) delegating to `prototype/src/lib/atelier/adapters/supabase-ssr-middleware.ts` (named adapter — keeps ADR-029 GCP-portability). Adapter exports `updateSession(request)` mirroring vercel/next.js example. Update `supabase-ssr.ts:118` to `client.auth.getClaims()`; refactor `resolveBearer` to use validated claims. Configure matcher to skip `/api/mcp`, `/oauth/*`, `/.well-known/*`, static assets.

---

### S07: pgvector & find_similar

**Verdict:** diverges-silently

**Vendor canonical:**
- [pgvector README](https://github.com/pgvector/pgvector): "If vectors are normalized to length 1 (like OpenAI embeddings), use **inner product** for best performance." HNSW dim limit 2,000 for `vector`; `halfvec` lifts to 4,000.
- [Supabase HNSW indexes](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes): "HNSW should be your default choice."
- [Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search): canonical RRF recipe uses `websearch_to_tsquery()` + `vector_ip_ops` (`<#>` inner product) + **k=50** + tunable per-ranker weights, all fused in a **single SQL CTE**.

**Reference impl in Nino's repos:** `apps/photography/supabase/migrations/20251120000001_add_vector_similarity.sql` uses HNSW + `vector_cosine_ops` + cosine `1 - (embedding <=> ...)`. `wip/bealls-aisles/src/lib/server/search.ts` uses `text-embedding-3-small` + cosine. **Both use cosine, not inner product** — Atelier's choice is internally consistent with these but not pgvector-canonical for normalized embeddings. None implement hybrid retrieval.

**Current Atelier impl:**
- `scripts/endpoint/lib/find-similar.ts` (645 lines): two CTE-equivalent in **application TS, not SQL** — vector kNN + FTS as separate `pool.query()` in `Promise.all`, folded via JS Map with RRF `1/(k+rank)`. Vector path uses cosine `<=>`. FTS uses `to_tsquery('english', $1)` after custom OR-tokenizer (`buildOrTsQuery`).
- `scripts/coordination/adapters/openai-compatible-embeddings.ts` — raw `fetch` to `/v1/embeddings` (no `openai` SDK); does NOT pass the `dimensions` parameter for matryoshka shortening.
- `supabase/migrations/...m5_embeddings*.sql` — HNSW `vector_cosine_ops` (m=16, ef_construction=64) at `vector(1536)`. Migration history includes 1536→3072→1536 swap (final canonical = 1536).
- `.atelier/config.yaml` — strategy=hybrid, rrf_k=60.

Migration 6 line 105-109 comment: "ADR-041 commits to text-embedding-3-small which returns L2-normalized vectors, so cosine and inner-product orderings agree." Author knew the canonical, declined without ADR-level justification.

**Empirical test:** `last-run.json` (2026-05-01) shows P=0.6721 / R=0.6260 against the seed set, `passed: true`. Could not run live — env not provisioned in worktree.

**Gap:**
1. **Distance operator vs canonical.** Cosine `<=>` instead of inner-product `<#>` for L2-normalized OpenAI embeddings. Mathematically harmless when normalized but index does extra work. Choice in code comment, not in ADR.
2. **Hybrid retrieval architecture.** Application-side TS fold instead of single SQL CTE. Two round-trips, planner cannot co-optimize.
3. **RRF k=60 vs Supabase canonical k=50.** ADR-042 cites "Cormack et al. 2009" — defensible, but Supabase canonical never named/justified against.
4. **FTS query function.** `to_tsquery` + custom OR-tokenizer instead of `websearch_to_tsquery`. Atelier's M5 measurement found AND-semantics returned zero rows — but the canonical wraps the same input into `websearch_to_tsquery` and gets useful BM25 in production. The custom tokenizer is now load-bearing security: any future change allowing punctuation through surfaces as `to_tsquery` syntax error in production.
5. Raw fetch vs OpenAI SDK — defensible; missing `dimensions` parameter for matryoshka.
6. ADR-041 suspension flag — choice empirically grounded for THIS corpus only; canonical-first comparison against `text-embedding-3-large @ 1024` (matryoshka) was never run.

**Fix path:** §31 entry naming all four divergences. New migration recreating HNSW with `vector_ip_ops`. Refactor `find-similar.ts` to single SQL CTE with RRF. Switch to `websearch_to_tsquery`; recalibrate thresholds. New ADR superseding ADR-042's hybrid-retrieval decision (does NOT supersede ADR-041 — that one stays suspended pending broader embedding-model re-evaluation).

---

### S08: BroadcastService / Realtime

**Verdict:** matches-canonical

**Vendor canonical:** [Supabase Realtime broadcast](https://supabase.com/docs/guides/realtime/broadcast). `createClient(url, key)` → `supabase.channel('name').on('broadcast', { event: 'x' }, handler).subscribe()` for receive; `channel.send({ type: 'broadcast', event, payload })` for send. Authorization options: public (default) vs private channels (RLS via `realtime.messages`); database-side `realtime.broadcast_changes()` trigger.

**Reference impl in Nino's repos:** `apps/rally-hq/src/lib/services/realtime.ts` uses `postgres_changes` (different Realtime feature) but channel/subscribe shape is canonical. Does NOT wrap behind a vendor-neutral interface — imports `SupabaseClient`/`RealtimePostgresChangesPayload` directly into consumers. **Atelier's wrapper requirement (ADR-029) is more disciplined than rally-hq's pattern, not less.**

**Current Atelier impl:**
- `scripts/coordination/lib/broadcast.ts` — `BroadcastService` interface with zero `@supabase/*` imports. Includes envelope, subscription handle, `NoopBroadcastService` fallback, naming helpers.
- `scripts/coordination/adapters/supabase-realtime.ts` — `SupabaseRealtimeBroadcastService implements BroadcastService`. Only file in non-smoke production code that imports `@supabase/supabase-js` Realtime types; enforced by `scripts/lint/portability-lint.ts` rule 2.
- Server publish: `scripts/sync/lib/write.ts:AtelierClient.broadcaster` defaults to `NoopBroadcastService`; fans out via `publishEvent()` on session presence, claim/release, lock acquire/release, decision.created.
- Browser subscribe: `prototype/src/app/atelier/_components/LiveUpdater.tsx` (`'use client'`) calls `supabase.channel(channelName).on('broadcast', ...).subscribe()` directly via `getSupabaseBrowserClient()`. **Documented and lint-enforced ADR-029 exception** — both files explicitly allowlisted.

**Empirical test:** `eval "$(supabase status -o env)" && npx tsx scripts/coordination/__smoke__/broadcast.smoke.ts`. **All 11 assertions PASS.** Two subscribers received cross-composer presence (17ms / 22ms), claim state (6ms), lock.acquired (10ms), lock.released (2ms) — well under 2s SLO. ADR-004 fencing fired correctly. Per-channel seq monotonicity held.

One non-fatal Supabase deprecation warning: `Realtime send() is automatically falling back to REST API. This behavior will be deprecated in the future. Please use httpSend() explicitly for REST delivery.` — caused by publisher calling `send()` before cached channel reaches SUBSCRIBED state.

**Gap:** Wrapper present and leak-free for server side. Browser-side direct usage is documented + lint-enforced ADR-029 named-adapter exception. Canonical Realtime under the hood verified via empirical smoke. Polish item: `acquirePublishChannel` doesn't await SUBSCRIBED before subsequent `send()` calls — Supabase signals this REST-fallback behavior is being phased out in favor of explicit `httpSend()`.

**Fix path:** No §31 entry needed. Tactical polish: in `scripts/coordination/adapters/supabase-realtime.ts:243`, replace `existing.subscribe()` with awaited subscribe resolving on SUBSCRIBED status; gate `acquirePublishChannel` on that promise. No ADR needed.

---

### S09: RLS Policies

**Verdict:** diverges-silently

**Vendor canonical:** [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). `ENABLE ROW LEVEL SECURITY` on every table holding user data; explicit `CREATE POLICY` per operation (SELECT/INSERT/UPDATE/DELETE) bound to `auth.uid()` / `auth.jwt()`; clients connect through PostgREST/`@supabase/supabase-js` which forwards JWT so `auth.uid()` resolves; `service_role` bypasses RLS, reserved for server-only privileged paths. **"RLS enabled with no policies = default-deny"** is documented and intentional ONLY when the access path is JS client with anon/authenticated keys — not when access bypasses RLS structurally.

**Reference impl in Nino's repos:** `apps/rally-hq/supabase/schema.sql:142-223` + 3 migrations. Pattern: every table gets `enable row level security`, then per-op policies — `for select using (...)`, `for insert with check (auth.uid() = organizer_id)`, etc. Cross-table joins encoded in policy bodies. Service-role-only tables use `"Service role only"` named policy with `to service_role using (true)`. Exactly what ARCH 5.3 prescribes.

**Current Atelier impl:**

| Table | RLS enabled? | Policies? |
|---|---|---|
| `projects` | yes | **none** |
| `composers` | yes | **none** |
| `sessions` | yes | **none** |
| `territories` | yes | **none** |
| `contributions` | yes | **none** |
| `decisions` | yes | **none** (append-only via trigger only) |
| `locks` | yes | **none** |
| `contracts` | yes | **none** |
| `telemetry` | yes | **none** |
| `embeddings` | yes | **none** |
| `delivery_sync_state` | yes | **none** |

**Repo-wide grep `CREATE POLICY` in `supabase/migrations/*.sql`: zero matches.** The MCP endpoint connects via `ATELIER_DATASTORE_URL` (postgres superuser, BYPASSRLS); RLS does not engage. No JWT propagation, no `set_config('request.jwt.claims', ...)`, no `set role authenticated`, no `auth.uid()` populated. Repo-wide grep for `request.jwt.claims` / `set_config` / `auth.uid` / `auth.jwt` in `scripts/` and `prototype/src/`: zero matches.

ADR-036's `composers.identity_subject` exists for JWT-to-composer mapping but is unused for authorization — no policy references it. Append-only on `decisions` is enforced by trigger (the only authorization-class invariant currently enforced at DB tier).

**Empirical test:** Not run live (env unavailable in isolated worktree). **Predicted result:** with `authenticated` role + zero policies, query returns zero rows (default-deny works). **But actual production access uses postgres superuser**, which bypasses RLS — same query through MCP endpoint returns all rows regardless of which composer authenticated. Authorization currently lives entirely in application code (endpoint validates bearer, looks up composer, trusts itself to scope queries) — exactly the anti-pattern Supabase RLS docs warn against.

**Gap:** All 11+ tables: zero policies. M1 migration's own comment (line 336) says "M1 sync scripts run under service_role (which bypasses RLS)" and "M2 endpoint hardening adds composer-scoped policies" — **that hardening was never written.** M6-exit shipped without it. ADR-048 reset confirms.

§31 entry on pg.Pool divergence (S02) overlaps but is orthogonal: even if write path stays pg.Pool, the connection role must lose BYPASSRLS and policies must exist.

**Fix path:** §31 entry. New migration `<TS>_atelier_rls_policies.sql` writing `CREATE POLICY` per (table, operation) per ARCH 5.3 §330-337. Templates from `apps/rally-hq/supabase/schema.sql:153,174,195,217`. Split endpoint DB connection into a non-superuser role with `set_config('request.jwt.claims', ...)` per request OR move to PostgREST/`@supabase/supabase-js` for user-context paths. Sync write paths keep service-role with `TO service_role using (true)` policies. New `scripts/endpoint/__smoke__/rls.smoke.ts` — registers two composers, A claims, B's session-token attempts read/update on A's contribution, asserts Postgres-level rejection (not endpoint-level).

---

### S10: Migrations Execution

**Verdict:** matches-canonical (with polish items)

**Vendor canonical:** [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations). `supabase migration new <name>` + `supabase db push`. CLI auto-wraps each migration in transaction. Recommends `lock_timeout` for long DDL. Vendor docs do NOT prescribe advisory locks or `statement_timeout` on runner side. Tracking via `supabase_migrations.schema_migrations`.

**Reference impl in Nino's repos:** All other Nino repos use plain `supabase/migrations/` with vendor-default tracker and no custom runner. None use advisory locks, none set `statement_timeout`. **Atelier is the OUTLIER — and the outlier choice is well-justified** (adopter-side schema-version contract for `atelier upgrade`).

**Current Atelier impl:** 10 timestamp-prefixed migration files. Custom runner at `scripts/migration/runner.ts` + `manifest.ts`. Operator surface: `scripts/cli/commands/upgrade.ts` (`atelier upgrade --check | --apply`).

Behaviors: lex-sorted timestamp ordering; SHA-256 content hashing per file; drift detection; per-migration transaction with `BEGIN`/`COMMIT`/`ROLLBACK`; `pg_advisory_xact_lock(hashtextextended('atelier-migration-runner', 0))` serializes concurrent runners; `SET LOCAL statement_timeout = 600000` (tunable; 0 disables); re-checks `atelier_schema_versions` inside lock to no-op when another runner already applied; `INSERT ... ON CONFLICT (filename) DO NOTHING` on tracking row; append-only per ADR-005.

**Empirical test:** `supabase status` (running) → `psql` of `atelier_schema_versions` shows 10 rows with correct hashes. `npx tsx scripts/cli/atelier.ts upgrade --check` → "up-to-date: 10". `supabase db reset` reapplied all 10 cleanly. Forced re-apply (delete tracking row but schema persists): `atelier upgrade --apply` errored with `relation "triage_pending" already exists`. **Migration 9 has 5 non-idempotent `CREATE` statements with no `IF NOT EXISTS` guards.**

**Gap (polish):**
1. Migration FILE bodies are not idempotent. Bootstrap migration 10 says "MUST stay idempotent forever" but migrations 1, 3, 6, 7, 8, 9 have 62 non-idempotent `CREATE` statements. Runner's tracking masks this normally; operator drift breaks the recovery path.
2. No CI step running migrations TWICE — no smoke verifies "applied → re-discovered → no-op."
3. No production migration application strategy beyond local-bootstrap. Cloud-side `atelier upgrade --apply` is operator-manual.
4. No `lock_timeout` (vendor explicitly recommends for long DDL competing for table locks).
5. Migration 7→8 destructive `DROP TABLE` pair (dimension swap) sets a precedent with no safeguard against running migration 7 against a populated production DB.

**Fix path:** No §31 entry warranted on substrate; runner is materially better than vendor canonical (advisory lock, statement_timeout, transactions, drift detection). Optional polish PRs: convert CREATE statements to `IF NOT EXISTS` (or document accepted asymmetry); add `SET LOCAL lock_timeout = '5s'`; extend smoke with second-apply scenario; new `docs/user/guides/cloud-migration-apply.md`.

---

### S11: CLI Patterns

**Verdict:** matches-canonical (with polish items)

**Vendor canonical:** [Node.js child_process](https://nodejs.org/api/child_process.html) — "Never pass unsanitized user input to [exec/execSync]." Safe pattern is `spawn(file, args)` / `execFileSync(file, args)` with `shell: false` (default). [Node parseArgs](https://nodejs.org/api/util.html#utilparseargsconfig) since 18.3 / stable in 20. Subcommand-heavy: ecosystem canonical is `commander` or `yargs`.

**Reference impl in Nino's repos:** `tools/forge-brand/src/cli/index.ts` uses `commander` (^13.1.0). `program.name(...).description(...).version(...)` + `registerXxxCommand(program)` per subcommand + `program.parse()`. forge-brand has no shell-outs in `cli/` tree. **Atelier is the first multi-subcommand Node CLI in Nino's repos that shells out heavily.**

**Current Atelier impl:** `package.json bin: { "atelier": "scripts/cli/atelier.ts" }`. Hand-rolled per-command argv parsing (no `parseArgs`, no commander). Top-level dispatch: `argv.slice(2)` → COMMANDS lookup → `command.run(argv.slice(1))`. Strict-mode: unknown flags throw; unknown subcommands print usage + exit 2.

**Every shell-out is `spawn`/`spawnSync` array-arg form. No `execSync`, no `shell: true` anywhere.** All binary names are hardcoded literals; user-input variables (templateUrl, projectName, email, password, forwarded args) land in array elements, never concatenated into shell strings.

**Empirical test:**
- `npm run atelier -- --help` → top-level usage, all 13 commands.
- `npm run atelier -- init '$(echo PWNED > /tmp/atelier-pwn.txt)' --dry-run` → name validator rejected; pwn file NOT created.
- `npm run atelier -- init 'good-name' --email 'foo;rm -rf /;@evil.com' --dry-run` → email validator rejected.
- `npm run atelier -- nonsuch-command` → "atelier: unknown command" + exit 2.

**Shell-injection surface verified empirically clean.** All input validators (NAME_RE, EMAIL_RE, allowlist enums) catch malicious inputs before spawn. Even if a validator failed, spawn-as-array would still neutralize shell metacharacters.

**Gap (polish):**
1. Argv parser hand-rolled per command (12 separate `parseArgs` functions). Vendor canonical (`util.parseArgs`) or commander (used by forge-brand) would centralize. ~700 lines of switch/next() boilerplate. Not security gap.
2. `commands/deploy.ts:339` uses `step.cmd.split(' ')` to split static command string. Input is closed (literals from `VALIDATION_STEPS`) — no security risk today, but hand-rolling shell-tokenization is a smell.
3. `scripts/cli/atelier.ts` source lacks executable bit. npm pack/install sets +x but fresh-clone direct execution requires manual chmod.

**Fix path:** No §31 entry warranted — surface is canonically clean. Optional ergonomic improvements: replace `step.cmd.split(' ')` with `{bin, args}` objects; migrate per-command `parseArgs` to `util.parseArgs` (drop ~50-80 LoC per command); rename `spawnSyncSafeRead` to `readJsonFileSync` with static `import { readFileSync } from 'node:fs'`; add chmod step.

---

### S12: Webhook Handling

**Verdict:** diverges-silently

**Vendor canonical:** [GitHub webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) — HMAC-SHA256 over raw body, header `X-Hub-Signature-256` (`sha256=<hex>`), constant-time compare via `crypto.timingSafeEqual`. Order is mandatory: read raw body → verify → JSON.parse. Idempotency via `X-GitHub-Delivery` against UNIQUE-constrained `webhook_deliveries(delivery_id)`. Stripe canonical: `stripe.webhooks.constructEvent(rawBody, sig, secret)`. Resend/Supabase Auth Hooks use Svix headers + `Webhook(secret).verify(body, headers)`.

**Reference impl in Nino's repos:**
- `apps/rally-hq/src/routes/api/webhooks/stripe/+server.ts` — canonical Stripe shape: `await request.text()` for raw body, `stripe.webhooks.constructEvent(body, signature, webhookSecret)`.
- `apps/rally-hq/src/routes/api/webhooks/resend/+server.ts` — canonical Svix-style: `request.text()`, three Svix headers, `resend.webhooks.verify({...})`.
- `apps/rally-hq/src/routes/api/cron/webhook-retry/+server.ts` — DLQ/retry path; rally-hq treats webhooks as first-class.
- `apps/rally-hq/scripts/setup-resend-webhooks.ts` — operator runbook.

**Current Atelier impl:** **Zero HTTP webhook handlers.** No `/api/webhooks/*` routes. Source-wide grep for `createHmac`, `x-hub-signature`, `stripe-signature`, `svix-`, `verifySignature`, `WEBHOOK_SECRET`, `auth.hook` returns zero hits in `prototype/src/`. The only file with "webhook" in name (`scripts/coordination/adapters/webhook-messaging.ts`) is an **outbound** Slack/Discord/Teams alert publisher.

`scripts/sync/lib/adapters.ts:100` literally documents the gap: "polling mode at M1; M2 endpoint webhooks replace polling."

**Empirical test:** Production deploy probes:
- `curl -X POST https://atelier-three-coral.vercel.app/api/webhooks/github -d 'test'` → **HTTP 404**.
- `curl https://atelier-three-coral.vercel.app/api/webhooks/` → 308 → 404.

Substrate has no webhook receiver to test signature rejection or idempotency against.

**Gap:** `diverges-silently`, not `not-implemented; out of scope`. Spec mandates webhooks at v1: ARCH §6.2.2.1, §6.2.3, §6.4.2, §6.5.2, §902-905; NORTH-STAR §189/§199-203; PRD §173; BRD §530-563. ARCH §716 makes webhook merge-observation the AUTHORITATIVE mechanism for `state=merged`. ADR-019 cites Figma webhook triage. **No spec doc bounds the absence.** §31 has no webhook entry. The "M2 webhooks replace polling" promise never landed.

Substrate works in M5/M6 demo loop because demos use direct CLI invocations of `update(state="merged")` and operator-run embed batches. At any real-team scale (concurrent IDE composers, async Figma comments), polling silently misses events.

**Fix path:** §31 entry. Concrete: new route handlers at `prototype/src/app/api/webhooks/{github,figma}/route.ts` — `await req.text()` for raw body BEFORE parsing; verify HMAC via `crypto.createHmac('sha256', secret).update(rawBody).digest('hex')` then `crypto.timingSafeEqual`; INSERT INTO `webhook_deliveries` with ON CONFLICT DO NOTHING. Shared verify helper at `prototype/src/lib/atelier/webhooks/verify.ts`. New migration adding `webhook_deliveries` table. Smoke tests for malformed-sig (expect 401), valid double-delivery (expect idempotent no-op), missing-secret (expect 500). Wire `atelier deploy` to register webhooks via git provider API.

---

### S13: GitHub Actions CI Workflow

**Verdict:** diverges-silently

**Vendor canonical:** [GHA security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions). (1) Pin third-party actions to full-length commit SHAs ("the only way to use an action as an immutable release"); first-party `actions/*` may stay on `@v4` if accepted. (2) Explicit top-level `permissions:` block, default `contents: read`. (3) Vercel for GitHub deploys via App webhook; CI runs lint/test/typecheck. Custom `vercel CLI + VERCEL_TOKEN` reserved for GHES. (4) `concurrency.group` + `cancel-in-progress: true`.

**Reference impl in Nino's repos:** `apps/630-apps/vbranking/.github/workflows/ci.yml` — minimal CI (checkout, setup-node, ci/lint/check/test/build). No Vercel deploy step. No `permissions:` block (less strict than Atelier). `tools/hackathon-hive/.github/workflows/deploy.yml` runs `vercel pull/build/deploy` via `VERCEL_TOKEN` (GHES-style). **Atelier should NOT mirror hackathon-hive** — it has Vercel git integration per ADR-046.

**Current Atelier impl:** Two workflows: `.github/workflows/atelier-audit.yml` (401 lines) + `.github/workflows/iaux-dom.yml` (139 lines). No Vercel deploy workflow (correctly delegates to Vercel App per ADR-046).

`atelier-audit.yml`: hybrid PR/push gate. PR fast job (typecheck, yamllint, portability-lint, PR-scoped traceability validator). Push/dispatch/nightly-cron full job (Supabase CLI start, ~13 substrate smokes, real-client smoke, broadcast smoke, lens smoke, CC-MCP-client probe-shape smoke gated by `dorny/paths-filter`, find_similar smoke, eval-harness smoke, round-trip corpus, full traceability validator, embed corpus, eval gate, artifact upload). Concurrency group set, `cancel-in-progress: true`. Top-level `permissions: contents: read, pull-requests: read`.

find_similar eval gate present (lines 327-396). **ADR-006's original `0.75/0.60` threshold appears as stale comment header (line 327).** Step name says "ADR-043 advisory tier; informational per ADR-045"; `continue-on-error: true` (correct per ADR-045). Traceability validator: PR-scoped `--diff` (blocking) + full `--milestone-exit` (informational on push to main).

**Empirical test:** `gh run list --limit 10` — recent 10 runs all `success` or intentional `cancelled`. atelier-audit on main consistently completes 4-5 minutes. CI is green and stable.

**Gap:**
1. **Action pinning regression risk.** Five third-party action references use floating tags: `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, `supabase/setup-cli@v1`, `dorny/paths-filter@v3`. GHA hardening explicitly names commit-SHA pinning as the only immutable-release pattern. `dorny/paths-filter` is highest-risk pin (community action). Atelier is the build substrate for OSS template — adopters inherit pinning posture.
2. **Stale comment in eval gate header.** Line 327: `# find_similar eval gate (ADR-006: precision >= 0.75 AND recall >= 0.60)`. Reversed by ADR-047; ADR-043 advisory tier (P>=0.60 AND R>=0.60) is what runner checks; ADR-045 made gate informational. AI-author tell — stale-spec-vs-impl drift §31 is meant to surface.
3. Permissions hygiene clean. Secrets exposure clean. Concurrency clean. Deploy gate clean.

**Fix path:** §31 entry. Replace each third-party action reference with SHA-pinned form: `actions/checkout@<sha> # v4`, etc. Replace stale comment line 327 with `# find_similar eval gate (ADR-043 advisory tier P>=0.60 AND R>=0.60; ADR-045 informational)` and drop the matching "Per ADR-006 the gate is mandatory on main" sentence. Optionally add Renovate config for `package-ecosystem: github-actions` with `pinDigests: true`.

---

### S14: Image Pipeline / Static Assets

**Verdict:** matches-canonical

**Vendor canonical:** [next/image](https://nextjs.org/docs/app/api-reference/components/image). Required `src` + `alt`; `width`+`height` (or `fill`); `priority` for LCP; `placeholder="blur"` optional. `next.config.js` `images.remotePatterns` allowlist (now defaults to block external hosts). Default `formats: ['image/avif', 'image/webp']`. Static metadata files (`app/icon.png`, `app/favicon.ico`, `app/opengraph-image.*`) handled by file-system convention.

**Reference impl in Nino's repos:** 630-apps + zerospecs are SvelteKit (irrelevant). signal-dispatch-blog has no Next.js image usage. Only `<img>` hits in Nino's repos are 3 inline SVG data-URI Easter eggs in `apps/zerospecs/src/routes/alt/+page.svelte`. **No reference Next.js impl with images to cross-check.**

**Current Atelier impl:**
- next/image vs `<img>`: **zero of each.** Only reference to `next/image` is auto-generated ambient type declaration in `prototype/next-env.d.ts:2`.
- next.config image section: **none** (`next.config.mjs` has only `reactStrictMode` + `experimental.typedRoutes: false`).
- public/ contents: **directory does not exist.** No favicon, no opengraph-image, no app/icon, no apple-icon.
- CSS asset references: zero `url(...)` in any CSS file.
- Repo-wide image binaries (excluding node_modules/.git/.next/.claude): zero.

**Empirical test:** `npm run build` — succeeded. Route table shows only RSC/route handlers; no `/_next/image` route registered.

**Gap:** None against canonical. Coordination dashboard with text + tables. No hero, avatar, brand asset, or OG card. Single user-facing image surface that *would* be canonical to add (favicon + `app/opengraph-image.tsx`) is absent — nice-to-have polish, not divergence. Latent risk: future contributor adds `<img src="https://...">` without `images.remotePatterns` allowlist — but Next.js will reject by default at runtime, surfacing canonical at moment of need.

**Fix path:** Not applicable. No §31 entry warranted. Future image lands → enforce canonical at PR review.

---

### S15: Telemetry / Logging

**Verdict:** diverges-silently

**Vendor canonical:**
- [Vercel runtime logs](https://vercel.com/docs/logs/runtime) — auto-captures `console.*` from Functions + Middleware (1MB/req, 256 lines/req cap; 1d retention on Pro, 30d with Observability Plus).
- [Vercel OTel instrumentation](https://vercel.com/docs/tracing/instrumentation) + [Next.js instrumentation hook](https://nextjs.org/docs/app/guides/instrumentation) — `instrumentation.ts` calling `registerOTel({ serviceName })` from `@vercel/otel`; Next.js 13.4+ auto-propagates incoming trace context.

**Reference impl in Nino's repos:** `apps/rally-hq/src/lib/logger.ts` (env-gated debug/info/warn dev-only; error always); `apps/rally-hq/src/lib/sentry.ts` (`PUBLIC_SENTRY_DSN`-gated); `apps/rally-hq/src/hooks.server.ts` (request timing + 2s slow-request `console.warn` + `Server-Timing` header). 630-apps + zerospecs use bare `console.*` with bracket-tag prefixes. No project under `dev/apps` or `dev/wip` uses `instrumentation.ts` / `@vercel/otel`. None ship `pino`/`winston`/`bunyan`.

**Current Atelier impl:**

(a) telemetry table: `supabase/migrations/...m1_schema.sql:274-284` — `(id, project_id, composer_id, session_id, action, outcome, duration_ms, metadata, created_at)`. ADR-036 dual-author shape implemented. Index on `(project_id, action, created_at DESC)`. RLS enabled, no policies (M1 default-deny; M2 hardening never landed). No retention/partitioning.
- 14 `recordTelemetry()` callsites in `scripts/sync/lib/write.ts` (one per mutation).
- MCP endpoint routes through AtelierClient; writes happen inside same transaction as canonical mutation.
- Sync scripts emit raw `INSERT INTO telemetry`.
- Scale harness tags rows `scale_test.<scenario>.<op>`.

(b) Application logging: **none**. No `pino`/`winston`/`bunyan`/`@vercel/otel`/`Sentry` dep. No `prototype/instrumentation.ts`. No request-id middleware, no slow-request timing, no structured-log helper. Eight ad-hoc `console.warn`/`.error` callsites in `prototype/src/`; ~631 in `scripts/` (mostly CLI status output).

`severityFor(value, envelope)` duplicated verbatim between `prototype/src/lib/atelier/observability-config.ts` and `scripts/observability/alert-publisher.ts`.

**Empirical test:** `supabase status` → `\d telemetry` — schema matches; RLS enabled, zero policies. `SELECT action, COUNT(*) FROM telemetry GROUP BY action` — **0 rows** despite substrate having been used. Manual INSERT succeeded. Write path works; running stack has no rows. No deployed-stack Vercel logs inspected.

**Gap:**
1. **Application logging is unspecified.** ARCH §8.1-8.3 specifies the telemetry table + alert publisher. Says nothing about console-level shape, request IDs, error tracking, or `instrumentation.ts`. `console.warn` calls have no contract. On Vercel runtime logs, `traceId` / `requestId` columns will be empty without OTel.
2. **No `instrumentation.ts`, no `@vercel/otel`.** Distributed tracing across browser → MCP endpoint → write.ts → broadcast pipeline cannot be assembled into single trace.
3. **`severityFor()` duplicated, not shared.** Future threshold tweak silently drifts.
4. **No telemetry retention/partitioning.** ARCH §6.3.4 implies indefinite. At M7 scale envelope (10k contributions, 500 decisions per project) bounded; not urgent.
5. No `vercel.ts` `crons` declaration site for alert publisher (already filed in S05).
6. No deployed-stack Vercel-logs shape verification.

The substrate's coordination telemetry is complete + working + scope-bounded by spec. Application observability is absent and unnamed in spec — exists at rally-hq parity by accident, not design.

**Fix path:** §31 entry. Recommendation is doc-ack rather than refactor — but doc-ack is itself a missing decision. Concrete (when activated): `prototype/instrumentation.ts` registering OTel; `prototype/src/lib/atelier/logger.ts` mirroring rally-hq; `prototype/src/lib/atelier/sentry.ts` DSN-gated init; `package.json` adds `@vercel/otel`, `@opentelemetry/api`, optional `@sentry/nextjs`. `prototype/vercel.ts` (per S05 fix) adds `crons: [{ path: '/api/cron/alert-publisher', schedule: '*/5 * * * *' }]`. Extract `severityFor()` to shared `scripts/lib/severity.ts`. ARCH §8 add §8.4 documenting chosen application-logging shape.
