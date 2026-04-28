# Connect claude.ai to your Atelier project

**Status:** Design draft 2026-04-28. The screenshots and click-precise UI prose below are pending M2 endpoint deployment + first end-to-end smoke test against a real claude.ai connector. Until then, this runbook is the structural template. The protocol-level spec it implements (OAuth 2.1 bearer tokens over Streamable HTTP MCP) is authoritative at ARCH section 7.9.

---

## Who this is for

A composer (analyst, designer, PM, or stakeholder) who has been invited to an Atelier project and uses claude.ai as their primary agent client. By the end of this runbook, your claude.ai chat has the project's 12 tools available and you can issue your first `register` call.

If you use a different web-based agent client, see the [compatibility matrix](README.md) for the runbook covering yours.

---

## Prerequisites

Before starting, you need:

- **An Atelier project that's deployed.** That means someone on your team has run `atelier deploy` and the endpoint URL (something like `https://atelier-<project>.vercel.app/mcp` or your team's custom domain) is live.
- **An invitation from an admin.** Specifically, an admin on your project ran `atelier invite <your-email> --role <your-role>` and shared the response with you. The response includes both an OAuth setup link and a static API token; you need at least one (the OAuth path is preferred; the static token is the fallback).
- **A claude.ai account with Connectors / Custom Integrations enabled.** Connectors availability depends on your claude.ai plan; check with your claude.ai admin if the option is missing from your account settings.

---

## Path A: OAuth setup (preferred)

When the OAuth flow works end-to-end with claude.ai's connector and the project's identity provider (Supabase Auth by default per ADR-028), this is the cleaner path. Token rotation happens automatically; you don't paste anything by hand after the first setup.

### Steps

1. **Open claude.ai's connector settings.** Account menu → Settings → Connectors (path may vary; check claude.ai's current docs if the menu changed).
2. **Add a new connector.** Name it something like `Atelier <project-name>`.
3. **Paste the OAuth setup link from your `atelier invite` response.** This URL points at the project's authorization-server discovery endpoint (`<endpoint>/.well-known/oauth-authorization-server`). claude.ai's connector setup walks the OAuth flow against the configured identity provider.
4. **Authenticate.** A browser window opens to your project's identity provider (Supabase Auth's hosted login by default). Sign in with the email the admin invited.
5. **Authorize the connector.** The identity provider asks you to grant claude.ai access to the Atelier endpoint. Approve.
6. **Connector active.** Back in claude.ai, the connector shows as connected. Your chats now have access to the 12 Atelier tools.

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
3. **Configure the MCP server URL.** Paste your project's `ATELIER_ENDPOINT_URL` (the endpoint URL the admin shared, ending in `/mcp`).
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
| Connector shows "connection failed" immediately on save | Endpoint URL typo, OR the endpoint is not deployed, OR no network reachability from claude.ai's infrastructure | Verify `ATELIER_ENDPOINT_URL` with the admin; confirm the project is deployed; ask your network team about claude.ai outbound reachability |
| Path A OAuth flow lands on a 401 | The composer record does not exist on the project, OR the email used to authenticate does not match the invited email | Confirm with admin that `atelier invite` was run for your specific email; check the `composers` table |
| Path B smoke test returns 401 on `register` | Bearer token is invalid, expired, or has wrong audience | Ask admin to run `atelier invite <your-email> --rotate` and use the fresh token |
| Smoke test passes but real tool calls return 403 | The composer's role does not match the territory you're trying to write into | Check `.atelier/territories.yaml`; the territory's `owner_role` or the project's `territories.allow_cross_role_authoring` setting may need adjustment |
| Smoke test passes but `get_context` returns empty `charter.paths` | The endpoint is not pointed at a real repo, OR the repo has no `CLAUDE.md` / `AGENTS.md` / charter files | Admin issue; check `git_provider` and webhook configuration |
| Tools work but feel slow (multi-second latency on every call) | Cold-start on the configured serverless platform, OR claude.ai's connector adds round-trip overhead | Largely out of scope for this doc; the project's hosting may need a min-instances setting or warm-up cron |

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
- [README.md](README.md) -- Connector compatibility matrix
- US-11.4 -- `atelier invite` (token issuance)
- US-2.1 / US-2.2 / US-2.4 / US-2.3 -- the four tools the smoke test exercises
