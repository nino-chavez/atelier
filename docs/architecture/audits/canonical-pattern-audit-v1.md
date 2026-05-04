---
applies_to:
  - prototype/src/app/oauth/api/mcp/route.ts
  - prototype/src/app/oauth/register/route.ts
  - prototype/src/app/.well-known/oauth-authorization-server/oauth/api/mcp/route.ts
  - prototype/src/app/.well-known/[...slug]/route.ts
  - scripts/endpoint/lib/oauth-discovery.ts
  - scripts/endpoint/lib/auth.ts
  - scripts/migration/manifest.ts
  - scripts/migration/runner.ts
  - supabase/migrations/20260504000010_atelier_schema_versions.sql
  - scripts/bootstrap/rotate-bearer.ts
  - scripts/bootstrap/issue-bearer.ts
  - scripts/coordination/adapters/webhook-messaging.ts
  - prototype/src/lib/atelier/adapters/supabase-ssr.ts
  - prototype/src/lib/atelier/adapters/supabase-browser.ts
  - prototype/src/app/api/cron/* (specced; not yet implemented)
  - vercel.ts / vercel.json (absent at audit time)
  - ARCH 7.9 (Web-surface auth flow), 9.7 (Template version upgrades)
  - ADR-027, ADR-029, ADR-044, ADR-046
  - METHODOLOGY 11.5b
audit_date: 2026-05-04
audit_kind: canonical-pattern (v1 backfill, one-time)
auditor: Claude Code (Opus 4.7) per METHODOLOGY 11.5b
status: complete; findings filed (1 §31 entry, 3 doc-only acks queued, 3 surfaces clean)
---

# Canonical-pattern audit (v1 backfill)

Per METHODOLOGY 11.5b. One-time backfill covering infrastructure surfaces in Atelier that predate the canonical-pattern pre-check discipline being codified (commit b5c7f10, 2026-05-04). The discipline was codified after D7 (sign-in) shipped a custom PKCE+gate when Supabase's canonical token-hash flow plus apps/rally-hq's working reference impl already existed; that custom shape broke in production and required a refactor (in flight on `sign-in-token-hash-refactor` as a separate PR).

This audit applies the §11.5b two-question test to seven other infrastructure surfaces:

1. Vendor canonical — does a vendor-recommended pattern exist for this primitive?
2. Internal reference impl — does a working implementation exist in `~/Workspace/dev/` (apps, wip, tools)?

The audit's job is to surface findings. Refactors are downstream PRs gated by activation criteria; per-finding ADRs only land if the retroactive ADR is genuinely load-bearing under the §6.1 ADR-hygiene test.

Out-of-scope (already justified per existing ADRs): locks + fencing (ADR-026 Switchman rejection), reference stack (ADR-027 SaaS-only canonical disqualified), embedding adapter (ADR-041 OpenAI-compatible IS canonical), 12-tool MCP surface (ADR-013/040 MCP IS canonical; 12 is Atelier's design within it), sign-in flow (D7 refactor in flight as separate PR).

---

## Findings

### F1. OAuth Connectors flow (MCP authorization)

- **Atelier choice:** Resource server publishes RFC 8414 Authorization Server Metadata path-prefixed at `/.well-known/oauth-authorization-server/oauth/api/mcp` pointing at the configured Supabase Auth issuer (`scripts/endpoint/lib/oauth-discovery.ts`). RFC 7591 Dynamic Client Registration stub at `/oauth/register` returns 405 with a documented error body so MCP-SDK probes don't bail (`prototype/src/app/oauth/register/route.ts`). MCP route at `/oauth/api/mcp` is an alias of `/api/mcp` differing only in URL + discovery-publishing surface (PR #14 split). Catch-all at `/.well-known/[...slug]/route.ts` returns JSON 404 (PR #16) so SDKs don't choke on Next.js HTML 404 pages.
- **Vendor canonical:** MCP Authorization specification (https://modelcontextprotocol.io/specification/) requires the resource server to publish RFC 9728 OAuth 2.0 Protected Resource Metadata at `/.well-known/oauth-protected-resource`, AND emit `WWW-Authenticate: Bearer resource_metadata="<url>"` on 401 responses pointing the client at that metadata. The PR-metadata document carries the `authorization_servers` array; the AS metadata (RFC 8414) is then fetched from the AS itself, not republished by the resource server.
- **Internal reference impl:** `apps/rally-hq/src/lib/services/oauth.ts` is itself an OAuth provider (issues OAuth apps + tokens for third-party integrations); structurally not an MCP-resource-server reference. None of `apps/`, `wip/`, `tools/` contains a comparable MCP-resource-server OAuth implementation.
- **Verdict:** ⚠ DIVERGED-JUSTIFIED-EMPIRICALLY (not-verified against MCP spec text in this audit; verified empirically via the M6 deploy that landed `https://atelier-three-coral.vercel.app` and the cc-mcp-client.smoke.ts probe-set). The substrate currently works because the Claude Code MCP SDK probes both `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` and accepts whichever responds. The path-prefixed 8414 split + RFC-7591 stub + clean 404 catch-all evolved as substrate-fixes (PRs #11, #13, #14, #16) addressing concrete SDK probe-failure modes; the choice was not informed by an explicit "publish 8414 path-prefixed instead of 9728 because…" decision in the spec.
- **Action:** Doc-only update to ARCH 7.9 acknowledging RFC 9728 as the canonical MCP-resource-server discovery shape and naming the empirical reasons the substrate ships path-prefixed 8414 instead (claude.ai Connectors + ChatGPT Connectors + Claude Code SDK probe both, accept whichever responds; PR #14 split prevents OAuth-flow preemption on the static-bearer route per ADR-046). NOT a §31 entry — substrate works under all currently-tested clients and the deploy is green; refactor to canonical 9728 only if a future MCP client surfaces a hard-require for 9728 OR the spec text is read end-to-end and identifies a compliance gap.

### F2. Migration tracking (E1)

- **Atelier choice:** `atelier_schema_versions` table in `public` schema (created by `supabase/migrations/20260504000010_atelier_schema_versions.sql`); columns are `filename`, `applied_at`, `content_sha256`, `applied_by`, `atelier_template_version`. Tracked + diffed by `scripts/migration/runner.ts` (E1 substrate; precondition for E2 `atelier upgrade`). Coexists alongside Supabase CLI's tracking; runner does not read or write `supabase_migrations.schema_migrations`.
- **Vendor canonical:** Supabase CLI uses `supabase_migrations.schema_migrations` (its own schema) maintained by `supabase db push` / `supabase migration up`. Schema is `version text` only — no content hash, no applied-by metadata, no template-version field.
- **Internal reference impl:** None in workspace. Other repos use Supabase CLI's default tracking; none implements an append-only-disciplined migration runner with adopter-modification detection.
- **Verdict:** ⚠ DIVERGED-JUSTIFIED. The canonical tracker lacks three columns Atelier's contract requires:
    - `content_sha256` — needed by ADR-005 append-only enforcement (runner.ts `computeStatus` flags adopter-modified files via SHA mismatch);
    - `applied_by` — needed for forensic traceability of who applied which migration in a guild context;
    - `atelier_template_version` — needed by ADR-031 three-tier consumer model so adopters can trace which Atelier release introduced each migration.
  The augment-the-canonical pattern (Supabase CLI applies; Atelier records its own augmented row alongside) is the right shape. **But the divergence is silent** — `migration-system.md` does not name `supabase_migrations.schema_migrations` as the canonical alternative or carry the explicit "why not canonical" sentence §11.5b requires.
- **Action:** Doc-only update to `docs/architecture/schema/migration-system.md` naming the canonical + the divergence justification. Separately: ARCH 9.7 line 1716 references "a `schema_migrations` table" — that's the Supabase canonical name; the actual Atelier table is `atelier_schema_versions`. Spec-vs-impl drift fix (ARCH 9.7 update). NOT a §31 entry — substrate works; this is documentation hygiene.

### F3. Bearer rotation (operator credential exchange)

- **Atelier choice:** `scripts/bootstrap/rotate-bearer.ts` uses Supabase JS client `auth.signInWithPassword({ email, password })` to exchange operator-supplied credentials for a fresh access_token; writes the token into `.mcp.json` headers. `scripts/bootstrap/issue-bearer.ts` uses the same shape for first-issue. `scripts/bootstrap/invite-composer.ts` uses `auth.admin.generateLink({ type: 'magiclink' })` for the orthogonal invite-pending-user flow.
- **Vendor canonical:** Supabase Auth password grant via `signInWithPassword` IS the canonical operator-credential-to-JWT exchange for known-identity / known-password flows. `auth.admin.generateLink` is canonical for sending magic-links to invited users (different use case — pending identity, no password). `auth.admin.createSession` is not a stable Supabase Auth API as of late-2025 / 2026-Q1; the closest is `signInWithIdToken` (custom JWT), which is for federated-identity flows, not local credential exchange.
- **Internal reference impl:** `apps/rally-hq/src/routes/login/+page.server.ts` and `apps/rally-hq/src/routes/api/dev-auth/+server.ts` both use `signInWithPassword` for the same operator-credential exchange shape.
- **Verdict:** ✓ CANONICAL. The premise that "Supabase canonical for issuing bearers via admin is `auth.admin.generateLink`" is a slight misread of the Supabase API surface — that primitive is for invite/recovery flows where the user has not yet established a password, not for refreshing a known-identity bearer. Atelier's choice matches both the canonical pattern and the rally-hq reference impl.
- **Action:** None.

### F4. Webhook adapter shape (outbound messaging)

- **Atelier choice:** `scripts/coordination/adapters/webhook-messaging.ts` dispatches alerts via HTTPS POST to a configurable webhook URL; auto-infers per-vendor body shape (Slack blocks, Discord embeds, Teams plain-text fallback, generic JSON) from the URL host pattern; uses `node:fetch` (no Vercel-specific or Supabase-specific imports per ADR-029).
- **Vendor canonical:** Outbound webhooks are HTTPS POST with vendor-specific JSON body shapes — Slack incoming webhooks, Discord webhooks, Teams incoming webhooks, generic-receiver JSON. No vendor SDK is required or recommended for the outbound case; `fetch` is the standard.
- **Internal reference impl:** None directly comparable. Other repos in workspace either don't ship a multi-vendor messaging adapter or use vendor-specific SDKs (slack-bolt, discord.js) that ADR-029 explicitly excludes for portability.
- **Verdict:** ✓ CANONICAL.
- **Note (out-of-scope for this audit but worth flagging):** INBOUND webhook receivers (versioned-file-store commit webhooks per ARCH 6.2.2.1; comment-source webhooks per ARCH 6.5) are specced but not yet implemented — sync runs in poll mode at v1 per `scripts/sync/lib/adapters.ts:100` ("M2 endpoint webhooks replace polling"). When the inbound surface ships, the canonical-pattern pre-check should re-run on it (vendor signature verification, replay protection, idempotency keys).
- **Action:** None.

### F5. Vercel deployment config

- **Atelier choice:** NO `vercel.json` and NO `vercel.ts` anywhere in the repo. The Vercel project relies entirely on Next.js framework auto-detection plus dashboard-side configuration (rootDirectory=prototype per ADR-046, deployed via the GitHub-integration auto-deploy path per `docs/user/guides/enable-auto-deploy.md`).
- **Vendor canonical:** Per the 2026-02 Vercel Knowledge Update injected at session start, `vercel.ts` is the current recommended config-as-code shape (typed, dynamic logic, env-var access via `@vercel/config`). `vercel.json` is the legacy alternative. Vercel projects are expected to ship one of the two even when relying mostly on framework defaults — the file is the canonical declaration site for crons, rewrites, headers, build commands, and rootDirectory.
- **Internal reference impl:** `apps/630-apps/*` and `apps/rally-hq/` ship `vercel.json` configurations.
- **Verdict:** ✗ DIVERGED-UNJUSTIFIED. The omission is silent — neither ADR-027 (reference stack), ADR-029 (GCP-portability), nor ADR-046 (deploy strategy) names the absence as a deliberate choice. The "no config" stance creates concrete documented gaps:
    - `docs/user/guides/observability-alerts.md:96` instructs adopters to "Add to vercel.json" — the file does not exist; adopter has to create from scratch.
    - `docs/user/guides/enable-auto-deploy.md:135` describes "the vercel.json config + GitHub remote + Vercel project linkage form the canonical CI/CD pipeline" — but no vercel.json exists; the CI/CD pipeline runs entirely on dashboard-side config.
    - ADR-046's `rootDirectory=prototype` choice is version-controlled only as ADR prose; the actual deploy setting lives in the Vercel dashboard, invisible to fork-and-customize adopters until they discover the gap empirically.
    - F7's cron-route implementation is blocked on this absence (Vercel Cron requires the `crons` array in `vercel.json` / `vercel.ts`).
- **Action:** §31 entry filed in `docs/functional/BRD-OPEN-QUESTIONS.md` (this PR) recommending the addition of `prototype/vercel.ts` (or `vercel.json` if Next.js / Vercel framework version constraints disqualify `vercel.ts`) carrying at minimum: `framework: 'nextjs'`, rootDirectory acknowledgment via comment, build/install command pinning, function timeout (the platform default moved to 300s per the Knowledge Update — explicit pin protects against future drift), and a `crons` array stub the F7 cron-route handlers can land into. Activation criteria attached to the §31 entry.

### F6. @supabase/ssr usage

- **Atelier choice:** `prototype/src/lib/atelier/adapters/supabase-ssr.ts` uses `createServerClient` from `@supabase/ssr` for server reads (chunked-cookie envelope decoding via the lazy import); `prototype/src/lib/atelier/adapters/supabase-browser.ts` uses `createBrowserClient` for the broadcast-island client. NO `middleware.ts` runs `updateSession()` for proactive token refresh. Both adapters are the only `@supabase/*` import sites per ADR-029.
- **Vendor canonical:** Per https://supabase.com/docs/guides/auth/server-side/nextjs the canonical Next.js setup is three pieces — `utils/supabase/server.ts` (server client), `utils/supabase/client.ts` (browser client), AND `middleware.ts` calling `updateSession()` to refresh access tokens proactively on every request before they expire.
- **Internal reference impl:** `apps/630-apps/*` use SvelteKit, where the canonical pattern lives in `hooks.server.ts` (not Next.js middleware). Not directly comparable to the @supabase/ssr Next.js shape.
- **Verdict:** ⚠ DIVERGED-JUSTIFIED-IMPLICITLY. Atelier ships 2 of the 3 canonical pieces. Reasoning that appears to apply (but is not documented in any spec or file header):
    - The `/atelier` lens routes call `getSession()` inline on render; @supabase/ssr triggers a refresh internally if the access_token is near expiry. Per-request refresh inside the lens path works without middleware.
    - The MCP routes (`/api/mcp`, `/oauth/api/mcp`) authenticate via `Authorization: Bearer <jwt>` headers, not cookies — no refresh path is needed for those routes.
    - The `/sign-in/*` routes have their own session-establishment flow.
  Net: no current Atelier route shape strictly requires middleware-based refresh. But the divergence is silent — there is no explicit "we ship 2 of 3 pieces because…" sentence in `supabase-ssr.ts`, the adapters' README, or ARCH 7.9.
- **Action:** Doc-only update to `prototype/src/lib/atelier/adapters/supabase-ssr.ts` file header naming the canonical 3-piece setup and the explicit "we ship 2 of 3 (no middleware) because no current Atelier route shape requires proactive cookie-based refresh — lens routes refresh inline via getSession(); MCP routes use bearer headers; sign-in routes have their own flow" sentence. NOT a §31 entry — substrate works under current traffic shape.

### F7. Cron + queue patterns

- **Atelier choice:** Spec adopts Vercel Cron per ADR-027 + ADR-029 (vendor-neutral capability layer; Vercel Cron is the reference-impl realization). NO concrete cron implementation in repo: no `prototype/src/app/api/cron/*` route handlers, no `crons` array (no `vercel.ts` / `vercel.json` to declare it in — see F5), no pg_cron migration. The reaper, mirror-delivery, reconcile, and triage crons referenced in ARCH §6.5 / §7.4 / §8 are spec-only. `docs/user/guides/observability-alerts.md` instructs adopters to wire their own cron routes against their own `vercel.json`.
- **Vendor canonical:** Vercel Cron via `crons` array in `vercel.ts` / `vercel.json` plus a Next.js route handler at the declared path. The Knowledge Update explicitly elevates `vercel.ts` as the recommended shape.
- **Internal reference impl:** None in workspace at this scale. The other apps don't run multi-cron workloads.
- **Verdict:** ✓ CANONICAL (in spec). The implementation gap (no concrete cron handlers + no `crons` array site to declare them in) is the same root cause as F5; resolving F5 unblocks the implementation.
- **Action:** None for this audit. The spec already adopts the canonical. Implementation is M7 polish work tracked separately under BUILD-SEQUENCE; F5's resolution sets up the declaration site.

---

## Summary

7 surfaces audited; **3 canonical** (F3, F4, F7 spec); **3 justified-divergence** (F1, F2, F6 — all doc-only acks; substrate works empirically); **1 unjustified-divergence** (F5 — Vercel deployment config absent without explicit "no config" justification). **0 ADRs to file** (per the §6.1 ADR-hygiene test, none of the divergence justifications survive "if we'd done this right from the start, would the ADR survive?" — they're all doc clarifications, not load-bearing decisions). **1 §31 entry to file** (F5).

The audit's findings split cleanly into two categories:

1. **Substrate works, but the spec is silent on why the canonical was diverged from** (F1, F2, F6). These are §11.5b-style documentation hygiene gaps — the discipline says "silence is not acceptable; either the spec adopts the canonical or it explicitly names the disqualifier." All three need brief doc-only updates so future readers (humans + AI) understand the choice. Refactoring to canonical is not warranted; the empirical evidence is that each divergence is functionally fine.

2. **Substrate has a concrete adopter-facing gap** (F5). The absence of `vercel.ts` / `vercel.json` causes documented onboarding friction (referenced in two user-facing guides as if it existed) and blocks F7's implementation. §31 entry with activation criteria filed.

Notably absent from findings: any pattern resembling D7's failure mode (custom infrastructure shape + working internal reference impl ignored). The §11.5b discipline catches the D7 class structurally; these other surfaces show a different and milder failure class — divergence-without-spec-acknowledgment, not divergence-from-existing-canonical-reference.

---

## Cross-references

- METHODOLOGY 11.5b — the canonical-pattern pre-check discipline this audit operationalizes
- ADR-026 — model for justified divergence (Switchman lacked fencing tokens)
- ADR-027 — model for justified divergence (canonical SaaS-only disqualified for OSS Atelier)
- ADR-029 — GCP-portability constraint shaping F4 + F6 adapter splits
- ADR-046 — deploy strategy; named in F1 + F5 + F7 context
- BRD-OPEN-QUESTIONS §31 — receives F5's filed entry with activation criteria
- `docs/architecture/audits/pre-M1-data-model-audit.md` — template for audit-doc structure
- METHODOLOGY 11.5 — parent section the §11.5b sub-discipline lives under
