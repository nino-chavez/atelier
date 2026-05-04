# Migration system

**Audience question:** How does Atelier track which schema migrations have been applied to a given datastore, and how does the runner handle adopter-modified files?

**Primary tier served:** Tier 2 (Reference Implementation, the runner code) and Tier 3 (Specification — adopters reimplementing on a different stack follow this contract).

**Status:** v1.x partial — the substrate (this doc + `scripts/migration/runner.ts` + the `atelier_schema_versions` table) ships ahead of E2 (`atelier upgrade` CLI) which consumes it. Per BRD-OPEN-QUESTIONS section 29.

---

## Why a migration tracker

Atelier projects are scaffolded from this template via `atelier init` (D5). Adopters get a snapshot of `supabase/migrations/` at init time. As Atelier evolves (new ADRs add columns; new substrates land their own DDL), adopter projects and the upstream template diverge.

Without a tracker, adopters running `atelier upgrade` (E2) cannot tell which migrations from upstream have already been applied — re-applying a `CREATE TYPE` or `CREATE TABLE` would error on second run, and skipping them blindly would leave new substrate without its required schema.

The tracker is a single Postgres table that records each applied migration's filename, content hash, apply timestamp, operator identity, and the Atelier template version at apply time. The runner under `scripts/migration/` reads + writes this table as the source of truth.

---

## How it works

### Three-stage flow

1. **Discover** — `MigrationRunner.discoverMigrations()` reads `<repo-root>/supabase/migrations/`, parses filenames against the strict `YYYYMMDDHHMMSS_<slug>.sql` pattern, and computes a SHA-256 of each file's content.
2. **Diff** — `MigrationRunner.computeStatus()` joins the on-disk discovery against the rows in `atelier_schema_versions` and returns three buckets: `pending` (on disk but not applied), `modified` (applied but on-disk hash differs from recorded hash), `missing` (applied but not on disk).
3. **Apply** — `MigrationRunner.applyMigration(m)` runs the SQL inside a transaction and inserts the schema-versions row on success. The two-step happens atomically; an error during DDL rolls back both, leaving no orphaned tracking row for a partially-applied migration.

### The bootstrap row sentinel

The bootstrap migration (`20260504000010_atelier_schema_versions.sql`) creates the tracker table AND inserts baseline rows for every existing migration — including itself. The self-row's `content_sha256` cannot be the file's actual SHA because the file's content includes the SHA, creating a self-reference.

We resolve this by storing the literal string `bootstrap` in the self-row's `content_sha256`. The runner's `computeStatus()` treats rows whose hash equals `BOOTSTRAP_HASH_SENTINEL` as "applied; hash deferred" — they are excluded from `modified` detection regardless of what the on-disk hash says.

If an adopter later edits the bootstrap migration, the runner will not flag it as modified. This is by design: the bootstrap migration is itself canonical (per ADR-005 append-only) and adopters who modify it accept the consequences. If E2 needs to backfill the bootstrap row's hash on first apply of a subsequent migration, that is a v1.x enhancement — the substrate as shipped does not require it.

### Filename conventions

```
YYYYMMDDHHMMSS_<slug>.sql
```

- 14-digit timestamp prefix in UTC. Lexicographic ordering by filename equals chronological ordering.
- Slug: lowercase alphanumeric + underscores. Conventional shape: `atelier_m<milestone>_<purpose>` (e.g., `atelier_m5_embeddings`).
- `.sql` extension required.

Files that do not match this pattern cause `parseMigrationFilename` to throw — the migrations directory is canonical and untrusted entries indicate a bug.

### Idempotency requirement

Every migration MUST be idempotent. Operators may run `supabase db reset --local` repeatedly (the local-bootstrap default), and the bootstrap migration may be re-applied via `psql -f` for adopters using Path B in `docs/user/tutorials/first-deploy.md`. Specifically:

- Use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE TYPE ... AS ENUM` guarded by `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`, etc.
- Use `INSERT ... ON CONFLICT (<unique-key>) DO NOTHING` for seed data.
- Avoid `ALTER TABLE ... ADD COLUMN` without `IF NOT EXISTS` (Postgres 9.6+ supports it).
- Avoid `DROP TABLE` without `IF EXISTS`.

The migration system does not enforce idempotency — that is the migration author's responsibility, validated by smoke tests + manual operator practice.

### Append-only discipline

Per ADR-005 the runner does NOT support DOWN migrations at v1. Adopters who need to revert a migration:

1. File an ADR documenting the reversal decision.
2. Author a new migration that undoes the prior change (e.g., a column-drop migration).
3. Apply via the standard `atelier upgrade` flow (E2; or manual `psql` at v1).

This mirrors the broader Atelier pattern: decisions are append-only (ADR-030); reversals are new ADRs that reference prior ones via `reverses:` frontmatter.

A v1.x extension may add automatic rollback semantics if adopter signal warrants. Filed as v1.x next-level scope; not promised.

---

## Conflict semantics: pending / modified / missing

Each bucket represents a different adopter divergence pattern.

### Pending

A file exists on disk under `supabase/migrations/` but has no row in `atelier_schema_versions`. The intended path:

- **Upstream change adopter has not pulled yet.** `atelier upgrade` (E2) runs the runner, sees `pending`, applies the SQL.
- **Adopter authored a local migration.** Applies the same way; the runner does not distinguish upstream vs local-authored. Adopters who track a fork of Atelier merge upstream migrations into their tree alongside their own; the lex ordering by timestamp keeps everything chronologically consistent.

### Modified

A file exists on disk AND has an `atelier_schema_versions` row, but the on-disk SHA-256 differs from the recorded hash. The intended interpretation:

- **Adopter edited a migration Atelier shipped.** Defensible: e.g., an adopter changed the local template version annotation in a comment, or backported a fix to an earlier migration. The runner reports the divergence; E2 surfaces it as a warning during `atelier upgrade --check`.
- **Upstream re-issued the same migration.** Should never happen per ADR-005 (migrations are append-only; corrections ship as new migrations referencing prior ones via SQL comments). If observed, file as a bug against the upstream template.

The runner does NOT auto-resolve modified entries. The operator inspects the diff (`git log --diff <migration-file>`), decides whether to revert their local changes or keep them, and either:

- Re-applies the upstream version (the runner's `applyMigration` will INSERT a new row replacing the recorded hash via UPDATE — TODO for E2; v1 substrate leaves this to operator-driven manual reconciliation).
- Updates the recorded hash to match their local version (manual `UPDATE atelier_schema_versions ...`).

### Missing

A row in `atelier_schema_versions` references a filename that no longer exists on disk. The intended interpretation:

- **Operator deleted a migration file.** Almost always a bug; migrations are append-only. The runner reports it; the operator restores the file from git history.
- **Adopter is on an older branch.** Possible if the adopter's checkout is rolled back below the version that introduced the migration. Resolution: forward-merge the missing migration into their tree.

The runner does NOT delete `missing` rows. The schema_versions table is the historical record; deletions are operator-driven via `DELETE FROM atelier_schema_versions WHERE filename = '<n>'` with a paired ADR documenting the reason.

---

## Adopter guidance: keep upstream vs override locally

When an adopter forks Atelier and the upstream ships a new migration that conflicts with their local schema:

| Conflict shape | Recommendation |
|---|---|
| Upstream adds a column the adopter already added with the same name + type | Edit the local copy of the upstream migration to be a no-op (leave the file in place to preserve lex ordering). The next `atelier upgrade` will apply the no-op cleanly. |
| Upstream adds a column the adopter already added with a different type | File a local ADR documenting the type divergence; author a reconciliation migration that aligns. Skip the upstream migration manually (delete locally; record reasoning in adopter's ADR). The runner will report `missing` on next status check; operator marks it resolved. |
| Upstream removes a column the adopter still uses | Skip the upstream migration locally (same pattern). File adopter ADR. v1.x: `atelier upgrade --skip <filename>` may automate the skip path — out-of-scope at E1 substrate. |
| Upstream renames a column | Author local ADR explaining whether to follow or override. Edit the upstream migration locally (if following with adjustments) or skip (if overriding). |

The override pattern is documented in `docs/developer/upstreaming.md` for the broader fork relationship; this doc only covers the migration-tracking subset.

---

## Forward compatibility: what E2 (atelier upgrade) consumes

The E1 substrate (this doc + `scripts/migration/`) ships ahead of E2 (the CLI). E2 will compose:

```
$ atelier upgrade --check
  Checking migration status against datastore at $ATELIER_DATASTORE_URL
  10 migrations applied; 2 pending; 0 modified; 0 missing
  Pending:
    20260601000011_atelier_v1_1_<feature>.sql
    20260601000012_atelier_v1_1_<followup>.sql
  Run \`atelier upgrade --apply\` to apply.

$ atelier upgrade --apply
  Applying 20260601000011_atelier_v1_1_<feature>.sql...
  Applying 20260601000012_atelier_v1_1_<followup>.sql...
  2 migrations applied; recorded in atelier_schema_versions.
```

The CLI surface details (positional arguments, flag shapes, output formats) are E2's scope. The substrate's API contract (`MigrationRunner` class, the three buckets) is locked at E1 and will not change in incompatible ways without a new ADR.

### Out of scope at E1 (filed for v1.x next-level)

- **DOWN migrations / rollback.** Append-only at v1 per ADR-005. Rollback semantics deferred until adopter signal warrants.
- **Auto-merge of upstream migrations into adopter forks.** Manual reconciliation at v1 per the table above. AI-assisted merge is a candidate future feature filed under the upstreaming workflow (`docs/developer/upstreaming.md`); no commitment.
- **Cross-deploy schema replication.** The runner targets one datastore at a time. Adopters with staging + production deploys apply migrations to each independently. Atomic cross-deploy is an adopter-side decision involving their CI/CD pipeline; out of scope here.
- **Migration generation / scaffolding.** `atelier add-migration <slug>` (or similar) is not in E1 or E2 scope at v1. Operators author migrations by hand following the filename convention + idempotency contract.

---

## Cross-references

- ADR-005 — append-only discipline (decisions; extended here to migrations)
- ADR-027 — Supabase Postgres reference impl
- ADR-029 — GCP-portability constraint (the runner uses standard `pg`; no Supabase-specific helpers)
- ARCH 9.7 — template-upgrade flow (this doc is the migration-tracking primitive that flow consumes)
- BRD-OPEN-QUESTIONS section 29 — `atelier upgrade` scope-deferral; this PR partial-resolves by landing the substrate
- `scripts/migration/manifest.ts` — file-system + crypto helpers
- `scripts/migration/runner.ts` — `MigrationRunner` class
- `scripts/migration/__smoke__/runner.smoke.ts` — substrate-touching smoke
- `supabase/migrations/20260504000010_atelier_schema_versions.sql` — bootstrap migration
