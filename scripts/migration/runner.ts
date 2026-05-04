// Migration runner (E1 substrate; precondition for E2 atelier upgrade).
//
// Per BRD-OPEN-QUESTIONS section 29. Tracks which migration files under
// supabase/migrations/ have been applied to a given Atelier datastore by
// reading + writing the atelier_schema_versions table introduced by the
// bootstrap migration `20260504000010_atelier_schema_versions.sql`.
//
// E1 ships SUBSTRATE only -- the library API. E2 (atelier upgrade CLI)
// composes these primitives into the operator-facing flow:
//   const r = new MigrationRunner({ databaseUrl, repoRoot, templateVersion, appliedBy });
//   const status = await r.computeStatus();
//   for (const m of status.pending) await r.applyMigration(m);
//
// Per ADR-005 (append-only): the runner does NOT support DOWN migrations
// at v1. Adopters who need to revert run an explicit destructive ADR per
// ARCH 9.7. v1.x may add rollback semantics if adopter signal warrants;
// out-of-scope here.
//
// Per ADR-029 (GCP-portability): uses standard `pg` for SQL execution.
// No Supabase RPC helpers, no @vercel/* imports. Works against any
// Postgres-backed Atelier datastore.
//
// X1 audit B4 + D2:
//   - Each migration's transaction sets a statement_timeout (default 600s)
//     so a slow / runaway migration cannot hold locks indefinitely. Tune
//     via `MigrationRunnerOptions.statementTimeoutMs`.
//   - Each transaction acquires `pg_advisory_xact_lock(hashtextextended(
//     'atelier-migration-runner', 0))` so two concurrent `atelier upgrade
//     --apply` runners can't both pass the pending check and race to apply
//     the same migration. The second runner blocks until the first commits;
//     when it resumes, the migration is already recorded in
//     atelier_schema_versions and the apply is a no-op (ON CONFLICT clause).
//
// Both surfaces are append-only-safe (per ADR-005); they only serialize
// existing apply behavior.

import { Client, type ClientConfig } from 'pg';
import {
  BOOTSTRAP_HASH_SENTINEL,
  type Migration,
  readMigrationsDirectory,
} from './manifest.ts';

export type { Migration } from './manifest.ts';
export { BOOTSTRAP_HASH_SENTINEL, computeSha256, parseMigrationFilename, readMigrationsDirectory } from './manifest.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A row in `atelier_schema_versions`. */
export interface AppliedMigration {
  filename: string;
  appliedAt: Date;
  contentSha256: string;
  appliedBy: string;
  atelierTemplateVersion: string;
}

/** A migration on disk whose SHA does not match the recorded SHA. */
export interface ModifiedMigration {
  filename: string;
  /** SHA of the file as it currently exists on disk. */
  localSha256: string;
  /** SHA recorded in atelier_schema_versions when the file was applied. */
  appliedSha256: string;
  appliedAt: Date;
}

/** Result of diffing on-disk migrations against applied migrations. */
export interface MigrationStatus {
  /** On disk + not yet recorded in atelier_schema_versions. */
  pending: Migration[];
  /** Recorded but the on-disk hash differs from the applied hash. */
  modified: ModifiedMigration[];
  /** Recorded but no longer present on disk (operator deleted; adopter divergence). */
  missing: AppliedMigration[];
}

export interface MigrationRunnerOptions {
  /** Postgres connection string. Defaults to local-bootstrap convention. */
  databaseUrl?: string;
  /** Repo root for migration discovery. Defaults to cwd. */
  repoRoot?: string;
  /**
   * Atelier template version to record on apply (e.g., "1.0", "1.1").
   * E2 reads this from `.atelier/config.yaml: project.template_version`;
   * E1 callers pass it explicitly.
   */
  templateVersion: string;
  /**
   * Identity recorded in atelier_schema_versions.applied_by. Composer
   * email when applied via `atelier upgrade`; "init" for supabase CLI
   * bootstrap; "manual" for direct psql invocation.
   * Default: "manual".
   */
  appliedBy?: string;
  /**
   * Optional pre-built `pg.Client`. When provided the runner does not
   * connect/disconnect automatically -- the caller owns the lifecycle.
   * Useful when composing the runner inside an existing transaction.
   */
  client?: Client;
  /**
   * Per-migration transaction `statement_timeout` (milliseconds). Default
   * 600_000 (10 minutes). A migration that exceeds this aborts and the
   * transaction rolls back, freeing locks. Set to 0 to disable (NOT
   * recommended on production datastores). X1 audit B4.
   */
  statementTimeoutMs?: number;
}

const DEFAULT_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DEFAULT_STATEMENT_TIMEOUT_MS = 600_000;
/** Stable lock id for parallel apply serialization. X1 audit D2. */
const MIGRATION_LOCK_KEY = 'atelier-migration-runner';

// ---------------------------------------------------------------------------
// MigrationRunner
// ---------------------------------------------------------------------------

export class MigrationRunner {
  private readonly databaseUrl: string;
  private readonly repoRoot: string;
  private readonly templateVersion: string;
  private readonly appliedBy: string;
  private readonly externalClient: Client | undefined;
  private readonly statementTimeoutMs: number;

  constructor(opts: MigrationRunnerOptions) {
    this.databaseUrl = opts.databaseUrl ?? process.env.POSTGRES_URL ?? DEFAULT_DB_URL;
    this.repoRoot = opts.repoRoot ?? process.cwd();
    this.templateVersion = opts.templateVersion;
    this.appliedBy = opts.appliedBy ?? 'manual';
    this.externalClient = opts.client;
    this.statementTimeoutMs =
      opts.statementTimeoutMs !== undefined ? opts.statementTimeoutMs : DEFAULT_STATEMENT_TIMEOUT_MS;
  }

  /**
   * Read + sort + hash the supabase/migrations/ directory. Pure file-system
   * read; does not connect to the database.
   */
  async discoverMigrations(): Promise<Migration[]> {
    return readMigrationsDirectory(this.repoRoot);
  }

  /**
   * Read all rows from atelier_schema_versions. Returns empty array when
   * the bootstrap migration has not yet been applied (table missing).
   */
  async loadAppliedMigrations(client?: Client): Promise<AppliedMigration[]> {
    return this.withClient(client, async (c) => {
      // Tolerate missing table: a fresh datastore that has not yet applied
      // any migration shows zero rows; we report that as "no rows applied"
      // not as an error. The runner's caller (E2) then applies all migrations
      // including the bootstrap one in lex order.
      const exists = await c.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'atelier_schema_versions'
         ) AS exists`,
      );
      if (!exists.rows[0]?.exists) return [];

      const { rows } = await c.query<{
        filename: string;
        applied_at: Date;
        content_sha256: string;
        applied_by: string;
        atelier_template_version: string;
      }>(
        `SELECT filename, applied_at, content_sha256, applied_by, atelier_template_version
           FROM atelier_schema_versions
           ORDER BY filename ASC`,
      );
      return rows.map((r) => ({
        filename: r.filename,
        appliedAt: r.applied_at,
        contentSha256: r.content_sha256,
        appliedBy: r.applied_by,
        atelierTemplateVersion: r.atelier_template_version,
      }));
    });
  }

  /**
   * Diff on-disk vs applied. Pure read operation; no mutations.
   *
   * Decision rules:
   *   - applied row whose content_sha256 is `BOOTSTRAP_HASH_SENTINEL` is
   *     treated as "applied; hash deferred" -- never reported as modified
   *     (the file's own hash is self-referential by construction; see
   *     manifest.ts::BOOTSTRAP_HASH_SENTINEL).
   *   - applied row whose recorded hash differs from on-disk hash -> modified.
   *   - applied row whose filename does not exist on disk -> missing.
   *   - on-disk file with no applied row -> pending.
   */
  async computeStatus(client?: Client): Promise<MigrationStatus> {
    const [discovered, applied] = await Promise.all([
      this.discoverMigrations(),
      this.loadAppliedMigrations(client),
    ]);
    const discoveredByName = new Map(discovered.map((m) => [m.filename, m]));
    const appliedByName = new Map(applied.map((a) => [a.filename, a]));

    const pending: Migration[] = [];
    const modified: ModifiedMigration[] = [];
    const missing: AppliedMigration[] = [];

    for (const m of discovered) {
      const a = appliedByName.get(m.filename);
      if (!a) {
        pending.push(m);
        continue;
      }
      if (a.contentSha256 === BOOTSTRAP_HASH_SENTINEL) {
        // Bootstrap row: skip hash comparison.
        continue;
      }
      if (a.contentSha256 !== m.sha256) {
        modified.push({
          filename: m.filename,
          localSha256: m.sha256,
          appliedSha256: a.contentSha256,
          appliedAt: a.appliedAt,
        });
      }
    }
    for (const a of applied) {
      if (!discoveredByName.has(a.filename)) {
        missing.push(a);
      }
    }
    return { pending, modified, missing };
  }

  /**
   * Apply a single migration: execute the SQL inside a transaction, then
   * INSERT the schema_versions row. Throws on any SQL error -- the
   * transaction rolls back so partial application does not leave the
   * schema in a half-state.
   *
   * Idempotency is the migration AUTHOR's responsibility (per ADR-005
   * append-only + the migration-system.md doc's contract). The runner
   * does not retry; on error, the operator inspects + fixes manually.
   *
   * The `appliedBy` and `templateVersion` arguments override the runner's
   * defaults for this single apply (e.g., to record a different operator
   * email per migration). Most callers omit them and use the constructor
   * defaults.
   */
  async applyMigration(
    migration: Migration,
    client?: Client,
    overrides?: { appliedBy?: string; templateVersion?: string },
  ): Promise<void> {
    const appliedBy = overrides?.appliedBy ?? this.appliedBy;
    const templateVersion = overrides?.templateVersion ?? this.templateVersion;
    await this.withClient(client, async (c) => {
      await c.query('BEGIN');
      try {
        // X1 audit D2: serialize parallel `atelier upgrade --apply` runners
        // against this datastore. The second runner blocks until the first
        // commits; when it resumes the ON CONFLICT clause below makes the
        // apply a no-op for any migration the first runner already recorded.
        await c.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [MIGRATION_LOCK_KEY],
        );
        // X1 audit B4: bound how long a single migration can hold locks.
        // Skipped when statementTimeoutMs is 0 so adopters who deliberately
        // run multi-hour migrations can opt out.
        if (this.statementTimeoutMs > 0) {
          await c.query(`SET LOCAL statement_timeout = ${this.statementTimeoutMs}`);
        }
        // Re-read applied state inside the lock; another runner may have
        // applied this migration while we were blocked. Skip the SQL but
        // still commit so the lock releases cleanly.
        const already = await c.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM atelier_schema_versions WHERE filename = $1
           ) AS exists`,
          [migration.filename],
        );
        if (!already.rows[0]?.exists) {
          await c.query(migration.content);
        }
        // Record. ON CONFLICT DO NOTHING tolerates the case where this
        // migration was applied via supabase CLI before the runner was
        // wired -- the bootstrap row already exists; the SQL above was
        // idempotent (CREATE TABLE IF NOT EXISTS) so the apply is a
        // no-op and we leave the existing row intact.
        await c.query(
          `INSERT INTO atelier_schema_versions
             (filename, content_sha256, applied_by, atelier_template_version)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (filename) DO NOTHING`,
          [migration.filename, migration.sha256, appliedBy, templateVersion],
        );
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        throw err;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Internal client management
  // -------------------------------------------------------------------------

  private async withClient<T>(
    override: Client | undefined,
    fn: (c: Client) => Promise<T>,
  ): Promise<T> {
    if (override) return fn(override);
    if (this.externalClient) return fn(this.externalClient);
    const cfg: ClientConfig = { connectionString: this.databaseUrl };
    const c = new Client(cfg);
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }
}
