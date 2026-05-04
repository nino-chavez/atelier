# Connect Claude Code to your Atelier project

**Status:** SMOKE TESTED 2026-04-30. The setup steps below were verified end-to-end against a local Supabase Auth issuer via `scripts/endpoint/__smoke__/real-client.smoke.ts` (real `signInWithPassword` -> production JWKS verifier -> ARCH 6.1.1 four-step). Production-deployed wiring should match step-for-step; the only thing that changes is the endpoint URL.

---

## Who this is for

A composer (dev, architect, designer) who works in the IDE and uses Claude Code as their agent client. By the end of this runbook, your Claude Code session has the project's 12 Atelier tools available and you can issue `register`, `heartbeat`, `get_context`, `deregister` against the live endpoint.

If you use a different IDE-based agent client, see the [compatibility matrix](README.md). The Cursor runbook is at [`cursor.md`](cursor.md).

---

## Prerequisites

Before starting, you need:

- **A deployed Atelier endpoint.** Someone on your team has run `atelier deploy` and the endpoint URL is live (something like `https://atelier-<project>.vercel.app/api/mcp` or your team's custom domain).
- **An invitation from a project admin.** The admin runs `atelier invite <your-email> --role <your-role>` and shares the response. You will receive: the endpoint URL, the OIDC issuer URL (your project's Supabase Auth instance), and either a personal sign-in for OAuth or a static API token.
- **Claude Code installed locally.** v0.5+ is recommended; older versions may not support remote MCP servers with OAuth-protected auth.

---

## Path A: OAuth (preferred)

Claude Code's MCP client supports the OAuth 2.1 dance against any RFC 8414-compliant authorization server. Atelier serves the discovery metadata at `<endpoint>/.well-known/oauth-authorization-server` pointing at your project's identity provider.

### Steps

1. **Open Claude Code's MCP config.** From the Claude Code CLI run `claude code mcp add` (or edit `~/.claude/claude_code_settings.json` directly).

2. **Add a new MCP server entry.** In the `mcpServers` map, add an entry like:

   ```json
   {
     "mcpServers": {
       "atelier-<project-name>": {
         "type": "http",
         "url": "https://atelier-<project>.vercel.app/api/mcp",
         "auth": {
           "type": "oauth",
           "discovery_url": "https://atelier-<project>.vercel.app/.well-known/oauth-authorization-server"
         }
       }
     }
   }
   ```

   The `type: "http"` field selects Streamable HTTP transport (per ARCH 7.9). The `auth.discovery_url` lets Claude Code drive PKCE against your project's identity provider with no further configuration.

3. **Authenticate.** The first time you start a Claude Code session referencing this MCP server, the CLI opens a browser to your identity provider's hosted login (Supabase Auth's `/auth/v1/authorize` by default). Sign in with the email your admin invited.

4. **Authorize.** The IdP asks you to grant Claude Code access to the Atelier endpoint. Approve.

5. **Verify.** Run `claude code mcp list` -- the entry should report `connected`.

### Smoke test

In a fresh Claude Code session prompt:

> Use the Atelier MCP server. Run `register`, then `heartbeat` with the returned `session_id`, then `get_context`, then `deregister`. Report each tool result.

The agent should run the four-step sequence end-to-end. If all four return ok, the wiring works. If any fail, see [Troubleshooting](#troubleshooting).

This sequence is documented in ARCH section 6.1.1 with the canonical symptom-to-cause mapping.

---

## Path B: Static API token (fallback)

For teams using a static-bearer-only IdP, or where OAuth dynamic-client-registration (RFC 7591) is not available, paste a long-lived bearer token and accept manual rotation when it expires.

### Steps

1. **Add the MCP server entry** with `headers.Authorization`:

   ```json
   {
     "mcpServers": {
       "atelier-<project-name>": {
         "type": "http",
         "url": "https://atelier-<project>.vercel.app/api/mcp",
         "headers": {
           "Authorization": "Bearer <your-static-token>"
         }
       }
     }
   }
   ```

   This is the canonical static-bearer shape per Claude Code's MCP config schema. (Earlier versions of this runbook documented an `auth.type: "bearer"` field — that field does not exist in the published schema; the `headers` map is the supported path.)

2. **Save the token in your password manager.** Bearer tokens are short-lived (1 hour for Supabase Auth defaults). Re-issue per the rotation runbook (`docs/user/guides/rotate-secrets.md`) when expired.

3. **Verify** with `claude code mcp list` -- entry should report `connected`.

### Smoke test

Same as Path A.

### Token rotation

When the token expires (per `policy.token_ttl_seconds`), the admin runs `atelier invite <your-email> --rotate` and shares the new token. Update the env var.

---

## Endpoint scope advertisement

The endpoint advertises required scopes via `<endpoint>/.well-known/oauth-authorization-server` per RFC 8414. As of 2026-04-30 the metadata response includes:

- `scopes_supported: ["openid", "profile", "email"]`
- `response_types_supported: ["code"]`
- `grant_types_supported: ["authorization_code", "refresh_token"]`
- `code_challenge_methods_supported: ["S256"]`

Claude Code reads the discovery URL at first connection and configures its OAuth client accordingly. No manual scope wiring is needed.

---

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---|---|---|
| `claude code mcp list` shows `disconnected` immediately | Endpoint URL typo OR endpoint not deployed OR network firewall blocks outbound | Verify URL with admin; confirm `curl <endpoint>/.well-known/oauth-authorization-server` returns 200 from your machine |
| Path A: browser opens but lands on the IdP's "user not found" | Composer email mismatch; the address you signed in with does not match `composers.email` for this project | Confirm with admin that `atelier invite` was run for your specific email; check the `composers` table |
| Path A: browser flow completes but Claude Code reports `401 missing Authorization: Bearer header` | Discovery URL points at a different issuer than the endpoint validates against | Admin issue; the endpoint derives the issuer from `NEXT_PUBLIC_SUPABASE_URL` (canonical) — confirm it matches the one the discovery doc advertises (legacy `ATELIER_OIDC_ISSUER` overrides when set) |
| Path B: `register` returns `FORBIDDEN` with `bearer validation failed` | Token signed by an unrelated issuer OR token expired OR audience mismatch | Run `atelier invite <your-email> --rotate`; the audience defaults to `authenticated` (Supabase Auth default) — only set `ATELIER_JWT_AUDIENCE` explicitly for non-Supabase IdPs |
| `register` returns `FORBIDDEN` with `no active composer for identity_subject` | The `sub` claim in your token does not match any `composers.identity_subject` | Admin issue; the invite flow must populate `identity_subject` from the IdP's user ID |
| Tools work but `get_context` returns empty `charter.paths` | Endpoint is not pointed at a real repo OR repo has no charter files | Admin issue; check `git_provider` and webhook configuration |
| Tools work but feel slow (multi-second per call) | Cold-start on serverless OR per-call overhead from Claude Code MCP harness | Project hosting issue; consider min-instances config |

If your symptom is not in this table, file an issue against the Atelier project repo.

---

## What to do next

- For a dev: see [`dev-week-1.md`](../../architecture/walks/dev-week-1.md) -- canonical week-1 scenario walks through claim / acquire_lock / update / log_decision / release_lock / release.
- For an architect: try `find_similar` to surface prior decisions on the territory you're about to touch.
- For any composer: `get_context()` with no arguments returns the current state -- charter, recent decisions, your territories, your active contributions.

---

## Cross-references

- ARCH section 7.9 -- Web-surface auth flow
- ARCH section 6.1.1 -- Self-verification flow (smoke test)
- ADR-013 -- 12-tool agent endpoint surface
- ADR-027 -- Reference stack (GitHub + Supabase + Vercel + MCP)
- ADR-028 -- Identity service default Supabase Auth
- ADR-040 -- 12-tool surface consolidation
- [README.md](README.md) -- Connector compatibility matrix
- [`scripts/endpoint/__smoke__/real-client.smoke.ts`](../../../scripts/endpoint/__smoke__/real-client.smoke.ts) -- The end-to-end smoke that verified this runbook
