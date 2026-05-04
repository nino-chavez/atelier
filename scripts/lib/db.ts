// Tiny pg helpers shared across runner.ts + alert-publisher.ts (et al).
//
// `tableExists` factored out of scripts/migration/runner.ts (loadAppliedMigrations)
// so scripts/observability/alert-publisher.ts can stop using a `.catch(() => ...)`
// pattern that silently swallows ALL query errors as "table missing." See
// the X1 audit Q1b + Q3c findings.
//
// Usage:
//   import { tableExists } from '../lib/db.ts';
//   if (await tableExists(client, 'public', 'triage_pending')) {
//     // safe to query
//   }
//
// Implementation note: information_schema.tables is the standard SQL
// portability path (works on Postgres + the GCP Cloud SQL Postgres path
// preserved by ADR-029). Avoids `pg_catalog`-specific helpers.

import type { Client, Pool, PoolClient } from 'pg';

type AnyClient = Client | Pool | PoolClient;

export async function tableExists(
  client: AnyClient,
  schemaName: string,
  tableName: string,
): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2
     ) AS exists`,
    [schemaName, tableName],
  );
  return rows[0]?.exists === true;
}
