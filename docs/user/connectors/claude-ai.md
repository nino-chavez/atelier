# Connect claude.ai to your Atelier project

**Status:** SMOKE TESTED 2026-04-30 (protocol-equivalent). DEPLOY VERIFIED 2026-05-02 (the live reference deploy at `https://atelier-three-coral.vercel.app/oauth/api/mcp` published RFC 8414 OAuth 2.0 Authorization Server Metadata at `/.well-known/oauth-authorization-server/oauth/api/mcp` and accepted Streamable HTTP MCP probes during M6 entry). The wire path the runbook implements -- Streamable HTTP MCP, OAuth 2.1 bearer extraction, JWKS verification of Supabase Auth tokens, ARCH 6.1.1 four-step -- is verified end-to-end by `scripts/endpoint/__smoke__/real-client.smoke.ts`. claude.ai's connector-setup UI prose tracks claude.ai's web UI as of 2026-04; if the menu paths shift, the JSON config shape (server URL, auth mode) is stable.

---

## Who this is for

A composer (analyst, designer, PM, or stakeholder) who has been invited to an Atelier project and uses claude.ai as their primary agent client. By the end of this runbook, your claude.ai chat has the project's 12 tools available and you can issue your first `register` call.

If you use a different web-based agent client, see the [compatibility matrix](README.md) for the runbook covering yours.

---

## Prerequisites

Before starting, you need:

- **An Atelier project that's deployed.** Someone on your team executed the `docs/user/tutorials/first-deploy.md` runbook (or `atelier deploy` once it lands as a polished CLI per BUILD-SEQUENCE M7), and the substrate is reachable at `https://<your-project>.vercel.app` (or a custom domain). The reference deploy is `https://atelier-three-coral.vercel.app`; substitute your own URL.
- **An invitation from an admin.** Specifically, an admin on your project ran `atelier invite <your-email> --role <your-role>` and shared the response with you. The response includes both an OAuth setup link and a static API token; you need at least one (the OAuth path is preferred; the static token is the fallback).
- **A claude.ai account with Connectors / Custom Integrations enabled.** Connectors availability depends on your claude.ai plan; check with your claude.ai admin if the option is missing from your account settings.

> **Which URL?** Per PR #14 the substrate publishes two URLs: `/api/mcp` (static bearer; no OAuth discovery) and `/oauth/api/mcp` (OAuth flow; discovery published at `/.well-known/oauth-authorization-server/oauth/api/mcp`). Path A below uses the OAuth-flow URL. Path B uses the static-bearer URL. Path A is preferred whenever your claude.ai plan supports OAuth-protected MCP servers, because tokens rotate transparently.

---

## Path A: OAuth setup (preferred)

When the OAuth flow works end-to-end with claude.ai's connector and the project's identity provider (Supabase Auth by default per ADR-028), this is the cleaner path. Token rotation happens automatically; you don't paste anything by hand after the first setup.

### Steps

1. **Open claude.ai's connector settings.** Account menu → Settings → Connectors (path may vary; check claude.ai's current docs if the menu changed).
2. **Add a new connector.** Name it something like `Atelier <project-name>`.
3. **Paste the OAuth-flow MCP URL.** `https://<your-project>.vercel.app/oauth/api/mcp` (the OAuth-discovery-published URL per PR #14). claude.ai's connector setup probes `<base>/.well-known/oauth-authorization-server/<path>` to find the authorization server metadata; the substrate emits that payload path-prefixed under the `/oauth/api/mcp` URL. From the reference deploy: `https://atelier-three-coral.vercel.app/.well-known/oauth-authorization-server/oauth/api/mcp` returns the RFC 8414 metadata referencing the cloud Supabase issuer.
4. **Authenticate.** A browser window opens to your project's identity provider (Supabase Auth's hosted login by default). Sign in with the email the admin invited.
5. **Authorize the connector.** The identity provider asks you to grant claude.ai access to the Atelier endpoint. Approve.
6. **Connector active.** Back in claude.ai, the connector shows as connected. Your chats now have access to the 12 Atelier tools.

> **OAuth callback allowlist.** The Supabase Auth project must allowlist claude.ai's OAuth callback URL (the URL the platform asks Supabase to redirect to after consent). Without the allowlist entry the OAuth flow lands on a Supabase error page after step 5. The admin adds the URL via Supabase Dashboard → Authentication → URL Configuration → Redirect URLs. claude.ai's documentation lists the canonical callback URL for their Connectors product; it's stable across connector instances.

### Smoke test

Open a new claude.ai chat with the connector enabled and prompt:

> Run the Atelier smoke test: register a session, do a heartbeat, fetch context, deregister.

The agent should call `register`, `heartbeat`, `get_context`, then `deregister` in sequence and report back. If all four steps return successfully, the connector works. If any step fails, see [Troubleshooting](#troubleshooting) below.

This sequence is documented in ARCH section 6.1.1 with the canonical symptom-to-cause mapping.

---

## Path B: Static API token (fallback)

If your claude.ai account's connector setup does not support OAuth-protected MCP servers (the spec was still evolving as of late 2025), use the static API token from your `atelier invite` response. Same end result; you paste a long-lived bearer token and accept that you will re-paste when it rotates.

### Steps

1. **Open claude.ai's connector settings** (same as Path A step 1).
2. **Add a new connector** named `Atelier <project-name>`.
3. **Configure the MCP server URL.** Paste `https://<your-project>.vercel.app/api/mcp` (the static-bearer URL per PR #14 — discovery is intentionally NOT published from this URL so claude.ai's SDK does NOT attempt OAuth and instead honors the static `Authorization` header you supply in step 4).
4. **Configure the auth header.** In the connector's headers section, add `Authorization: Bearer <static-api-token>` where the token is the static one from your invite response.
5. **Save.** The connector should show as connected. claude.ai sends the bearer header on every MCP request.

### Smoke test

Same as Path A.

### Token rotation

When your token expires (per the project's `policy.token_ttl_seconds` setting), the admin runs `atelier invite <your-email> --rotate` and shares the new token. You update the connector's `Authorization` header and re-save.

If you started on Path B and OAuth becomes available later, you can migrate to Path A by removing the connector and re-adding it via the OAuth path.

---

## Troubleshooting

The smoke test in ARCH section 6.1.1 includes a symptom-to-cause table. Common issues specific to claude.ai connector setup:

| Symptom | Likely cause | Resolution |
|---|---|---|
| Connector shows "connection failed" immediately on save | Endpoint URL typo, OR the endpoint is not deployed, OR no network reachability from claude.ai's infrastructure | Verify the URL with the admin; confirm the project is deployed (probe `https://<your-project>.vercel.app/api/mcp` returns 405 from a POST and `/.well-known/oauth-authorization-server/oauth/api/mcp` returns 200 with RFC 8414 metadata); ask your network team about claude.ai outbound reachability |
| Path A: connector setup fails to find OAuth metadata | Wrong URL pasted -- claude.ai needs the OAuth-flow URL `/oauth/api/mcp`, not the static-bearer URL `/api/mcp`. The static-bearer URL intentionally does NOT publish discovery (per PR #14) | Re-paste with `/oauth/api/mcp`; verify discovery resolves at `/.well-known/oauth-authorization-server/oauth/api/mcp` |
| Path A: OAuth consent succeeds but redirects to a Supabase error page | claude.ai's OAuth callback URL is not in the Supabase Auth Redirect URLs allowlist | Admin adds claude.ai's callback URL to Supabase Dashboard → Authentication → URL Configuration → Redirect URLs |
| Path A OAuth flow lands on a 401 after Supabase auth succeeds | The composer record does not exist on the project, OR the email used to authenticate does not match the invited email | Confirm with admin that `atelier invite` (or the equivalent `seed-composer.ts`) was run for your specific email; check the `composers` table |
| Path B: connector triggers OAuth flow despite static Authorization header | Wrong URL pasted -- claude.ai's MCP SDK runs OAuth when discovery is reachable. You pasted `/oauth/api/mcp`; for Path B paste `/api/mcp` instead so discovery is intentionally absent | Re-paste with `/api/mcp`; verify `/.well-known/oauth-authorization-server` returns JSON 404 (per PR #16 catch-all) |
| Path B smoke test returns 401 on `register` | Bearer token is invalid, expired, or has wrong audience | Ask admin to issue a fresh token via `scripts/bootstrap/issue-bearer.ts` (or `atelier invite <your-email> --rotate` once polished) |
| Smoke test passes but real tool calls return 403 | The composer's role does not match the territory you're trying to write into | Check `.atelier/territories.yaml`; the territory's `owner_role` or the project's `territories.allow_cross_role_authoring` setting may need adjustment |
| Smoke test passes but `get_context` returns empty `charter.paths` | The endpoint is not pointed at a real repo, OR the repo has no `CLAUDE.md` / `AGENTS.md` / charter files | Admin issue; check `git_provider` and webhook configuration |
| Tools work but feel slow (multi-second latency on every call) | Cold-start on the configured serverless platform, OR claude.ai's connector adds round-trip overhead | Largely out of scope for this doc; the project's hosting may need a min-instances setting or warm-up cron |
| Path A discovery works locally via curl but claude.ai connector save still fails | OAuth callback host mismatch. Discovery's `issuer` field must match the host claude.ai redirects to. If your Supabase project is `<ref>.supabase.co` but the OAuth issuer is overridden to a different host, the flow breaks | Check `ATELIER_OIDC_ISSUER` in Vercel env vars matches the Supabase project's actual auth issuer URL exactly (no trailing newline -- see the env-var trim caveat in `first-deploy.md`) |

If your symptom is not in this table or the smoke test in ARCH 6.1.1, file an issue against the Atelier project repo.

---

## What to do next

Once your connector works:

- For an analyst: see [`analyst-week-1.md`](../../architecture/walks/analyst-week-1.md) -- the canonical week-1 scenario walks through register / get_context / find_similar / claim / update / log_decision / release.
- For a designer: see [`designer-week-1.md`](../../architecture/walks/designer-week-1.md).
- For any composer: try `get_context()` (no arguments) and read what the project's current state is.

---

## Cross-references

- ARCH section 7.9 -- Web-surface auth flow (the protocol spec this runbook implements)
- ARCH section 6.1.1 -- Self-verification flow (the smoke test referenced above)
- ADR-009 -- Remote-principal actor class
- ADR-028 -- Identity service default Supabase Auth
- PR #14 -- substrate URL split rationale (`/api/mcp` static-bearer vs `/oauth/api/mcp` OAuth-flow)
- PR #16 -- catch-all JSON 404 for `/.well-known/*` probes (Claude Code SDK probe-shape compatibility)
- `docs/user/tutorials/first-deploy.md` -- the prerequisite deploy runbook + the env-var trim gotcha + Supabase OAuth callback allowlist details
- [README.md](README.md) -- Connector compatibility matrix
- US-11.4 -- `atelier invite` (token issuance)
- US-2.1 / US-2.2 / US-2.4 / US-2.3 -- the four tools the smoke test exercises
