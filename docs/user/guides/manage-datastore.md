# Manage the coordination datastore

**Audience:** an operator (architect/admin role) standing up Atelier's coordination datastore for the first time, OR resetting the local Supabase environment between runs. For ongoing schema migrations on a populated deploy, use `atelier upgrade` instead — see the boundary section below.

**Scope:** both local-bootstrap (`supabase start` on `127.0.0.1`) and cloud Supabase deploys. Mode is auto-detected from `POSTGRES_URL` (canonical) or legacy `ATELIER_DATASTORE_URL`.

---

## What `atelier datastore init` does

Per ARCH 5.1 (the 11 user-facing tables), ADR-027 (reference impl: GitHub + Supabase + Vercel + MCP), ADR-029 (no proprietary helpers outside named adapters), ADR-044 (M5-exit local-bootstrap inflection), and ADR-046 (cloud deploy = Vercel + Supabase Cloud), `init` is the first-time bootstrap step that:

| Phase | Local mode | Cloud mode |
|---|---|---|
| Pre-flight | `docker` reachable; `supabase` CLI installed | `POSTGRES_URL` set; `supabase` CLI present when using `db push` |
| Apply migrations | `supabase start` (auto-applies during bring-up) OR `supabase db reset --local` with `--reset --yes` | `supabase db push` when project is linked; falls back to direct `psql` over the migrations in lexicographic order |
| Verify schema | Counts the 11 ARCH 5.1 tables in `public`; missing-table report | Same |
| Seed (optional) | `--seed --email <X> --password <Y>`: delegates to `scripts/bootstrap/seed-composer.ts` to create `atelier-self` project + admin composer | Same |

The 11 user-facing tables verified: `projects`, `composers`, `sessions`, `territories`, `contributions`, `decisions`, `locks`, `contracts`, `telemetry`, `embeddings`, `triage_pending`. The `delivery_sync_state` table (operational-only, migration 3) is not gated on but present after a clean run.

---

## Boundary with `atelier upgrade`

`atelier datastore init` is for **first-time bootstrap** of an empty datastore. `atelier upgrade` (E2) is for **steady-state migration application** on a populated datastore.

| Use case | Command |
|---|---|
| First-time local bootstrap (from blank docker volume) | `atelier datastore init` |
| First-time cloud deploy (empty Supabase project) | `atelier datastore init --remote` |
| Apply a new migration to an existing populated deploy | `atelier upgrade --check` then `atelier upgrade --apply` |
| Reset local Supabase to a clean slate | `atelier datastore init --reset --yes` |
| Audit current schema vs `supabase/migrations/` | `atelier upgrade --check` |
| Re-seed an admin composer on an already-bootstrapped instance | `atelier datastore init --seed --email <X> --password <Y>` (skips re-applying migrations when schema verifies) |

`init` and `upgrade` both apply migrations but with different intents: `init` ensures the schema is whole and the deploy is ready for a first composer; `upgrade` validates incremental changes against the `atelier_schema_versions` tracking table (E1 substrate) and refuses to clobber adopter-modified migrations without `--force-apply-modified`.

If you are unsure which to run: `atelier upgrade --check` is read-only and tells you whether your schema is current. `atelier datastore init` is idempotent on `supabase start` but the `--reset` path is destructive — gate it on `--yes` deliberately.

---

## Quick reference

```bash
# Local bootstrap (fresh checkout, docker running):
atelier datastore init

# Local bootstrap + seed an admin composer in one command:
atelier datastore init --seed --email you@example.com --password '<strong>'

# Cloud bootstrap (Supabase project already linked):
POSTGRES_URL=postgresql://... \
  SUPABASE_URL=https://<ref>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<key> \
  atelier datastore init --remote

# Reset local to a clean slate:
atelier datastore init --reset --yes
```

---

## Init flags

| Flag | Default | Purpose |
|---|---|---|
| `--remote` | (off) | Force cloud mode regardless of env detection. |
| `--local` | (off) | Force local mode regardless of env detection. |
| `--reset` | (off) | (Local only) `supabase db reset --local`. Destructive: wipes the local DB and re-applies migrations. Requires `--yes` or interactive confirmation. |
| `--yes` | (off) | Skip the destructive-action confirmation prompt. |
| `--seed` | (off) | After init, seed an admin composer + `atelier-self` project. |
| `--email <addr>` | — | Required with `--seed` (or interactive prompt). |
| `--password <pwd>` | — | Required with `--seed`. Stored only by Supabase Auth; never echoed. |
| `--discipline <role>` | `architect` | One of `analyst | dev | pm | designer | architect`. Used by `--seed`. |
| `--access-level <level>` | `admin` | One of `member | admin | stakeholder`. Used by `--seed`. |
| `--project-name <name>` | `atelier-self` | Used by `--seed`. |
| `--non-interactive` | (off) | Skip prompts; fail if required flags are missing. |
| `--dry-run` | (off) | Render the plan without mutating. Skips schema verification (no DB to query). |
| `--json` | (off) | Machine-readable output. |

Exit codes: `0` success (all migrations apply, all 11 ARCH 5.1 tables verify, optional seed succeeds); `1` schema/migration failure; `2` argument or precondition error.

---

## Common flows

### First-time local bootstrap

After cloning the repo and starting docker:

```bash
atelier datastore init --seed --email you@example.com --password '<strong>'
```

This sequences: `supabase start` (auto-applies migrations) → schema verification (11 tables) → seed composer + atelier-self project. The "Next steps" output points you at `atelier dev` and `atelier doctor`.

### First-time cloud deploy

After `supabase link --project-ref <ref>` and exporting credentials:

```bash
POSTGRES_URL=postgresql://...supabase.co:5432/postgres \
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
atelier datastore init --remote
```

Mode auto-detects from the non-localhost `POSTGRES_URL`. Migration application path is `supabase db push` if the project is linked (`supabase/.temp/project-ref` present), or direct `psql` over the migrations otherwise.

### Reset local to a clean slate

```bash
atelier datastore init --reset --yes
```

Wipes the local Supabase database via `supabase db reset --local` and re-applies all migrations. Use when you have leftover seed data interfering with a smoke run, or after a destructive migration test.

### Dry-run (preview without mutating)

```bash
atelier datastore init --dry-run
```

Renders the plan (preflight status + intended actions) without spawning `supabase` or connecting to the database. Useful in CI to confirm the env is correctly set before committing to a real run.

### Scripted retrieval (`--json`)

```bash
atelier datastore init --remote --json | jq '.schema.presentTables'
```

The JSON output carries `{ ok, mode, reason, databaseUrl, dryRun, local|cloud, schema, seed }`.

---

## Mode auto-detection

| Condition | Mode |
|---|---|
| `--local` flag passed | local |
| `--remote` flag passed | cloud |
| `POSTGRES_URL` points at non-localhost | cloud |
| `POSTGRES_URL` unset or points at localhost | local |

Cloud mode requires `POSTGRES_URL` (canonical; legacy `ATELIER_DATASTORE_URL` or `DATABASE_URL` accepted as fallback) to be set. `--seed` in cloud mode also requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` per `first-deploy.md` Step 4. Local mode reads them from `supabase status -o env` automatically.

---

## Related

- `docs/user/tutorials/local-bootstrap.md` — the local bring-up runbook this command operationalizes.
- `docs/user/tutorials/first-deploy.md` — the cloud deploy runbook.
- `docs/user/guides/upgrade-schema.md` — the steady-state migration runner (`atelier upgrade`).
- `docs/user/guides/invite-composers.md` — onboarding additional composers after the admin seed.
- `scripts/bootstrap/seed-composer.ts` — the seed delegate. Runnable directly when the polished CLI is unavailable.
- ARCH 5.1 — the 11 user-facing tables verified.
- ADR-027, ADR-029, ADR-044, ADR-046 — load-bearing decisions behind this flow.
