# Connect Cursor to your Atelier project

**Status:** SMOKE TESTED 2026-04-30 (protocol-equivalent). Cursor speaks the same Streamable HTTP MCP transport that `scripts/endpoint/__smoke__/real-client.smoke.ts` exercised end-to-end against a real Supabase Auth issuer; the wire is the same. Cursor-specific UI prose below tracks Cursor v0.42+ as of 2026-04. If your Cursor version's MCP settings UI has moved, the JSON config schema is stable.

---

## Who this is for

A composer (dev, designer) who works in Cursor as their primary IDE and wants the project's 12 Atelier tools available to Cursor's agent.

If you use Claude Code instead, see [`claude-code.md`](claude-code.md). For the full client list see the [compatibility matrix](README.md).

---

## Prerequisites

- **A deployed Atelier endpoint.** Endpoint URL in the form `https://atelier-<project>.vercel.app/api/mcp` or your team's custom domain.
- **An invitation from an admin.** `atelier invite <your-email> --role <your-role>` was run; you have the endpoint URL and a static API token.
- **Cursor v0.42+ installed.** Earlier versions had a different MCP config shape; if you're on an older Cursor, upgrade or use the legacy stdio bridge (out of scope here).

Cursor as of v0.42 supports static-bearer auth on remote MCP servers. OAuth-protected MCP servers are tier-2 supported by community plugins; the canonical setup is **Path B (static bearer)**.

---

## Path B: Static API token

### Steps

1. **Open Cursor's MCP settings.** Cmd/Ctrl-, → Settings → MCP, or edit `~/.cursor/mcp.json` (or `<workspace>/.cursor/mcp.json` for workspace-scoped servers; workspace-scoped is recommended so the config travels with the repo).

2. **Add a server entry:**

   ```json
   {
     "mcpServers": {
       "atelier-<project-name>": {
         "url": "https://atelier-<project>.vercel.app/api/mcp",
         "headers": {
           "Authorization": "Bearer ${env:ATELIER_BEARER_TOKEN}"
         }
       }
     }
   }
   ```

3. **Export the token.** Add `ATELIER_BEARER_TOKEN=<your-static-token>` to the shell that launches Cursor (or to `~/.cursor/.env` if Cursor reads that on your platform). The `${env:VAR}` substitution avoids committing the raw token in the workspace config.

4. **Reload Cursor.** Reload window (Cmd/Ctrl-Shift-P → `Developer: Reload Window`) so the agent reconnects to the MCP server.

5. **Verify.** Cursor's MCP panel (or the agent's tool drawer) should list the 12 Atelier tools (`register`, `heartbeat`, `deregister`, `get_context`, `find_similar`, `claim`, `update`, `release`, `log_decision`, `acquire_lock`, `release_lock`, `propose_contract_change` per ADR-013 + ADR-040).

### Smoke test

In a Cursor agent prompt:

> Using the Atelier MCP tools, run register / heartbeat / get_context / deregister in sequence and report each result.

The agent should run the four-step sequence end-to-end. If all four return ok, the wiring works.

This sequence is documented in ARCH section 6.1.1 with the canonical symptom-to-cause mapping.

### Token rotation

Per the project's `policy.token_ttl_seconds`, the admin runs `atelier invite <your-email> --rotate`; you update the env var and reload Cursor.

---

## Path A: OAuth (community-plugin path)

If your team needs OAuth-driven token rotation for Cursor, the path requires a community plugin (e.g., a local OAuth-bridge MCP server) that handles the dance and proxies bearer-attached requests to your Atelier endpoint. This is tier-2 supported and not covered by the canonical smoke. If you go this route:

1. Stand up the OAuth bridge per its own docs.
2. Point Cursor at the bridge's local URL (`http://localhost:<port>/mcp`) instead of the Atelier endpoint directly.
3. Configure the bridge with your project's Atelier discovery URL (`<endpoint>/.well-known/oauth-authorization-server`).

The smoke test sequence is the same; the bridge is transparent to the agent.

---

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---|---|---|
| Cursor's MCP panel shows the server but no tools appear | Bearer header not attached OR endpoint returns 401 on `tools/list` | Inspect Cursor's MCP log; ensure `${env:ATELIER_BEARER_TOKEN}` resolved to a non-empty value before launching |
| `register` returns `FORBIDDEN: bearer validation failed` | Token signed by an unrelated issuer, expired, or wrong audience | `atelier invite <your-email> --rotate`; confirm `ATELIER_JWT_AUDIENCE=authenticated` for Supabase Auth |
| `register` returns `FORBIDDEN: no active composer for identity_subject` | The `sub` claim in your token does not match any `composers.identity_subject` row | Admin issue; the invite flow must populate `identity_subject` from the IdP's user ID |
| Tools listed but every call returns 502 / 504 | Endpoint cold-start exceeds Cursor's per-call timeout | Project hosting issue; consider serverless min-instances or migrate to a warm-runtime tier |
| Workspace config gets committed by accident with the raw token | `mcp.json` was committed as-is instead of using `${env:VAR}` substitution | Rotate the token immediately via `atelier invite --rotate`; add `.cursor/mcp.json` to `.gitignore` if your workflow committed it inadvertently |

---

## What to do next

- For a dev: see [`dev-week-1.md`](../../architecture/walks/dev-week-1.md).
- For a designer: see [`designer-week-1.md`](../../architecture/walks/designer-week-1.md).
- Cursor's agent benefits from a project-scoped CLAUDE.md / AGENTS.md (the Atelier endpoint serves these via `get_context.charter.paths`); review the Atelier charter at `<repo>/CLAUDE.md`.

---

## Cross-references

- ARCH section 7.9 -- Web-surface auth flow
- ARCH section 6.1.1 -- Self-verification flow
- ADR-013 -- 12-tool agent endpoint surface
- ADR-040 -- 12-tool surface consolidation
- [README.md](README.md) -- Connector compatibility matrix
- [`scripts/endpoint/__smoke__/real-client.smoke.ts`](../../../scripts/endpoint/__smoke__/real-client.smoke.ts) -- The end-to-end smoke that verified the protocol path Cursor uses
