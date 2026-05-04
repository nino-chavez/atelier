# Invite a composer

**Audience:** an operator (architect/admin role) bringing a new human teammate onto an Atelier project. Agent-onboarding follows a different path (OAuth at `/oauth/api/mcp`); see the appropriate `docs/user/connectors/<client>.md` runbook.

**Scope:** both local-bootstrap (`supabase start` on `127.0.0.1`) and cloud Supabase deploys. Mode is auto-detected from `ATELIER_DATASTORE_URL`.

---

## What `atelier invite` does

Per ADR-009 (remote-principal actor class), ADR-028 (Supabase Auth as default identity provider), and ADR-038 (composer discipline + access_level enums), inviting a composer is a single substrate operation that does three things atomically:

1. Creates the Supabase Auth user (or reuses an existing one with `--reinvite`).
2. Inserts the `composers` row with `identity_subject = auth.user.id` (the JWT `sub` claim per ARCH 7.9), the chosen discipline, and access level.
3. Either dispatches Supabase's invitation email (default) **or** returns the magic-link URL for manual sharing (`--no-send-email`).

The invitee receives a magic link, clicks it, lands at `/sign-in/callback`, the PKCE exchange seats their Supabase Auth session cookie, and the `/atelier` lens UI renders. That receiving flow is owned by D7 — see `docs/user/guides/sign-in-magic-links.md` for what the invitee experiences.

---

## Quick reference

```bash
atelier invite --email alice@example.com --discipline dev
```

That's the common case. Add `--access-level admin` or `--reinvite` as needed.

---

## Required flags

| Flag | Purpose |
|---|---|
| `--email <addr>` | The invitee's email address. |
| `--discipline <role>` | One of `analyst | dev | pm | designer | architect` (per ADR-038). |

## Optional flags

| Flag | Default | Purpose |
|---|---|---|
| `--access-level <level>` | `member` | One of `member | admin | stakeholder`. |
| `--project-id <uuid>` | auto | Target project. Auto-resolves when exactly one project exists in the datastore; required when zero or multiple. |
| `--display-name <string>` | derived | Defaults to the email local-part (`alice@example.com` → `alice`). |
| `--no-send-email` | (off) | Do not dispatch Supabase's invitation email; return the magic-link URL for manual sharing. Use in deploys without SMTP configured. |
| `--reinvite` | (off) | The email must already exist as a composer; returns a fresh magic link without creating a new row. |
| `--site-url <url>` | env or `localhost:3000` | Public URL of the deploy. Drives the magic-link redirect target (`<site>/sign-in/callback?redirect=/atelier`). Reads `ATELIER_PUBLIC_URL` from env when unset. |
| `--remote` / `--local` | auto | Force cloud / local mode regardless of env detection. |
| `--dry-run` | (off) | Preview without mutating. |
| `--json` | (off) | Machine-readable output. |

---

## Common flows

### Local development — invite a teammate to your local Atelier

The Supabase CLI's local stack does not configure SMTP, so use `--no-send-email` and share the magic link manually:

```bash
atelier invite \
  --email alice@example.com \
  --discipline dev \
  --no-send-email
```

Output ends with the magic-link URL. Paste it into Slack DM / 1Password / encrypted email. The link is single-use and valid for 1 hour.

### Cloud deploy with SMTP configured — invite an external collaborator

When the deploy has Supabase Auth's SMTP configured (Project Settings → Auth → Email Templates), the default path dispatches the invitation email automatically:

```bash
ATELIER_PUBLIC_URL=https://atelier.example.com \
atelier invite \
  --email alice@example.com \
  --discipline pm \
  --access-level admin
```

The invitee gets a Supabase-branded email; clicking the link lands them at `<site>/sign-in/callback`, which exchanges the PKCE code for a session cookie.

### Cloud deploy without SMTP — same as local but pointed at the cloud datastore

The reference deploy does not have SMTP configured (per `first-deploy.md`); use `--no-send-email`:

```bash
ATELIER_DATASTORE_URL=postgresql://...supabase.co:5432/postgres \
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
ATELIER_PUBLIC_URL=https://<your-deploy>.vercel.app \
atelier invite \
  --email alice@example.com \
  --discipline dev \
  --no-send-email
```

### Re-issue a magic link for a forgotten/expired one

```bash
atelier invite --email alice@example.com --discipline dev --reinvite
```

`--reinvite` looks up the existing composer + Auth user, generates a fresh magic-link URL (always returned in CLI output, regardless of `--send-email`), and updates `composers.identity_subject` defensively. No new row is created.

---

## Mode auto-detection

The CLI decides between local and cloud mode by inspecting `ATELIER_DATASTORE_URL`:

| Condition | Mode |
|---|---|
| `--local` flag passed | local |
| `--remote` flag passed | cloud |
| `ATELIER_DATASTORE_URL` points at non-localhost | cloud |
| `ATELIER_DATASTORE_URL` unset or points at localhost | local |

Local mode reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env, falling back to `supabase status -o env` when running locally. Cloud mode requires both env vars to be set explicitly (matches `first-deploy.md` Step 4).

---

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Invite succeeded; composer row exists; magic link delivered (email or URL). |
| `1` | Substrate failure (Supabase Auth error, Postgres connection failure). |
| `2` | Argument or precondition error (invalid email, unknown discipline, duplicate without `--reinvite`, project ambiguity, missing service role key). |

---

## Beyond magic links: bearers for headless agents

`atelier invite` is for humans who will sign in via the browser at `/sign-in`. Headless agents (CI scripts, test rigs) authenticate via OAuth at `/oauth/api/mcp`, OR via raw bearers issued by `scripts/bootstrap/issue-bearer.ts` after `atelier invite` creates the user. Per ADR-018 the bearer path is operator-driven, not invite-time.

---

## Related

- `docs/user/guides/sign-in-magic-links.md` — what the invitee experiences when they click the link.
- `docs/user/guides/rotate-bearer.md` — rotating a stale bearer for an MCP client.
- `docs/user/connectors/` — per-client (Claude Code, Cursor, claude.ai) connector setup.
- `scripts/bootstrap/invite-composer.ts` — the underlying substrate helper. Runnable directly when the polished CLI surface is unavailable.
- ADR-009, ADR-018, ADR-028, ADR-038 — the load-bearing decisions behind this flow.
