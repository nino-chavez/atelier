---
id: ADR-046
trace_id: BRD:Epic-1
category: architecture
session: m7-track-2-deploy-strategy
composer: nino-chavez
timestamp: 2026-05-02T00:00:00Z
---

# Deploy strategy: Vercel + Supabase Cloud + rootDirectory=prototype + URL split inheritance

**Summary.** Codifies the deploy decisions executed empirically during M6 entry when BRD-OPEN-QUESTIONS §28 trigger #2 fired (claude.ai Connectors blocked on local-only). Hosting is Vercel; coordination datastore + auth is Supabase Cloud (Pro org); the Vercel project sets `rootDirectory=prototype` because the Next.js app lives there; the URL split from PR #14 (`/api/mcp` static-bearer + `/oauth/api/mcp` OAuth) inherits unchanged from local-bootstrap; bearer rotation follows Supabase Auth's default 1-hour TTL with an operator-driven `scripts/bootstrap/rotate-bearer.ts` script (M7 follow-up). Does NOT reverse ADR-044; adds a peer mode to local-bootstrap, which remains the canonical development flow.

**Rationale.**

The 2026-05-01 deploy executed during M6 entry made five concrete operational choices that adopters need codified to replicate. ADR-044 deferred this decision to "any genuine BRD §28 trigger"; trigger #2 fired on 2026-05-01 (claude.ai Connectors validation blocked on local-only); the deploy executed the same week as a parallel workstream that landed `https://atelier-three-coral.vercel.app`. Per ADR-011 (destination-first) the choices made under operational pressure must surface as a canonical decision so future adopters do not re-derive them under the same pressure.

**Why each choice.**

1. **Hosting platform: Vercel.** Per ADR-027 the reference impl is GitHub + Supabase + Vercel + MCP. The deploy executed against this declared stack; no alternative was tested at M6. Vercel's strengths for this workload: zero-config Next.js deployment from the GitHub remote, per-PR preview URLs (relevant to M7 hardening discipline), platform-default subdomain that's reachable for OAuth-flow clients without DNS configuration. ADR-029 GCP-portability discipline is preserved: the Cloud Run migration path remains documented; nothing about this deploy violates the named-adapter constraint.

2. **Database + auth: Supabase Cloud Pro.** Per ADR-027 + ADR-028. Supabase Pro was chosen over Free for the production-grade connection pool (the v1 substrate's pgvector + concurrent-MCP-client load benefits) plus longer log retention (M7 hardening + observability work needs visibility into substrate behavior). Region: `us-west-1` (closest to the build team's primary region; Vercel's default region for the project pool was the same). Cross-region Vercel↔Supabase latency adds 50-200ms per request; co-locating matters more than picking the absolute closest region.

3. **Vercel project root: `rootDirectory=prototype`.** The Next.js app lives at `prototype/`, not the repo root. Without this configuration the build would scan the repo root and miss the prototype's `package.json`. The `.atelier/`, `docs/`, and `scripts/` directories never need to be deployable artifacts — they're substrate inputs, not runtime code. The `rootDirectory` setting is the canonical way to tell Vercel "the deployable app lives here."

4. **URL split inheritance from PR #14.** The substrate publishes two URLs (`/api/mcp` static-bearer; `/oauth/api/mcp` OAuth-flow with discovery published path-prefixed). The deploy did NOT introduce new URLs — it inherited the same routes that local-bootstrap serves. This is load-bearing: cloud-hosted OAuth clients (claude.ai Connectors, ChatGPT Connectors per BRD §28) need discovery findable; static-bearer clients (Claude Code CLI per ARCH §7.9) need discovery NOT findable on their URL. Without the split, claude.ai's MCP SDK preferentially does OAuth flow when discovery is reachable, ignoring static `Authorization` headers — the failure mode that led to the M6 substrate-fix series (PRs #11, #13, #14, #16). The split prevents the regression class architecturally.

5. **Bearer rotation: Supabase Auth default TTL + operator-driven helper.** Per ADR-028 the bearer is a Supabase-issued ES256-signed JWT; default TTL is 1 hour. Cloud deploys do not change this — the same bearer issuance flow (`scripts/bootstrap/issue-bearer.ts`) works against the cloud Supabase project URL. Bearer rotation is operator-driven via `scripts/bootstrap/rotate-bearer.ts` (M7 follow-up; PR #30); refresh-token-based automatic rotation is deferred to v1.x when adopter signal exists for it.

**Operational debt accepted.**

- **Manual deploy.** `vercel deploy --prod` is operator-driven by default. Per BUILD-SEQUENCE M7 the git-integration auto-deploy is wired separately as a tiny M7 follow-up; until then, every push to main does NOT auto-deploy.
- **Single environment.** No staging URL at M7 entry. Preview URLs per PR (Vercel default) cover the validation surface; a dedicated staging deploy is deferred to v1.x or to whenever an adopter signals a need.
- **Bearer rotation is manual.** The 1-hour TTL means operators re-issue bearers periodically. The `rotate-bearer.ts` script (PR #30) makes this one command, but the operator must invoke it.
- **No deployment protection at v1.** The Vercel deploy URL is publicly reachable; the substrate's bearer + composer-row check is the only authorization layer. Adopters with sensitive content should enable Vercel's Deployment Protection feature (Project Settings) per the security note in `docs/user/tutorials/first-deploy.md`.
- **Env-var trim defense.** `scripts/endpoint/lib/oauth-discovery.ts` has a `.trim()` guard for the trailing-newline gotcha (commit `785ef1c`); without it, env vars set via `echo "$VAL" | vercel env add` produce malformed discovery URLs. The defense is permanent; adopters using the dashboard UI to set env vars don't trigger the gotcha but the trim is still load-bearing for CLI workflows.

**What this ADR does NOT decide.**

- **GCP migration.** ADR-029 governs portability. This ADR documents the v1 reference impl deploy; the Cloud Run + Cloud SQL migration remains a separate forward-looking concern.
- **DNS / custom domain.** The reference deploy uses Vercel's platform-default subdomain (`atelier-three-coral.vercel.app`). Adopters wiring a custom domain follow Vercel's standard flow per first-deploy.md; no Atelier-specific configuration involved.
- **CI/CD beyond preview deploys.** The hybrid CI gate per `.github/workflows/atelier-audit.yml` runs against the GitHub repo; deploy-side smoke tests (post-deploy probes against the live URL) are filed as v1.x scope under "deploy validation" if/when a deploy regression class surfaces.
- **Multi-tenancy / one-deploy-per-team.** Per ADR-007 + ADR-015 each guild runs its own deploy. This ADR doesn't specify multi-deploy patterns; that's adopter choice per their team boundary.

**Decision.**

For the v1 reference implementation deploy:

- **Hosting:** Vercel project with `rootDirectory=prototype`, Next.js framework preset (auto-detected), default subdomain
- **Datastore + auth:** Supabase Cloud project (Pro tier recommended for sustained use; Free works for evaluation), `us-west-1` or co-located with Vercel deployment region, all migrations applied via `supabase db push` from CLI link
- **URL surface:** unchanged from local-bootstrap — `/api/mcp` (static-bearer) + `/oauth/api/mcp` (OAuth-flow); discovery published only at `/.well-known/oauth-authorization-server/oauth/api/mcp`; `/.well-known/oauth-authorization-server` returns JSON 404 per PR #16 catch-all
- **Env vars on Vercel:** `ATELIER_DATASTORE_URL` (Supabase pooler URI port 6543; not direct port 5432), `ATELIER_OIDC_ISSUER` (`https://<project-ref>.supabase.co/auth/v1`), `ATELIER_JWT_AUDIENCE=authenticated`, `OPENAI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`. Set via dashboard UI when possible; CLI piped input requires the trim defense.
- **Bearer model:** Supabase Auth 1-hour default TTL; operator rotation via `scripts/bootstrap/rotate-bearer.ts`; refresh-token automation deferred to v1.x
- **Deploy trigger:** manual `vercel deploy --prod` at v1; git-integration auto-deploy is a tiny M7 follow-up that wires push-to-main → fresh deploy
- **Operator runbook:** `docs/user/tutorials/first-deploy.md` (PR #24) is the canonical procedural twin to this ADR

**Consequences.**

- BRD-OPEN-QUESTIONS §28 RESOLVED: trigger conditions documented; the empirical M6 deploy choices codified; future adopters follow first-deploy.md + this ADR rather than re-deriving under operational pressure.
- ADR-044 reverse condition NOT triggered: local-bootstrap remains canonical for development; this ADR adds a peer mode for network access.
- ADR-027 reaffirmed: the GitHub + Supabase + Vercel + MCP stack is the deployed reference impl; no vendor-lock surface introduced beyond what ADR-027 already names.
- ADR-029 portability constraint preserved: deploy uses standard Vercel + Supabase capabilities (no `@vercel/edge`, `@vercel/kv`, `@vercel/edge-config`, `.rpc()` outside named adapters); the new portability lint (PR #28) enforces this at PR time.
- M7 success criteria advances: `atelier deploy` polished form (BUILD-SEQUENCE §9) can now wrap `vercel deploy --prod` against the canonical project shape this ADR documents.

**Re-evaluation triggers.**

- Vercel announces deprecation or pricing change that makes the Pro tier untenable for adopter scale → re-evaluate hosting platform
- Supabase Cloud announces deprecation or pricing change for Pro Postgres + Realtime + pgvector → re-evaluate datastore + auth
- An adopter signals genuine multi-environment need (staging vs prod) → file a v1.x ADR for environment scoping
- A deploy-side regression class surfaces that the current per-PR preview-URL gate doesn't catch → file ADR for deploy-side smoke tests
- BUILD-SEQUENCE M7 wires git-integration auto-deploy → footnote here referencing the wiring; the choice itself is noted in this ADR's "operational debt" section, not a separate decision
- An adopter signals genuine GCP-migration need → invoke ADR-029 migration mapping; this ADR's choices are reference-impl-specific, not architecture
