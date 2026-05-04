// Migration manifest helpers (E1 substrate).
//
// Pure file-system + crypto utilities the runner under runner.ts uses to
// reason about supabase/migrations/ on disk. Kept separate from runner.ts
// so the helpers are unit-testable without a live Postgres.
//
// Per ADR-029 (GCP-portability) these helpers use only Node stdlib + the
// already-vendored `pg` types -- no Supabase-specific code paths. The
// migration runner shape works against any Postgres-backed Atelier
// datastore.

import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** A migration file discovered on disk. */
export interface Migration {
  /** Filename (without directory): `YYYYMMDDHHMMSS_<slug>.sql`. */
  filename: string;
  /** Full absolute path on disk. */
  absolutePath: string;
  /** Timestamp prefix (e.g., "20260428000001"). */
  timestamp: string;
  /** Slug portion (e.g., "atelier_m1_schema"). */
  slug: string;
  /** Raw file content. */
  content: string;
  /** SHA-256 hex of `content`. */
  sha256: string;
}

/** Strict filename pattern: 14-digit timestamp + underscore + slug + `.sql`. */
const FILENAME_RE = /^(\d{14})_([a-z0-9][a-z0-9_]*)\.sql$/;

/**
 * Sentinel hash recorded by the bootstrap migration for its self-row.
 * The runner skips hash comparison for rows carrying this value because
 * the file's own SHA depends on its content (which contains the hash);
 * we resolve the chicken-and-egg by treating bootstrap rows as
 * "applied; hash deferred."
 */
export const BOOTSTRAP_HASH_SENTINEL = 'bootstrap';

/** Compute SHA-256 hex of UTF-8 string content. */
export function computeSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Parse a migration filename. Throws if the filename does not match
 * `YYYYMMDDHHMMSS_<slug>.sql`.
 */
export function parseMigrationFilename(filename: string): { timestamp: string; slug: string } {
  const m = FILENAME_RE.exec(filename);
  if (!m) {
    throw new Error(
      `migration filename "${filename}" does not match the required pattern ` +
        `YYYYMMDDHHMMSS_<slug>.sql (14-digit timestamp + underscore + ` +
        `lowercase slug + .sql extension)`,
    );
  }
  return { timestamp: m[1]!, slug: m[2]! };
}

/**
 * Read all migration files in `<repoRoot>/supabase/migrations/`, sort
 * lexicographically (the timestamp prefix yields chronological order),
 * and compute SHA-256 of each file's content.
 *
 * Throws on any file that does not match the filename pattern -- the
 * directory is canonical and untrusted entries indicate a bug.
 */
export async function readMigrationsDirectory(repoRoot: string): Promise<Migration[]> {
  const dir = join(repoRoot, 'supabase', 'migrations');
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    throw new Error(
      `unable to read migrations directory at ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const sqlFiles = entries.filter((f) => f.endsWith('.sql')).sort();
  const out: Migration[] = [];
  for (const filename of sqlFiles) {
    const { timestamp, slug } = parseMigrationFilename(filename);
    const absolutePath = join(dir, filename);
    const content = await readFile(absolutePath, 'utf8');
    out.push({
      filename,
      absolutePath,
      timestamp,
      slug,
      content,
      sha256: computeSha256(content),
    });
  }
  return out;
}
