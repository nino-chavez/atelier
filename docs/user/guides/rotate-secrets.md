# Rotate secrets

**Audience:** Operators of any Atelier deployment (local-bootstrap or cloud-deployed).

**Triggers:** Routine rotation, suspected compromise, key leak in logs/transcripts/commits, departing team member, vendor key-rotation policy.

**Surfaced by:** The OpenAI API key incident at M5 (key text appeared in agent transcript history). The runbook gap that enabled it is closed by this document.

---

## What this covers

Atelier touches multiple credential classes. Each has a distinct rotation procedure, blast radius, and verification step. The classes:

| Class | Used by | Lifetime | Where stored |
|---|---|---|---|
| **Bearer tokens** (Supabase Auth user JWTs) | MCP clients (Claude Code, Cursor, claude.ai Connectors) | 1 hour default; refreshable | Per-client config (`.mcp.json` or equivalent) |
| **OpenAI / embedding API keys** | The endpoint's find_similar adapter | Until revoked | Deploy env (`OPENAI_API_KEY`) |
| **Supabase service-role key** | Endpoint admin paths, seed scripts | Until rotated at Supabase dashboard | Deploy env (`SUPABASE_SERVICE_ROLE_KEY`) |
| **Supabase anon key** | Public client surfaces (sign-in flows) | Until rotated at Supabase dashboard | Deploy env, client-side bundles |
| **Per-project committer deploy key** (SSH or PAT) | The git committer (per ARCH 7.8 / ADR-023) | Until rotated at git provider | Deploy env (`ATELIER_COMMITTER_*`) |

The procedures below cover all five.

---

## Bearer tokens (Supabase Auth user JWTs)

**Lifetime:** 1 hour for the access token; ~30 days for the refresh token (Supabase default).

**When to rotate:**

- The token has expired (clients see 401 from the endpoint)
- The token leaked into a transcript, log, screenshot, shared link, or commit
- The composer's session is being deregistered intentionally
- A teammate had access to your token and you no longer want to share that access

**How to rotate:**

If you have the refresh token, request a new access token from Supabase Auth's `/token` endpoint with `grant_type=refresh_token`. Most MCP clients handle this automatically when the access token expires.

If you don't have the refresh token (e.g., you copy-pasted the access token directly per the local-bootstrap runbook), re-run the issuance flow:

```bash
SUPABASE_URL=<your supabase URL> \
SUPABASE_ANON_KEY=<your anon key> \
npx tsx scripts/bootstrap/issue-bearer.ts \
  --email you@example.com \
  --password <your password>
```

Update the bearer token in your MCP client config (`.mcp.json`, `~/.claude.json`, etc.). The Claude Code CLI for an existing entry:

```bash
claude mcp remove atelier
claude mcp add atelier --transport http http://localhost:3030/api/mcp \
  --header "Authorization: Bearer <new token>" \
  --scope project
```

**How to verify:**

- `claude mcp list` shows the `atelier` entry as connected
- A `get_context` call from the client succeeds (no 401)

**Blast radius if not rotated:**

- A leaked access token grants endpoint access until expiry (max 1 hour)
- Anyone who holds the token can issue tool calls AS your composer until expiry
- Local-bootstrap: blast radius is your machine + anyone with network access to your localhost (typically nobody)
- Deployed: blast radius is anyone on the network who can reach the deployed endpoint

---

## OpenAI / embedding API keys

**Lifetime:** Until manually revoked. There is no automatic expiry.

**When to rotate:**

- Key appeared in plaintext anywhere outside your password manager (transcripts, logs, screenshots, commits, shared screen recordings, public PRs)
- The vendor flagged the key as compromised (OpenAI sometimes auto-revokes leaked keys it detects via GitGuardian-style scans)
- A team member who held the key has departed
- Routine rotation per organizational policy (typically 90 days)
- You're swapping providers (e.g., OpenAI → vLLM); revoke the old key and update the env to the new provider per the OpenAI-compatible adapter contract from ADR-041

**How to rotate (OpenAI):**

1. Go to https://platform.openai.com/api-keys
2. Find the key in question; click "Revoke" (the key stops working immediately)
3. Create a new key; capture it once at creation time (OpenAI does not show it again)
4. Update the `OPENAI_API_KEY` env var:
   - Local-bootstrap: update the env var on the terminal where you run `npm run dev`; restart the dev server
   - Deployed: update the deploy env (Vercel: `vercel env rm OPENAI_API_KEY production && vercel env add OPENAI_API_KEY production`); redeploy
5. Verify: trigger a `find_similar` call (via `/atelier` panel or direct tool call); response should NOT carry `degraded: true` due to embedding adapter failure

**How to rotate (other OpenAI-compatible providers):**

Same shape as OpenAI but the dashboard URL differs:
- **Voyage AI:** https://dashboard.voyageai.com/api-keys
- **Anthropic** (if used as an embedding fallback elsewhere): https://console.anthropic.com/settings/keys
- **Self-hosted (vLLM, Ollama, LocalAI):** rotate the API key in your provider's auth config; if no auth, the network ACL is the security boundary

**Blast radius if not rotated:**

- A leaked OpenAI key can be used by anyone to issue API calls billed to your account until revoked
- For the embedding-only key class used by Atelier, the typical risk is unexpected charges (an attacker uses your key to embed their own content)
- Higher-risk if the key has broader scopes (chat, fine-tuning); least-privilege keys with embeddings-only scope minimize this

---

## Supabase service-role key

**Lifetime:** Until rotated via Supabase dashboard.

**When to rotate:**

- Key leaked anywhere
- A team member with admin access has departed
- Routine rotation per organizational policy
- Supabase project migrating between environments

**How to rotate:**

1. Go to your Supabase project dashboard → Settings → API
2. Click "Rotate" next to the service-role key (this REVOKES the existing key immediately)
3. Capture the new key
4. Update `SUPABASE_SERVICE_ROLE_KEY` env in:
   - Any seed scripts you run (`scripts/bootstrap/seed-composer.ts`, etc.)
   - The deployed endpoint env (admin paths use this)
5. Redeploy / restart any service consuming the key

**How to verify:**

- A test seed script run completes without auth errors
- The endpoint's admin paths (e.g., contributing to `decisions` via the bot identity) succeed

**Blast radius if not rotated:**

- The service-role key bypasses all Row-Level Security in Postgres
- A leaked service-role key grants full read/write access to every row in every table in your Supabase project
- This is the highest-blast-radius credential Atelier touches; treat it accordingly

---

## Supabase anon key

**Lifetime:** Until rotated via Supabase dashboard.

**When to rotate:**

- Rare; the anon key is designed to be public (it's embedded in client bundles)
- Rotate only if the project's RLS policies have changed in a way that requires invalidating outstanding sessions, or per organizational policy

**How to rotate:** Same as service-role key (Supabase dashboard → Settings → API → Rotate next to anon key), then update everywhere it's referenced.

**Blast radius:** Low. The anon key only grants the access RLS allows; it's the public-side identifier.

---

## Per-project committer deploy key

**Surfaced by:** ARCH 7.8 / ADR-023's per-project git committer needs write access to the project repo to push ADR commits when `log_decision` fires.

**Two implementation choices** (your project picks one at deploy time):

- **SSH deploy key**: a per-repo SSH key with write access; rotated at the git provider (GitHub: Settings → Deploy keys; GitLab: Settings → Repository → Deploy keys)
- **Personal Access Token (PAT)**: a fine-scoped token bound to a bot user; rotated at the git provider's token UI

**When to rotate:**

- Routine rotation per organizational policy (often quarterly)
- Suspected compromise
- The bot user's account is being decommissioned

**How to rotate (SSH):**

1. Generate a new keypair: `ssh-keygen -t ed25519 -C "atelier-committer-<projectname>"`
2. Add the new public key to the repo's deploy keys (with write access)
3. Remove the old deploy key
4. Update the deploy env to point at the new private key file (`ATELIER_COMMITTER_SSH_KEY_PATH` or however your config exposes it)
5. Restart the endpoint
6. Verify by triggering a `log_decision` and confirming the ADR commit lands on the configured branch

**How to rotate (PAT):**

1. Create a new PAT in the git provider's token UI with `repo:write` scope (or equivalent)
2. Update `ATELIER_COMMITTER_TOKEN` (or equivalent) env var in the deploy
3. Revoke the old PAT in the same UI
4. Restart the endpoint
5. Verify with a `log_decision` test

**Blast radius if not rotated:**

- A leaked deploy key grants write access to the configured repo
- An attacker can push commits, open PRs, or rewrite history (depending on the key's permissions)
- Mitigations: use least-privilege keys (write to a single branch only, no force-push, no admin); enforce branch protection on `main`

---

## What goes in the runbook for adopters who fork Atelier

Adopters running Atelier on their own infrastructure should:

1. Document their key rotation cadence in their fork's `docs/user/guides/rotate-secrets.md`
2. Pick a secrets manager (1Password, AWS Secrets Manager, Doppler, Vault) and reference it from this runbook
3. Add organization-specific rotation triggers (e.g., quarterly per SOC2, annually per ISO27001, immediately on offboarding)
4. Optionally automate rotation via the secrets manager's lifecycle hooks (rotate the key, update the env, restart the endpoint, verify)

The runbook lives in the OSS template as a starting point; adopters tailor it to their compliance posture.

---

## Related

- ADR-041 (embedding adapter contract; explains why the OpenAI key is one of multiple supported providers)
- ADR-023 (per-project git committer; explains why the deploy key is per-project, not global)
- ADR-044 (bootstrap inflection; explains why local-bootstrap uses the same bearer-token model as deployed)
- BRD-OPEN-QUESTIONS section 25 (cross-dimension embedding swap; relevant when rotating to a different provider's model)
- The committer rotation runbook gap is also tracked in M2-mid follow-up §6 ("committer deploy-key rotation runbook (`atelier rotate-committer-key`)") — this document closes part of that gap; the CLI command itself lands at M7 polish.
