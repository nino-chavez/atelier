# First deploy: run Atelier on the network

> **Recommended (post-D6):** once the one-time setup below is complete (Steps 1-3 plus `vercel link`), use `atelier deploy` (or `atelier deploy --preview`) for every subsequent deploy. The polished CLI runs the same preflight + validation + build + `vercel deploy --prod` + post-deploy verification this runbook walks through manually. See `BUILD-SEQUENCE.md §9` row for `atelier deploy` (D6) for the polished-form contract. The manual sequence below remains canonical for the one-time provisioning + as the operator-readable reference for what the wrapper is doing under the hood.

**Status:** v1 reference flow per `BRD-OPEN-QUESTIONS §28`. Captures the empirical sequence executed at M6 entry to land `https://atelier-three-coral.vercel.app` (cloud Supabase project `lgzitibcufxfgkaxroqg`, Vercel project `atelier`, all 9 migrations applied). Adopters substitute their own project names + URLs.

**Audience:** A composer (architect, dev, PM, designer) whose local-bootstrap is already working and who needs network-reachable access to the endpoint. Triggers per `docs/functional/BRD-OPEN-QUESTIONS.md §28`: a teammate joining on a different machine, a remote agent peer composer (claude.ai Connectors / ChatGPT Connectors), continuous availability, external demo, or CI auto-deploy. If none of those apply, stay on local-bootstrap; deploy adds operational debt without proportional benefit.

**Time to complete:** 60-90 minutes the first time (most spent waiting for cloud-Supabase project provisioning + the first Vercel build). Subsequent re-deploys land in 60-90 seconds via `vercel deploy --prod` once the project is linked.

**Prerequisite:** `docs/user/tutorials/local-bootstrap.md` ran clean. The deploy sequence assumes you understand the substrate's URL split (`/api/mcp` vs `/oauth/api/mcp`), the bearer model (per ADR-028), and the env-var template (`prototype/.env.example`). If those concepts are unfamiliar, finish local-bootstrap first; this runbook only swaps the URLs.

---

## What you'll have at the end

- A live Atelier endpoint at `https://<your-project>.vercel.app/api/mcp` (and `/oauth/api/mcp` for OAuth-flow clients)
- A cloud Supabase project hosting the coordination datastore + auth (all 9 migrations applied)
- A Vercel project linked to the GitHub repo with `rootDirectory=prototype`
- A static bearer token issued against cloud Supabase Auth, ready to hand to any MCP client
- The `/atelier` lens UI at `https://<your-project>.vercel.app/atelier` for any composer with an authenticated session
- (Optional) Git auto-deploy: `git push origin main` triggers a fresh production deploy

After this runbook, claude.ai Connectors / ChatGPT Connectors / any remote MCP client can reach the substrate. Local development still works against `localhost:3030` per local-bootstrap; deploy is purely about network access, not a replacement.

---

## Prerequisites

In addition to the local-bootstrap prerequisites:

- **A Vercel account.** Free tier is sufficient for evaluation; the substrate fits well within hobby-tier limits at low volume. Pro is recommended once a real team uses the deploy (per-team seats + better build concurrency).
- **The Vercel CLI.** `vercel --version` should print 30.x or higher. Install via `npm install -g vercel`.
- **A Supabase Cloud account.** Free tier provisions a Postgres + Auth + Realtime + pgvector project. Pro tier recommended for production use (per-organization seats + extended metrics + larger compute slot). The reference deploy used Pro on the `Signal-x-Studio-LLC` org.
- **GitHub remote configured.** Vercel's git integration (Step 10) needs to read the repo. If you forked Atelier, the remote should be your fork.
- **Network reachability check.** The cloud Supabase project URL takes the shape `https://<project-ref>.supabase.co`; your laptop + Vercel's build infrastructure both need outbound HTTPS. No special network config needed for the reference impl.

You'll also need the same OpenAI API key from local-bootstrap (or a different one scoped to the deploy environment; see Step 3).

---

## Pre-flight: confirm the trigger

Before provisioning anything, confirm a `BRD-OPEN-QUESTIONS §28` trigger has fired. The non-triggers (a milestone landing, "polish enough", local-stack restart friction, "test in production") are not reasons to deploy. Concrete triggers:

| Trigger | Concrete signal |
|---|---|
| Second human composer | A teammate is at the keyboard on a different machine and needs `/atelier` URL access |
| Remote agent peer composer | A claude.ai or ChatGPT Connectors session is required for the work item; localhost is unreachable from cloud-hosted clients |
| Continuous availability | Sessions opening at random times need an always-up endpoint |
| External demo / adopter walkthrough | Someone outside the build team needs hands-on access without installing dependencies |
| CI auto-deploy | The merge-to-main flow should publish a fresh deploy automatically |

If none match, stop here and stay local. If one does, the deploy ADR (`docs/architecture/decisions/ADR-NNN-deploy-strategy.md`) captures the choices below; this runbook is the procedural twin.

---

## Step 1: Provision the cloud Supabase project

The reference impl runs Supabase Cloud (per ADR-027). Adopters using an alternative Postgres + auth provider (Neon + Clerk, RDS + Auth0, GCP Cloud SQL + Identity Platform per ADR-029) follow the same shape with the URLs swapped.

1. **Sign in to https://supabase.com/dashboard.**
2. **Create a new project.** Pick:
   - **Organization:** your team's org (or your personal org if testing).
   - **Project name:** something stable like `atelier` or `atelier-prod`. The project ref is auto-generated (e.g., `lgzitibcufxfgkaxroqg`); you'll reference it below.
   - **Region:** choose the region closest to your team. The reference deploy used `us-west-1`. Cross-region latency between Vercel and Supabase adds 50-200ms per request; co-locating matters more than picking the absolute closest region.
   - **Database password:** generate a strong one. You won't paste this often (the dashboard auto-fills it for `psql` invocations); save it in a password manager regardless.
   - **Pricing plan:** Free is fine for evaluation. Pro is recommended for sustained use (better connection pool, longer log retention, no auto-pause).
3. **Wait for provisioning.** First-time project creation takes 1-3 minutes.
4. **Capture the connection string.** Project Settings → Database → Connection string → URI. It looks like `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`. **Use the pooler URL (port 6543), not the direct DB URL (5432)** — Vercel functions don't hold long-lived connections, and the pooler handles connection churn correctly.
5. **Capture the project URL + service role key.** Project Settings → API:
   - **Project URL:** `https://<project-ref>.supabase.co`
   - **Service role key:** a long JWT starting with `eyJ...`. Treat it like a root password — it bypasses RLS.
   - **Anon key:** another JWT. Public; safe to expose in client-side code.
6. **Note the auth issuer URL.** Always `https://<project-ref>.supabase.co/auth/v1`. Atelier derives this from `NEXT_PUBLIC_SUPABASE_URL` automatically for JWKS-based bearer verification (per the canonical-rebuild PR; no separate `ATELIER_OIDC_ISSUER` env var needed).

---

## Step 2: Apply migrations to cloud Supabase

The 9 migrations under `supabase/migrations/` need to apply against the cloud project. Two paths.

### Path A: Supabase CLI link + db push (recommended)

From the repo root:

```bash
supabase link --project-ref <project-ref>
# Asks for the database password (from Step 1.2). Paste it.

supabase db push
# Prompts to confirm the migration plan; review + confirm.
```

`supabase link` writes `supabase/.temp/project-ref` and `.gitignore`-protected metadata so subsequent `supabase db push` runs against the linked project. `supabase db push` applies all migrations under `supabase/migrations/` that aren't already in `supabase_migrations.schema_migrations` on the cloud DB. First run applies all 9.

**Verify:**

```bash
psql "postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres" \
  -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';"
```

Expect 12 tables at M6 exit: `projects`, `composers`, `sessions`, `contributions`, `decisions`, `territories`, `contracts`, `locks`, `telemetry`, `delivery_sync_state`, `embeddings`, `triage_pending`.

### Path B: psql + manual migration application

If `supabase link` is blocked (firewall, CLI issue, no Supabase CLI available), apply migrations directly:

```bash
for f in supabase/migrations/*.sql; do
  echo "Applying $f"
  psql "<connection-string>" -f "$f"
done
```

Order is lexicographic by filename (the `2026MMDDHHMMSS_*` prefix enforces it). Each migration is idempotent within itself; the loop fails fast on any error.

---

## Step 3: Configure the Vercel project

The deploy convention is `rootDirectory=prototype` because the Next.js app lives there, not at the repo root. Per the M6 deploy: the build command, install command, and output directory are auto-detected from `prototype/package.json`.

1. **Sign in to https://vercel.com.**
2. **Add a new project.** Vercel imports from your GitHub remote.
3. **Configure project root.** In the "Configure Project" step:
   - **Root Directory:** `prototype` (this is the load-bearing setting)
   - **Framework Preset:** Next.js (auto-detected)
   - **Build Command:** `next build` (auto-detected)
   - **Install Command:** `npm install` (auto-detected)
   - **Output Directory:** `.next` (auto-detected)
4. **Provision environment variables.**

   **Recommended path: Vercel-Supabase Marketplace integration.** Install the integration from https://vercel.com/marketplace/supabase, link it to your Vercel project, and select the Supabase project from Step 1. The integration auto-provisions every required env var into Production / Preview / Development scopes:

   | Variable | Provisioned by integration |
   |---|---|
   | `POSTGRES_URL` | Yes (pooler URL, port 6543) |
   | `POSTGRES_URL_NON_POOLING` | Yes (direct URL, port 5432) |
   | `NEXT_PUBLIC_SUPABASE_URL` | Yes |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes (publishable / anon key) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Yes (do not expose to browser) |

   Then add the manual env vars the integration does not provision:

   | Variable | Value | Source |
   |---|---|---|
   | `OPENAI_API_KEY` | Your OpenAI API key | https://platform.openai.com/api-keys |
   | `NEXT_PUBLIC_SITE_URL` | The deploy URL once known (or skip; `VERCEL_URL` is auto-provisioned and the prototype falls back to it) | Vercel |

   **Fallback path: manual env-var provisioning.** Add each variable above (Production scope). Take care to **paste values without trailing whitespace** — see the env-var trim gotcha in Troubleshooting.

   The retired `ATELIER_DATASTORE_URL` / `ATELIER_OIDC_ISSUER` / `ATELIER_JWT_AUDIENCE` / `ATELIER_PUBLIC_URL` / `ATELIER_ENDPOINT_URL` env vars are gone (per the canonical-rebuild PR; BRD-OPEN-QUESTIONS section 31). If your existing Vercel project has them set, delete them after deploying the rebuild — they are dead weight and will not be read.

   For the `BroadcastService` (per ADR-029) the default Supabase Realtime impl reads the same `NEXT_PUBLIC_SUPABASE_URL` and the publishable key from the runtime; no separate env var needed.

5. **Deploy.** Vercel kicks off the first build. Expect 60-120 seconds for the install + build + deploy cycle. Watch the build log; if it fails, the most likely causes are listed in Troubleshooting.

6. **Capture the production URL.** Vercel assigns a default subdomain like `<project-name>-<hash>.vercel.app`. The reference deploy landed at `https://atelier-three-coral.vercel.app`. You can wire a custom domain later (Project Settings → Domains).

---

## Step 4: Verify the URL split is published correctly

The substrate publishes two URLs (per PR #14): `/api/mcp` (static-bearer) and `/oauth/api/mcp` (OAuth flow). The discovery payload is path-prefixed under the OAuth-flow URL only. Confirm both behave correctly.

```bash
DEPLOY=https://<your-project>.vercel.app

# Static-bearer URL: POST-only, no discovery published
curl -i $DEPLOY/api/mcp
# expect: HTTP/2 405; allow: POST

# Discovery NOT findable from /api/mcp
curl -i $DEPLOY/.well-known/oauth-authorization-server
# expect: HTTP/2 404; body: {"error":"not_found"}; content-type: application/json
# (per PR #16 catch-all; Claude Code's MCP SDK requires JSON-not-HTML 404 bodies when probing)

# OAuth-flow URL: discovery published path-prefixed
curl -s $DEPLOY/.well-known/oauth-authorization-server/oauth/api/mcp | jq
# expect: 200; full RFC 8414 OAuth 2.0 Authorization Server Metadata
# referencing https://<project-ref>.supabase.co/auth/v1 as issuer
# and $DEPLOY/oauth/register as registration_endpoint
```

If any of the three checks fails, see Troubleshooting (the substrate-fix series at PRs #11, #13, #14, #16, #18 + the trim() commit captures every divergence class observed during the M6-entry deploy).

---

## Step 5: Seed your composer + project rows in cloud

Same pattern as local-bootstrap Step 3, with cloud values:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role key from Step 1.5> \
POSTGRES_URL=<pooler URI from Step 1.4> \
npx tsx scripts/bootstrap/seed-composer.ts \
  --email you@example.com \
  --password <pick-a-strong-throwaway-password> \
  --discipline architect \
  --access-level admin
```

Idempotent — re-run safely. Records the composer in cloud Supabase Auth + the `composers` table in the cloud Atelier datastore. Echoes the composer UUID + project UUID; capture both.

> **Save the password.** Same caveat as local-bootstrap. Lose it and you'll re-seed under a different email + clean the orphaned auth user via Supabase Studio.

---

## Step 6: Issue your cloud bearer token

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_ANON_KEY=<anon key from Step 1.5> \
npx tsx scripts/bootstrap/issue-bearer.ts \
  --email you@example.com \
  --password <password from Step 5>
```

Prints the access_token (3-segment ES256-signed JWT). 1-hour default lifetime per Supabase Auth. For long-running deploys, see `docs/user/guides/rotate-secrets.md` for the rotation flow (or wait for `scripts/bootstrap/rotate-bearer.ts`, planned at M7).

---

## Step 7: Configure your MCP client against the deploy

The same two paths as local-bootstrap (CLI command or direct JSON edit), with the URL swapped to the deploy.

### Claude Code (CLI surface — `/api/mcp`)

```bash
# Option 1: keep cloud + local in separate config scopes
claude mcp add atelier-prod --transport http https://<your-project>.vercel.app/api/mcp \
  --header "Authorization: Bearer <token from Step 6>" \
  --scope user
# --scope user writes to ~/.claude.json (machine-global)

# Option 2: project-scoped, replacing the local entry
claude mcp remove atelier --scope project   # if local entry exists
claude mcp add atelier --transport http https://<your-project>.vercel.app/api/mcp \
  --header "Authorization: Bearer <token from Step 6>" \
  --scope project
```

### claude.ai Connectors / ChatGPT Connectors (`/oauth/api/mcp`)

These cloud clients use the OAuth-flow URL because they cannot accept a static bearer header in their connector setup UI. See `docs/user/connectors/claude-ai.md` for the full setup flow against the deployed `/oauth/api/mcp` URL + the discovery metadata published in Step 4.

---

## Step 8: Verify the wire-up end-to-end

In a Claude Code session pointed at the deploy:

> "Call the atelier `get_context` tool and tell me what project + recent decisions you see."

Expected: the agent calls `get_context` against the deployed endpoint, gets back the cloud `atelier-self` project info (or whichever project name you seeded), your composer's territory data, and the charter paths. The `recent_decisions.direct` list will be empty until the first ADR is filed via `log_decision` against the cloud datastore (per ADR-005 only `log_decision` writes the table; canonical ADRs predate the substrate).

If `get_context` returns 401, your bearer expired (1-hour default). Re-issue with Step 6. The JWT audience is hardcoded to `authenticated` (Supabase Auth default; per the canonical-rebuild PR no separate env var is needed).

---

## Step 9 (optional): Wire git auto-deploy

The default Vercel project links to your GitHub remote. By default, **every push to main triggers a fresh production deploy + every PR gets a preview URL.** If you want manual control instead:

- **Disable auto-deploys:** Project Settings → Git → "Production Branch" auto-deploy toggle off. Then `vercel deploy --prod` from the CLI is the only path.
- **Disable preview deploys:** Same panel; "Deployment Type" → Production-only.

For most teams, leave both enabled — Preview URLs per PR are load-bearing for the M7 hardening cycle (every M7 PR can be exercised against a fresh deploy before merge).

> **Branch protection note.** If main is protected, Vercel still deploys on PR open + merge — preview deploys don't gate on branch protection. The production deploy on merge fires after main moves; Vercel reads the post-merge state.

---

## Troubleshooting

**Vercel build fails with `Cannot find module 'pg'` or `Cannot find module 'yaml'`.** Empirically observed at M6 entry (commit `ad2eca5`). The prototype's `package.json` was missing the runtime deps that scripts under `scripts/` use at request time. Fix: confirm `prototype/package.json` lists `pg`, `yaml`, `gray-matter` in `dependencies` (it does at M6+; if you forked earlier, pull main).

**Vercel build fails with TypeScript errors that pass locally.** The build runs `next build` which type-checks against the project's tsconfig. If your local fork has type relaxations, the cloud build will catch them. Fix the types or pin a stricter `tsconfig.json`.

**OAuth discovery URL has trailing whitespace in the issuer.** Empirically observed at M6 entry (commit `785ef1c`). Env vars set via `echo "$VAL" | vercel env add KEY ENV` carry a trailing newline that propagates into all derived URLs. Fix landed in `scripts/endpoint/lib/oauth-discovery.ts` (defensive `.trim()`); confirm you're on a version with the fix. **Prevention:** when adding env vars via the Vercel CLI, use `printf "%s" "$VAL" | vercel env add KEY ENV` (no trailing newline) or paste via the Vercel dashboard UI.

**`/api/mcp` returns 405 even on POST.** Method-not-allowed despite a POST. Verify the `Content-Type: application/json` header is set; Next.js's body parser rejects non-JSON for POST routes that expect JSON. Curl example: `curl -X POST $DEPLOY/api/mcp -H 'Content-Type: application/json' -H 'Authorization: Bearer <token>' -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`.

**`/.well-known/oauth-authorization-server` returns HTML 404 instead of JSON 404.** The catch-all route from PR #16 isn't deployed. Pull main + redeploy. Verify with `curl -i $DEPLOY/.well-known/oauth-authorization-server`; the response should have `content-type: application/json` and body `{"error":"not_found"}`.

**Discovery metadata `registration_endpoint` is a relative URL or missing.** PR #11 + PR #13 fixes. Confirm you're on a version that emits `registration_endpoint` as an absolute URL derived from request origin, `NEXT_PUBLIC_SITE_URL`, or `VERCEL_URL`.

**claude.ai Connectors authenticates but tool calls 401.** The composer row doesn't exist in cloud `composers` for the email you authenticated as. Re-run Step 5 against the cloud datastore. Check via `psql "<connection-string>" -c "SELECT id, email, discipline, access_level FROM composers;"` that your row exists.

**Tool calls work from one client but not another after a re-deploy.** Bearer cache durability — Claude Code's MCP HTTP client caches bearers in process state surviving restart + `/mcp` Disable→Enable. Workaround: use direct `curl` to validate the substrate sees the new bearer (per local-bootstrap Troubleshooting). M7 polish (`scripts/bootstrap/rotate-bearer.ts`) automates this.

**`/atelier` returns "no composer found."** The bearer's `sub` claim doesn't match any row in cloud `composers.identity_subject`. Re-seed via Step 5; it's idempotent on email.

**`vercel deploy --prod` succeeds but the URL still serves the previous version.** Vercel's Edge cache is stale. Force a fresh fetch with `curl -H "Cache-Control: no-cache" $DEPLOY/api/mcp`; if that returns the new behavior but browser doesn't, hard-refresh the browser (Cmd-Shift-R / Ctrl-F5).

**Builds are slow (>3 minutes).** Default behavior cold-installs all dependencies on each build. Vercel's build cache should kick in after the first build; verify Project Settings → Build & Development → "Use latest Build Cache" is enabled.

---

## Security notes for the deployed substrate

Unlike local-bootstrap, every credential here is real and reachable from the public internet.

- **Bearer tokens are 1 hour by default.** Expired bearers fail closed (401). Per `docs/user/guides/rotate-secrets.md` you can extend this via Supabase Auth settings, but longer-lived tokens are a larger compromise window if exfiltrated.
- **The Supabase service role key is root-equivalent.** It bypasses RLS. Only the Vercel deploy + `scripts/bootstrap/seed-composer.ts` should ever see it. Never commit it; never paste it into chat clients.
- **`OPENAI_API_KEY` charges your account on every `find_similar` call.** Cap with OpenAI's usage limits (Settings → Limits) so a misconfigured project can't drain the account. The reference impl uses `text-embedding-3-small` per ADR-041 (cheap; ~$0.02 per million tokens at the time of this writing).
- **Vercel deploy URLs are publicly reachable by default.** Anyone who knows the URL can probe `/api/mcp`; correct authz is the substrate's bearer + composer row check. If your project is sensitive, use Vercel's Deployment Protection feature (Project Settings → Deployment Protection) to gate URL access at the platform layer.
- **OAuth client allowlist.** If using the `/oauth/api/mcp` URL with claude.ai Connectors, the OAuth callback URL the platform asks for goes into Supabase Auth's "Redirect URLs" allowlist. Without that allowlist entry, the OAuth flow lands on a Supabase error page after consent. Path: Supabase Dashboard → Authentication → URL Configuration.

See `docs/user/guides/rotate-secrets.md` for the full credential-rotation runbook.

---

## What's next

You're now network-reachable. The same `/atelier` lens UI is up at `https://<your-project>.vercel.app/atelier`; share that URL with teammates (Step 5 seeds them as composers via the same script with their email).

For each remote agent client class, see the dedicated connector runbook:

- **Claude Code (local CLI):** keep using the local-bootstrap pattern with the deploy URL swapped (Step 7 above)
- **claude.ai Connectors:** [`docs/user/connectors/claude-ai.md`](../connectors/claude-ai.md) — the OAuth-flow setup against the public `/oauth/api/mcp` URL
- **ChatGPT Connectors:** see [`docs/user/connectors/README.md`](../connectors/README.md) for the compatibility matrix
- **Custom MCP clients:** any client implementing the Streamable HTTP MCP profile per ARCH §7.9 connects against `/api/mcp` (static bearer) or `/oauth/api/mcp` (OAuth)

For ongoing maintenance:

- **Bearer rotation:** every 1 hour by default; automate with `scripts/bootstrap/rotate-bearer.ts` (planned at M7) or a refresh-token flow
- **Migrations:** when a new migration lands in `supabase/migrations/`, re-run Step 2 (`supabase db push`)
- **Re-deploys:** `git push origin main` if you wired Step 9 auto-deploy; otherwise `vercel deploy --prod` from the repo root

---

## Cross-references

- ADR-027 — Reference stack (GitHub + Supabase + Vercel + MCP)
- ADR-028 — Identity service default (Supabase Auth)
- ADR-029 — GCP-portability constraint
- ADR-044 — Bootstrap inflection (local-bootstrap canonical; deploy event-triggered)
- BRD-OPEN-QUESTIONS §28 — Deploy trigger conditions
- ARCH §7.1 — Bearer verification flow
- ARCH §7.8 — Per-project git committer (uses deploy-side env vars)
- ARCH §7.9 — Streamable HTTP MCP profile (the wire protocol the deploy serves)
- PR #14 — URL split rationale (`/api/mcp` vs `/oauth/api/mcp`)
- PR #16 — Catch-all JSON 404 (Claude Code SDK probe-shape compatibility)
- PR #18 — M6-entry runbook bundle (8 findings + connectors fix)
- `docs/user/tutorials/local-bootstrap.md` — the prerequisite + the always-canonical development flow
- `docs/user/guides/rotate-secrets.md` — credential rotation runbook (covers bearer, service role, OpenAI key)
