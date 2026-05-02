# M6 runbook condensation (provenance)

**Filed:** 2026-05-02 as part of M7 Track 1 / "runbook condensation post-atelier dev."

**Purpose.** Records what got moved, condensed, or trimmed from `docs/user/tutorials/local-bootstrap.md` after `atelier dev` (US-11.13 / PR #35) landed and pre-empted most Step 0 manual checks. Operators searching for content that used to live in local-bootstrap.md but isn't there anymore should find it referenced here.

This file is provenance only — not a runbook. The canonical runbooks remain:

- `docs/user/tutorials/local-bootstrap.md` — local-stack bringup
- `docs/user/tutorials/first-deploy.md` — cloud deploy
- `docs/user/guides/rotate-bearer.md` — bearer rotation
- `docs/user/guides/rotate-secrets.md` — broader credential rotation

---

## What changed

### 1. New "Quick start" section at the top

Added: a one-paragraph TLDR pointing operators at `atelier dev` for routine session bringup. The numbered Steps 1-8 stay as the explanatory reference; the quick-start frames them as "what `atelier dev` automates" so new readers know they can skip the steps for daily use.

Why: the M6-era runbook required reading 8 sequential steps for every session bringup. With `atelier dev` available, the routine path collapses. Steps remain as explanatory + debugging reference.

### 2. Step 0 (Pre-flight checks) trimmed

Before: ~30-line shell snippet running 4 inline checks (supabase status, dev server reachable, bearer expiry via Python, port :3030 free via lsof).

After: 1 line — `atelier dev --preflight-only` runs all 4 checks (and one more — env file presence — that the M6 inline version didn't cover).

The full inline shell snippet is preserved here for operators who can't or don't want to use the CLI:

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

This is the canonical "what each pre-flight check does" reference for adopters extending or forking the substrate.

### 3. Bearer-rotation troubleshooting moved to `docs/user/guides/rotate-bearer.md`

Before: one entry in local-bootstrap.md Troubleshooting documenting the Claude Code MCP-client cache durability finding (the cache survives `/mcp` Disable→Enable AND `exit`+relaunch).

After: a dedicated runbook covering the cache class, the `scripts/bootstrap/rotate-bearer.ts` helper, the post-rotation curl verification, and the manual two-step path. The original troubleshooting line in local-bootstrap.md becomes a one-line redirect.

Why: bearer rotation is its own lifecycle concern (operators do it routinely, not just when troubleshooting). Pulling it into a focused guide makes it easier to find and harder to miss the load-bearing "quit Claude Code completely" instruction.

### 4. Four substrate-fix-derived troubleshooting entries consolidated into a "if /mcp fails" decision tree

Before: 4 separate entries in the Troubleshooting section, one per substrate-fix observation across M5/M6:

- "no MCP servers configured" (config not read)
- "npm run dev falls back to port 3001..." (port conflict)
- "/mcp Authenticate vs Reconnect" (URL split confusion)
- "SDK auth 404 / HTML 404" (catch-all route missing)

After: a unified "If `/mcp` fails (decision tree)" subsection at the top of Troubleshooting that walks the operator through:

1. Substrate reachable on the right port? (catches port :3030 fallback)
2. `/.well-known/oauth-authorization-server` returns JSON 404? (catches catch-all route missing)
3. `claude mcp list` shows the entry? (catches config not read)
4. Dialog defaults to Reconnect, not Authenticate? (catches URL split misuse)

Each branch points at the named entry below for the resolution detail. The 4 original entries are preserved as named branches under the decision tree.

Why: when `/mcp` fails, operators don't know which of the 4 classes they're hitting. A single decision tree front-loads the diagnosis.

### 5. Cross-references updated

`local-bootstrap.md` Step "What's next" still points at `first-deploy.md` (correct). The bearer-rotation troubleshooting redirect points at the new `rotate-bearer.md` guide. ARCH 9.7 + ADR-046 cross-references unchanged.

---

## What did NOT change

- Steps 1-8 (Supabase start, Node deps, seed composer, issue bearer, dev server, MCP client config, verify wire-up, update CLAUDE.md) remain in their original form. They are the explanatory reference + the manual fallback when `atelier dev` is unavailable or when the operator is debugging a specific step.
- "Security note for local-bootstrap" section unchanged.
- "What's next" section unchanged.

---

## Why provenance

Atelier's `docs/methodology/METHODOLOGY.md` invariant: discovery content evolves via PR; never silently rewrite or remove. This audit doc is the named home for the M6-era runbook content that doesn't appear in the current local-bootstrap.md. Future readers searching git history for "where did the bearer-rotation troubleshooting go?" land here.

The pattern (file an audit doc when a runbook condenses) generalizes — when adopters' projects accumulate runbook content over time, the same condensation pattern applies + the same provenance pattern keeps the historical content findable.

---

## Cross-references

- M7 kickoff Track 1 / "runbook condensation post-atelier dev" — the work item this audit closes
- PR #35 — `atelier dev` (US-11.13); the precondition for this condensation
- `docs/user/tutorials/local-bootstrap.md` — the post-condensation runbook
- `docs/user/guides/rotate-bearer.md` — the new dedicated bearer-rotation runbook
- `docs/methodology/METHODOLOGY.md` §6.1 — the canonical-vs-ephemeral invariant this audit honors
