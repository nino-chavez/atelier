# Rotate the Atelier MCP bearer

**Audience:** an operator (you) whose MCP client (Claude Code, claude.ai Connectors, Cursor, etc.) needs a fresh bearer token because the previous one expired or was rotated for security.

**Why this is a separate runbook:** Claude Code's MCP HTTP client caches the bearer in process state that survives both `/mcp` Disable→Enable AND `exit`+relaunch from the same shell. This is the load-bearing detail that makes "rotate the bearer" non-trivial — operators routinely think they've rotated when they haven't, then debug 401s for hours. The runbook below walks the only reliable path.

**Scope:** local-bootstrap (Supabase running on `127.0.0.1:54321`) and cloud Supabase deploys both follow the same shape; the only difference is the URL the rotate helper points at.

---

## What the cache does (and why automation is hard)

Empirically observed across M5/M6 (memory entry "smoke-vs-real-client divergence is the reliable bug class" + multiple substrate-fix PRs):

- Edit `.mcp.json` with a fresh bearer → save → run a tool from Claude Code → **OLD cached bearer is sent**.
- Open the `/mcp` settings dialog → Disable atelier → Enable atelier → run a tool → **OLD cached bearer is sent**.
- `exit` Claude Code → relaunch from the same shell → run a tool → **OLD cached bearer is sent**.
- Quit Claude Code completely (close all windows) → start a fresh process → **NEW bearer is sent**.

The cache lives in process memory that some shell-side state preserves across `exit`+relaunch (likely a running Claude Code daemon process — investigation is open per BRD-OPEN-QUESTIONS or M7 polish notes). The substrate side is fine — direct `curl` with the new bearer immediately works, proving the substrate sees the rotation. The MCP-tool-from-this-session path is the unreliable one.

**Practical implication:** automate the rotation (write `.mcp.json`), then **manually quit Claude Code completely** and start a fresh session before relying on tool calls.

---

## The one-command rotation (recommended)

`scripts/bootstrap/rotate-bearer.ts` wraps the `signInWithPassword` exchange + `.mcp.json` update + the load-bearing reminder. Use this for routine rotation:

```bash
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_ANON_KEY=<anon key from `supabase status -o env`> \
  npx tsx scripts/bootstrap/rotate-bearer.ts \
    --email you@example.com \
    --password <password from seed step>
```

Output (stderr):
```
[rotate-bearer] new access_token issued
[rotate-bearer]   user.id    = ...
[rotate-bearer]   email      = you@example.com
[rotate-bearer]   expires in = 3600s
[rotate-bearer] wrote new bearer to /path/to/.mcp.json

==============================================================
  IMPORTANT: Claude Code's MCP HTTP client caches the bearer
  in process memory. Editing .mcp.json does NOT propagate to
  a running Claude Code session, even with /mcp Disable->Enable
  or 'exit' + relaunch from the same shell.

  To use the new bearer:
    1. Quit Claude Code completely (close all windows)
    2. Start a fresh Claude Code session
    3. Run /mcp and confirm 'atelier' shows as connected

  Direct curl against the substrate uses the new bearer
  immediately (the substrate is stateless on bearer rotation;
  the cache is purely client-side).
==============================================================
```

Optional flags:

- `--mcp-config <path>` — default `<repo-root>/.mcp.json`
- `--server-name <name>` — default `atelier`
- `--print-only` — print the new bearer to stdout without writing the file (for piping into other tools)

For cloud Supabase, swap the env vars:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_ANON_KEY=<anon key from project settings> \
  npx tsx scripts/bootstrap/rotate-bearer.ts \
    --email you@example.com \
    --password <password from cloud seed step>
```

---

## After rotation: verify with curl first, THEN restart Claude Code

The `scripts/endpoint/__smoke__/real-client.smoke.ts` section [5] tests substrate-side bearer rotation acceptance. For an ad-hoc check after running the rotate helper:

```bash
NEW_BEARER=$(jq -r '.mcpServers.atelier.headers.Authorization' .mcp.json | sed 's/Bearer //')

# Substrate accepts the new bearer (should return JSON-RPC response, not 401):
curl -s -X POST http://localhost:3030/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $NEW_BEARER" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 200
```

If the curl succeeds (returns a tools list, not a 401), the substrate has the new bearer. **Then quit Claude Code completely and start a fresh session.** Run `/mcp` in the new session to confirm the `atelier` server shows as connected.

---

## Manual two-step (without the helper)

Same path, broken into the two underlying scripts. Use this when the rotate helper is unavailable (forked repo without it, debugging the helper itself, etc.).

```bash
# Step 1: issue a fresh bearer
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_ANON_KEY=... \
  npx tsx scripts/bootstrap/issue-bearer.ts \
    --email you@example.com \
    --password <pwd> \
  > /tmp/new-bearer.txt

# Step 2: edit .mcp.json manually -- replace the "Authorization" header
#   with "Bearer $(cat /tmp/new-bearer.txt)"
```

After editing, the same Claude Code restart procedure applies.

---

## What rotates and what doesn't

| Surface | Refreshes on `.mcp.json` save | Requires Claude Code restart |
|---|---|---|
| Substrate (the `/api/mcp` endpoint) | N/A — stateless on rotation | No |
| Direct curl from terminal | Yes (reads from disk per call) | No |
| `/atelier` lens UI in browser | Reload-on-refresh (pulls cookie auth, not bearer) | No |
| Claude Code MCP tool calls | **No** (process-cached) | **Yes** |
| Cursor MCP tool calls | Behavior varies; check Cursor docs | Likely yes |
| claude.ai Connectors (cloud) | OAuth flow handles rotation transparently | N/A |

The `Yes/No` distinction matters for the operator workflow: the rotate-bearer.ts script's friendly reminder message exists because the `.mcp.json` write completes silently while Claude Code still holds the old bearer in memory, and that mismatch is the source of the M5/M6 bearer-cache divergence finding.

---

## Cross-references

- `scripts/bootstrap/rotate-bearer.ts` — the helper script (PR #30 / F6.4 substrate-half)
- `docs/user/tutorials/local-bootstrap.md` Troubleshooting → "Bearer rotation issues" — points here
- `docs/user/guides/rotate-secrets.md` — broader credential rotation runbook (covers OpenAI key, Supabase service role key, per-project committer deploy key)
- `scripts/endpoint/__smoke__/real-client.smoke.ts` section [5] — substrate-side rotation probe (the part of the bearer-cache problem that IS testable)
- BRD §6 + ADR-028 — bearer model + identity provider default
- M7-exit audit (when filed) — operational verification of the smoke-vs-real-client divergence memory entry; bearer cache investigation tracked there
