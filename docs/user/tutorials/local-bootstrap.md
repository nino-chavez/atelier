# Local-stack bootstrap: run Atelier on your workstation

**Status:** v1 reference flow per ADR-044. The steps below are the canonical local-only setup; no cloud deploy required.

**Audience:** A composer (architect, dev, PM, designer) who wants to use Atelier on their own machine — either to evaluate it before committing to a deploy, or as the reference development setup that the build team itself runs against.

**Time to complete:** 15-30 minutes if you have the prerequisites; 60-90 minutes if installing dependencies for the first time.

---

## What you'll have at the end

- A running Atelier substrate on `http://localhost:3030/api/mcp`
- A composer row seeded for you against the local Supabase Auth instance
- A bearer token (JWT) you can hand to any MCP client
- Claude Code (or your chosen MCP client) configured to call Atelier tools
- A verified `get_context` round-trip proving the wire-up works end-to-end

After this runbook, you can use Atelier's 12-tool surface (`register`, `heartbeat`, `deregister`, `get_context`, `find_similar`, `claim`, `update`, `release`, `log_decision`, `acquire_lock`, `release_lock`, `propose_contract_change`) from your agent client, and observe the activity in `/atelier` at `http://localhost:3030/atelier`.

---

## Prerequisites

Install once, reuse forever:

- **Node.js 22+** — `node --version` should print v22 or higher
- **Supabase CLI** — `supabase --version` should print 1.x or higher; install via `npm install -g supabase` or [the official guide](https://supabase.com/docs/guides/cli)
- **Docker Desktop or compatible runtime** — required by `supabase start`; check with `docker info`
- **Claude Code CLI v0.5+** — `claude --version` should print 0.5 or higher; install per [Claude Code docs](https://docs.anthropic.com/en/docs/claude-code)
- **An OpenAI API key** — for `find_similar` embeddings; create one at https://platform.openai.com/api-keys (a project key with embeddings scope is sufficient)

You'll also need a clone of the Atelier repo (this one or your fork) and the ability to run `npm install` inside it.

---

## Step 0: Pre-flight checks

Before starting a session, verify the substrate is in a clean state. These checks catch the most common operator slip-ups (stale dev server, expired bearer, ports held by orphaned processes).

```bash
# 1. Supabase is up
supabase status > /dev/null && echo "supabase: ok" || echo "supabase: DOWN -- run 'supabase start'"

# 2. Dev server is reachable on :3030
curl -s -o /dev/null -w "dev: %{http_code}\n" --max-time 2 http://localhost:3030/api/mcp
# expect: 405 (POST-only). 000 = not running. Other code (403/500) = misconfig.

# 3. Bearer in .mcp.json is not expired
[ -f .mcp.json ] && python3 -c "
import json, base64, time
b = json.load(open('.mcp.json'))['mcpServers']['atelier']['headers']['Authorization'].split()[1]
p = json.loads(base64.urlsafe_b64decode(b.split('.')[1] + '==='))
remaining = p['exp'] - int(time.time())
print(f'bearer: {remaining}s left' if remaining > 0 else f'bearer: EXPIRED {-remaining}s ago -- reissue per Step 4')
"

# 4. Nothing else on port 3030 that would force Next to fall back
lsof -i :3030 2>/dev/null | tail +2 | head -3
```

If any of (1)-(3) reports DOWN/EXPIRED, jump back to the relevant step (1, 4, or 5) before continuing. If (4) shows a non-Atelier process holding :3030, kill it or pick a different port (and update `.mcp.json` to match — see Troubleshooting).

---

## Step 1: Start the local Supabase stack

From the repo root:

```bash
supabase start
```

First run downloads container images and takes 2-5 minutes. Subsequent runs start in seconds. When ready, `supabase status` prints connection info including:

- `API URL` (typically `http://127.0.0.1:54321`) — Supabase REST + Auth surface
- `DB URL` (typically `postgresql://postgres:postgres@127.0.0.1:54322/postgres`) — direct Postgres connection
- `anon key` and `service_role key` — public + privileged Supabase Auth keys for your local instance

Capture these values; the next steps reference them.

Migrations run automatically as part of `supabase start` per the configuration in `supabase/config.toml`. Verify by counting tables:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';"
```

You should see 11 tables at M5-exit: `projects`, `composers`, `sessions`, `contributions`, `decisions`, `territories`, `contracts`, `locks`, `telemetry`, `embeddings`, `delivery_sync_state`. Migrations 1-8 (M1 schema + M1 counters + delivery sync state + M2-entry schema + M4 broadcast seq + M5 embeddings 1536/3072 swap) are all applied.

---

## Step 2: Install Node dependencies and build

From the repo root:

```bash
npm install
cd prototype && npm install && cd ..
```

This installs both the script-level dependencies and the prototype's Next.js dependencies.

---

## Step 3: Seed your composer + the project row

The local Supabase instance starts empty (no projects, no composers). Seed the canonical `atelier-self` project and a composer row for yourself.

First, create your Supabase Auth user (this is the identity that will own your bearer token):

```bash
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<service_role key from step 1> \
npx tsx scripts/bootstrap/seed-composer.ts \
  --email you@example.com \
  --password <pick-a-strong-throwaway-password> \
  --discipline architect \
  --access-level admin
```

The script (which lives at `scripts/bootstrap/seed-composer.ts` and ships with the reference impl) creates the Supabase Auth user, captures the resulting `auth.users.id` as the composer's `identity_subject`, and inserts a row into `composers` with the discipline + access level you specified. It also seeds a baseline `bootstrap` territory (scope `**`) so `/atelier` panels render real data on first visit.

It echoes the composer UUID, the project UUID (`atelier-self` is auto-seeded if absent), and the steps to issue a bearer token.

The script is idempotent: re-running with the same email is a no-op for the auth user (looks up the existing user.id) and a no-op for the composer row (UPSERT on `(project_id, email)`). To rotate the password without changing the email, use Supabase's admin `updateUserById` API with the new password, or run the script with a different email and clean the old user via `supabase studio` later.

> **Save your password.** The script does not echo it back. Whatever you pass to `--password` is what you must pass to `issue-bearer.ts` in step 4. If you lose it, rotate via the admin API (see `docs/user/guides/rotate-secrets.md`) or re-seed with a fresh email.

> **Note for adopters not on the reference impl:** the same seed can be done by hand with two SQL inserts (one to `composers` with your `identity_subject` matching your Supabase Auth user.id, one to `projects` if not present). The script is convenience, not a hard dependency.

---

## Step 4: Issue your bearer token

Sign in to local Supabase Auth via `signInWithPassword` to get a real Supabase-issued JWT:

```bash
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_ANON_KEY=<anon key from step 1> \
npx tsx scripts/bootstrap/issue-bearer.ts \
  --email you@example.com \
  --password <password from step 3>
```

The script prints the access_token (a 3-segment ES256-signed JWT). Copy it; you'll paste it into the Claude Code config in the next step.

The token has a default lifetime per Supabase Auth (1 hour for access tokens). For long-lived workstation use, you can either re-issue periodically or use a Supabase Auth refresh token flow — see `docs/user/guides/rotate-secrets.md` for the rotation runbook.

---

## Step 5: Start the prototype dev server

In a fresh terminal (Supabase keeps running in the background from step 1):

```bash
cp prototype/.env.example prototype/.env.local
# Edit prototype/.env.local: set OPENAI_API_KEY (from step 5b below).
# The other ATELIER_* + NEXT_PUBLIC_SUPABASE_URL defaults already match
# the local-bootstrap stack; leave them as-is unless you've customized.

cd prototype && npm run dev
```

`npm run dev` is pre-pinned to `next dev -p 3030` per `prototype/package.json`. The dev server auto-loads `prototype/.env.local`; no inline env vars needed.

The endpoint serves on TWO URLs (per the substrate split in PR #14):

- `http://localhost:3030/api/mcp` — **static-bearer auth**. Use this URL when configuring local Claude Code (CLI) per Step 6. No OAuth discovery published here.
- `http://localhost:3030/oauth/api/mcp` — **OAuth flow**. Reserved for remote OAuth-only clients (claude.ai Connectors, ChatGPT Connectors). Discovery metadata is published at `/.well-known/oauth-authorization-server/oauth/api/mcp`.

The dashboard remains at `http://localhost:3030/atelier`.

> **Why two URLs?** Claude Code's MCP SDK preferentially does OAuth flow when discovery is reachable from the URL it connects to, ignoring static `Authorization` headers. Atelier doesn't support RFC 7591 Dynamic Client Registration (per ADR-028 — adopters provision long-lived bearer tokens out-of-band and supply them as static headers), so the static-bearer URL must NOT have discovery findable. Discovery is published only path-prefixed under the OAuth-flow URL. See `docs/architecture/decisions/ADR-013.md` for the surface lock and PR #14 for the split rationale.

Sanity check (static-bearer URL):

```bash
curl -i http://localhost:3030/.well-known/oauth-authorization-server
# expect: 404 with body {"error":"not_found"}; clean JSON 404 confirms the
# catch-all route from PR #16 is wired (Claude Code's SDK requires JSON-not-HTML
# 404 bodies when probing discovery)
```

Sanity check (OAuth-flow URL):

```bash
curl http://localhost:3030/.well-known/oauth-authorization-server/oauth/api/mcp | jq
# expect: 200 + RFC 8414 OAuth 2.0 Authorization Server Metadata referencing
# your local Supabase Auth issuer + a registration_endpoint URL
```

---

## Step 6: Configure Claude Code as MCP client

Two equivalent paths: CLI command (recommended) or direct JSON edit.

### Path A: CLI command

From the repo root:

```bash
claude mcp add atelier --transport http http://localhost:3030/api/mcp \
  --header "Authorization: Bearer <token from step 4>" \
  --scope project
```

`--scope project` writes the entry to `.mcp.json` at the project root. Omit the flag for `--scope local` (writes to `~/.claude.json`, your machine only).

> **`.mcp.json` contains the literal bearer.** As of Claude Code 2.1.x, `claude mcp add --header ...` writes the literal `Authorization: Bearer <token>` value into `.mcp.json` (no token-reference indirection). The repo's `.gitignore` lists `.mcp.json` to prevent committing the bearer. If you fork Atelier or change the gitignore, keep `.mcp.json` excluded — the bearer is short-lived (1 hour) but does grant tool access during that window. The runbook previously claimed the CLI stores a reference; that was incorrect and has been corrected.

### Path B: Direct JSON edit

Edit `.mcp.json` at the repo root (create it if absent):

```json
{
  "mcpServers": {
    "atelier": {
      "type": "http",
      "url": "http://localhost:3030/api/mcp",
      "headers": {
        "Authorization": "Bearer <token from step 4>"
      }
    }
  }
}
```

Note: `.mcp.json` is already in `.gitignore` at the repo root (line 64). Bearer tokens written via either Path A or Path B never reach git history as long as you don't move/rename the file or strip the gitignore entry.

---

## Step 7: Verify the wire-up

In a Claude Code session, ask the agent to call `get_context`:

> "Call the atelier `get_context` tool and tell me what project + recent decisions you see."

Expected response: the agent calls the tool against your local endpoint, gets back the `atelier-self` project info, your composer's territory data (at minimum the `bootstrap` territory the seed script inserted), and the charter paths from `.atelier/config.yaml`.

> **`recent_decisions.direct` is empty on a fresh local-bootstrap.** That is expected. Per ADR-005 the only path that writes to the `decisions` table is `log_decision`. The 44 canonical ADRs in `docs/architecture/decisions/` predate the substrate (they were authored to the filesystem before the endpoint existed). The first ADR landed via `log_decision` from M6 onward becomes the inaugural row. Empty here is wire-up correctness, not a bug — the agent should still be able to read those ADRs by reading the markdown files directly per the CLAUDE.md fallback rule.

If you see a "tool not found" or auth error, check:

- Step 5's dev server is still running and serving 200s on `http://localhost:3030/api/mcp`
- The bearer token in step 6's config matches the one from step 4 (and hasn't expired)
- `claude mcp list` shows the `atelier` entry as connected

For deeper diagnostics, the dev server's stdout shows every incoming request; the smoke test at `scripts/endpoint/__smoke__/real-client.smoke.ts` is the canonical end-to-end reference for the auth + dispatch path.

---

## Step 8: Update your CLAUDE.md session-start checklist

The repo's `CLAUDE.md` (and any agent-charter file in your fork) has a session-start checklist that historically read "read the canonical state directly." Now that the endpoint is wired, the canonical first move is `get_context`.

Update the relevant line in `CLAUDE.md` to something like:

```markdown
5. Call `get_context` against the configured MCP endpoint to pull project + territory + recent decisions. The endpoint is live (Streamable HTTP MCP per ARCH 7.9 + ADR-013/040, verified by `scripts/endpoint/__smoke__/real-client.smoke.ts`). For local development, see `docs/user/tutorials/local-bootstrap.md`. If the endpoint is unreachable (local stack down, etc.), fall back to direct canonical state read per the precedence list above.
```

The fallback path (direct canonical state read) is preserved per ADR-044's reverse condition — if the substrate has issues that interrupt build velocity, the team can keep working without it.

---

## What's next

You're now bootstrapped. Subsequent work uses the substrate:

- `claim` a contribution before authoring it; release if a `similar_warnings` entry shows you'd duplicate existing work
- `log_decision` to file ADRs through the per-project git committer (the bot writes the file; you push the PR)
- Watch `/atelier` to see live presence, active locks, contracts, and the contribution queue
- Run `find_similar` from the lens panel or directly via the tool to check for prior coverage of any topic

When a network-access need surfaces (a teammate joining, a remote agent peer composer, multi-machine review), see `docs/user/tutorials/first-deploy.md` for the deploy runbook. The Vercel + cloud Supabase path mirrors the local steps with the URLs swapped.

---

## Troubleshooting

**`supabase start` fails with port conflicts.** Another process is using one of the Supabase ports (54321, 54322, etc.). Run `supabase stop` to confirm clean state, then retry. If a non-Supabase process holds the port, either stop it or override the port in `supabase/config.toml`.

**Migrations fail.** Run `supabase db reset` (DESTROYS LOCAL DATA) to start fresh and re-run all migrations from `supabase/migrations/`. If a specific migration fails, check the migration file for syntax that depends on a previous one.

**`get_context` returns 401.** Bearer token expired (1-hour default). Re-run step 4 and update the config in step 6.

**`claude mcp list` shows `Failed to connect` on the `atelier` entry but `curl` works against `/api/mcp`.** Check the dev server log: a `400` response on `notifications/initialized` is the symptom of a JSON-RPC envelope validator that rejects notifications (no `id` field per JSON-RPC 2.0 §4.1). The fix landed at M5-exit (`scripts/endpoint/lib/transport.ts:isJsonRpcRequest`); if you're on a fork branched before that fix, cherry-pick it or relax the validator to allow `v.id === undefined`.

**`find_similar` returns `degraded: true` immediately.** OpenAI API key missing or invalid in step 5's env vars. Check `OPENAI_API_KEY` is set and the key works (e.g., `curl https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"` should return 200).

**`/atelier` shows "no composer found" or similar.** The bearer token's `sub` claim doesn't match any row in `composers.identity_subject`. Re-run step 3 (it's idempotent on `email`).

**Claude Code says "no MCP servers configured."** The `.mcp.json` or settings file isn't being read. `claude mcp list` should show the entry. If absent, re-run step 6's CLI command or check that you're in the right project directory.

**`npm run dev` falls back to port 3001 (or any non-3030 port).** Port :3030 is held by another process. Diagnose with `lsof -i :3030`. If it's a stale Atelier dev server, kill it (`kill <pid>`) and retry. If it's another project's dev server you want to keep, run Atelier on a different port: `npx next dev -p <other-port>` and update `.mcp.json`'s `url` field to match. Note: changing the port also changes the `registration_endpoint` URL emitted in OAuth discovery (it's derived from the request origin per the substrate's lib).

**Bearer rotation: editing `.mcp.json` doesn't update Claude Code's running connection.** Empirically observed: Claude Code's MCP HTTP client caches the bearer in process state that survives both `/mcp` Disable→Enable AND `exit`+relaunch. Direct curl with the new bearer works (substrate sees fresh value); MCP tool calls from the Claude Code session continue sending the OLD cached bearer. Workaround: validate substrate operations via direct curl after rotation. The MCP-tool-from-this-session path is unreliable for any flow requiring fresh credentials. Tracked as M7 polish — investigation of where the cache lives + a real Claude Code MCP-client smoke that catches this class of divergence at CI time.

**`/mcp` dialog defaults to "Authenticate" (option 1) but Atelier requires "Reconnect" (option 2).** Atelier doesn't implement RFC 7591 Dynamic Client Registration per ADR-028; the `registration_endpoint` returns a 405 stub telling clients to use the static bearer in headers instead. Picking "Authenticate" attempts the OAuth code flow against Supabase Auth, which fails downstream (Supabase doesn't support DCR for unknown client_ids). "Reconnect" uses the static bearer in `.mcp.json` headers — that's the supported path.

**SDK auth failed: HTTP 404: Invalid OAuth error response: SyntaxError: JSON Parse error: Unrecognized token '<'.** Claude Code's MCP SDK probed a `/.well-known/*` path that returned Next.js's HTML 404 page instead of a JSON 404. Verify PR #16's catch-all route exists: `curl http://localhost:3030/.well-known/oauth-authorization-server` should return `{"error":"not_found"}` with `Content-Type: application/json`. If you see HTML, your local checkout is missing the `prototype/src/app/.well-known/[...slug]/route.ts` file from PR #16 — pull main.

---

## Security note for local-bootstrap

The local stack is, by definition, local. The bearer token only authenticates against `localhost:3030`; sharing it has no impact unless someone has shell access to your machine. The OpenAI API key in step 5 is a real credential — don't echo it into any file you commit. See `docs/user/guides/rotate-secrets.md` for the secret rotation runbook covering all the credential classes Atelier touches.

When you eventually deploy (per the planned `first-deploy.md` runbook), the same bearer + token model works against the deployed endpoint with the URL swapped. The local-bootstrap stays as the canonical development flow; deploy is purely about network access.
