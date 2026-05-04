# Upgrade your Atelier schema

**Audience:** Operators of an Atelier deployment (Tier 1 reference deployment, or Tier 2 fork with custom territories) who need to apply schema migrations after pulling new versions of the template.

**Prerequisite reading:** `docs/architecture/schema/migration-system.md` covers the design contract (filename conventions, idempotency requirement, append-only discipline, the three divergence buckets). This runbook is the day-to-day operator surface.

---

## TL;DR

```bash
# Pull upstream template changes:
git fetch upstream main && git merge upstream/main

# See what changed in the schema:
atelier upgrade --check

# Apply the pending migrations:
atelier upgrade --apply
```

That covers the routine path. The rest of this doc covers what to do when `--check` reports `modified` or `missing` migrations, and how to recover from a failed apply.

---

## Routine upgrade flow

After merging upstream changes (or branch-switching, or any operation that may add new files under `supabase/migrations/`):

### 1. Run `atelier upgrade --check`

```bash
atelier upgrade --check
```

`--check` is read-only and safe to run any time. Output looks like:

```
atelier upgrade -- schema migration status
-----------------------------------------
Mode:                  LOCAL
Datastore:             postgresql://postgres:***@127.0.0.1:54322/postgres
Template version:      1.0
Migrations on disk:    12
Migrations applied:    10
Status:
  up-to-date:          10 migration(s)
  pending:             2 migration(s)
    20260601000011_atelier_v1_1_<feature>.sql (sha256: a3f1c2...)
    20260601000012_atelier_v1_1_<followup>.sql (sha256: 9d2e4f...)
  modified:            0 migration(s) -- adopter-edited from upstream
  missing:             0 entry/entries -- applied but file removed from disk
```

Exit codes:

- `0` — datastore is up-to-date (no pending / modified / missing). Nothing to do.
- `1` — divergence detected. CI / scripts can gate on this.
- `2` — precondition error (preflight failed, or datastore unreachable). Fix the precondition and re-run.

### 2. Apply pending migrations

When `--check` reports pending, apply them:

```bash
atelier upgrade --apply
```

Migrations are applied in lex order (which equals chronological order via the timestamp prefix). Each apply runs inside a SQL transaction; if one fails, the runner stops without attempting subsequent migrations. The `atelier_schema_versions` table records every successful apply with the operator email, content hash, and template version at apply time.

To preview the apply sequence without executing:

```bash
atelier upgrade --apply --dry-run
```

### 3. Confirm the upgrade

`atelier upgrade --apply` re-renders status on success:

```
atelier upgrade -- DONE: applied 2 migration(s)

atelier upgrade -- schema migration status
-----------------------------------------
...
  up-to-date:          12 migration(s)
  pending:             0 migration(s)
  modified:            0 migration(s) ...
  missing:             0 entry/entries ...
```

If you run scripts off the dashboard or other automated checks, re-running them after apply is the routine smoke.

---

## Mode selection: LOCAL vs CLOUD

The CLI auto-detects mode from the datastore URL. Migrations prefer the direct (non-pooling) URL when set: `POSTGRES_URL_NON_POOLING` → `POSTGRES_URL` → legacy `ATELIER_DATASTORE_URL` → `DATABASE_URL`.

- **LOCAL** (default when env unset, or set to `127.0.0.1` / `localhost`):
  - Connects to `postgresql://postgres:postgres@127.0.0.1:54322/postgres` by default.
  - Preflight runs the same docker / supabase-CLI / `supabase status` checks `atelier dev` uses.
  - If supabase isn't running, the preflight fails with a hint to run `atelier dev`.

- **CLOUD** (any non-localhost host, OR `--remote` flag):
  - Connects to whatever the datastore URL chain resolves to.
  - Preflight only verifies a connection string is set.
  - The connection itself becomes the validity check; an unreachable host surfaces as a clear `failed to connect` error.

Force CLOUD mode explicitly:

```bash
POSTGRES_URL_NON_POOLING=postgresql://... atelier upgrade --check --remote
```

---

## Handling modified migrations

`modified` means the on-disk file content has a different SHA-256 than the row in `atelier_schema_versions`. Reasons this can happen:

- You forked Atelier and edited an upstream migration (e.g., commented out an INSERT, changed a default value, added an index).
- You hand-applied an emergency hotfix to a migration that was already applied.
- A teammate edited a migration without coordinating.

The CLI flags this and refuses `--apply` without explicit acknowledgment:

```
atelier upgrade: 1 modified migration(s) detected. Apply will refuse to proceed without --force-apply-modified.
Inspect each modified migration (`git log --diff <file>`),
then either revert your local changes or re-run with
--force-apply-modified to acknowledge the divergence.
```

### Decision: revert or acknowledge

For each modified migration:

1. **Inspect the diff:**

   ```bash
   git log --all --diff-filter=AM -- supabase/migrations/<filename>
   git show HEAD -- supabase/migrations/<filename>
   ```

2. **If your local edit was unintentional or no longer needed:**
   - Restore the upstream version: `git checkout upstream/main -- supabase/migrations/<filename>`
   - Re-run `atelier upgrade --check` to confirm `modified: 0`.

3. **If your local edit is intentional and should stay:**
   - File a local ADR documenting the divergence (per the adopter guidance in `docs/architecture/schema/migration-system.md`).
   - Re-run with `--force-apply-modified`:

     ```bash
     atelier upgrade --apply --force-apply-modified
     ```

   Note: `--force-apply-modified` does NOT update the recorded SHA. The intent is for forward-pending migrations; the modified row stays modified until you manually update it (the CLI's `applyMigration` uses `ON CONFLICT DO NOTHING` to avoid overwriting the historical record). To bring the recorded hash in sync with your local intent:

   ```sql
   -- Connect to your datastore via psql, then:
   UPDATE atelier_schema_versions
      SET content_sha256 = '<new-sha256>'
    WHERE filename = '<your-modified-file>';
   ```

   The new SHA must match the SHA-256 of the on-disk file content (compute via `shasum -a 256 supabase/migrations/<file>`).

---

## Handling missing migrations

`missing` means the `atelier_schema_versions` row references a filename that no longer exists on disk. Reasons:

- Someone deleted a migration file (almost always a bug — migrations are append-only per ADR-005).
- You're on an older branch where the migration hadn't been added yet.

### Recovery

1. **If on an older branch:** forward-merge the missing file into your tree, then re-run `--check`.

2. **If the file was deleted unintentionally:** restore from git:

   ```bash
   git log --all --diff-filter=D -- supabase/migrations/
   git checkout <commit-that-had-it> -- supabase/migrations/<filename>
   ```

3. **If the file was deleted intentionally as part of an explicit reversal:** file an ADR documenting the deletion, then manually delete the schema_versions row:

   ```sql
   DELETE FROM atelier_schema_versions WHERE filename = '<deleted-file>';
   ```

   Per the migration-system contract, the schema_versions table is the historical record; deletions are operator-driven and should be paired with an ADR explaining the reasoning.

---

## Recovering from a failed `--apply`

If `--apply` fails partway through a multi-migration run, the CLI exits 1 and prints which migration failed:

```
atelier upgrade: apply failed at 20260601000012_atelier_v1_1_<followup>.sql: <pg error>
Subsequent migrations were NOT attempted; partial state is recorded
in atelier_schema_versions for whatever DID succeed. Inspect the SQL,
fix the migration, and re-run `atelier upgrade --apply`.
```

The transactional guarantee means the failed migration left no partial state. Earlier migrations that already succeeded ARE recorded in `atelier_schema_versions` and will be reported as `up-to-date` on the next `--check`.

To recover:

1. Read the Postgres error in the CLI output. Typical causes: idempotency violation (e.g., `CREATE TABLE` without `IF NOT EXISTS`), a referenced table or column that doesn't exist yet, a constraint violation on backfill data.
2. Edit the migration file to fix the underlying SQL. The bar is "must be safely re-runnable" (idempotent per `docs/architecture/schema/migration-system.md`).
3. Re-run `atelier upgrade --apply`. The successful migrations from the previous run are skipped (already recorded); the failed migration plus any subsequent ones run again.

---

## CI gating

`atelier upgrade --check --json` is the recommended CI gate. Exit 0 means up-to-date; non-zero means action required. Pipe the JSON to your dashboard or fail the build:

```yaml
- name: Verify schema is up-to-date
  run: atelier upgrade --check --json
  env:
    POSTGRES_URL_NON_POOLING: ${{ secrets.STAGING_DATASTORE_URL }}
```

For staging vs production: each deploy has its own datastore; run the check against each. Cross-deploy atomic apply (apply same migration to staging + prod in lockstep) is an adopter-side decision involving your CI/CD pipeline; it is not built into `atelier upgrade`.

---

## What's NOT supported at v1

Filed for v1.x next-level (per ADR-005 + `docs/architecture/schema/migration-system.md`):

- **DOWN migrations / rollback.** Append-only at v1. To revert a migration: file an ADR, author a new migration that undoes the prior change, apply via `--apply`.
- **Auto-upgrade on init.** `atelier upgrade` is operator-driven; auto-upgrade is an unsafe default for a coordination substrate.
- **Cross-deploy atomic apply.** The CLI targets one datastore at a time. Lockstep apply across staging + production is your CI/CD pipeline's job.
- **Migration generation / scaffolding.** `atelier add-migration <slug>` is not built. Author migrations by hand following the `YYYYMMDDHHMMSS_<slug>.sql` filename convention + the idempotency contract.

---

## Cross-references

- `docs/architecture/schema/migration-system.md` — design contract (filename conventions, idempotency, three buckets, append-only discipline)
- ADR-005 — append-only discipline (decisions, extended to migrations)
- ADR-027 — Supabase Postgres reference implementation
- BRD-OPEN-QUESTIONS §29 — the open question this CLI resolves (PARTIAL → RESOLVED on E2 landing)
- `scripts/cli/commands/upgrade.ts` — CLI source
- `scripts/migration/runner.ts` — substrate runner
- `scripts/cli/__smoke__/upgrade.smoke.ts` — substrate-touching smoke
