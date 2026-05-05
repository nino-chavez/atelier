// Webhook idempotency ledger (S12).
//
// Records every received webhook in `webhook_deliveries` keyed on the
// provider's per-delivery ID (X-GitHub-Delivery, X-Figma-Webhook-Id, etc.).
// Returns `firstSeen=true` only on the first INSERT — duplicate deliveries
// (which providers retry aggressively under load and on transient 5xx)
// become a no-op via ON CONFLICT DO NOTHING.
//
// The `xmax` trick: Postgres returns `xmax=0` for newly inserted rows and
// non-zero (the locking transaction) for rows that already existed and
// were locked by ON CONFLICT. We expose this as `firstSeen` so route
// handlers can branch: process on first-seen, return 200 + idempotent
// no-op on duplicate.

import { Pool } from 'pg';

let cachedPool: Pool | null = null;

function getPool(): Pool {
  if (cachedPool) return cachedPool;
  const databaseUrl = process.env.POSTGRES_URL;
  if (!databaseUrl) {
    throw new Error(
      'POSTGRES_URL not set; webhook idempotency ledger cannot connect (ARCH 9.3)',
    );
  }
  cachedPool = new Pool({ connectionString: databaseUrl });
  return cachedPool;
}

export interface RecordDeliveryInput {
  /** Provider per-delivery ID (X-GitHub-Delivery, X-Figma-Webhook-Id, etc.). */
  deliveryId: string;
  /** Provider name: 'github' | 'figma' | 'supabase-auth'. Free text but constrained. */
  source: string;
  /** Provider event type (e.g. 'push', 'pull_request', 'FILE_COMMENT'). */
  eventType: string | null;
  /** Atelier project this delivery belongs to (if resolvable from payload). */
  projectId?: string | null;
}

export interface RecordDeliveryResult {
  /** True on first INSERT; false when the delivery_id already existed. */
  firstSeen: boolean;
}

export async function recordDelivery(input: RecordDeliveryInput): Promise<RecordDeliveryResult> {
  const pool = getPool();
  const result = await pool.query<{ first_seen: boolean }>(
    `
    INSERT INTO webhook_deliveries (delivery_id, source, event_type, project_id)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (delivery_id) DO NOTHING
    RETURNING (xmax = 0) AS first_seen
    `,
    [input.deliveryId, input.source, input.eventType, input.projectId ?? null],
  );
  return { firstSeen: result.rowCount === 1 && result.rows[0]?.first_seen === true };
}

export async function markDeliveryProcessed(
  deliveryId: string,
  outcome: string,
  errorMessage?: string,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    UPDATE webhook_deliveries
       SET processed_at = now(),
           outcome = $2,
           error_message = $3
     WHERE delivery_id = $1
    `,
    [deliveryId, outcome, errorMessage ?? null],
  );
}

// Test-only escape hatch — closes the cached pool so smokes can run
// against a known-clean state. Production paths should never call this.
export async function __closePoolForTesting(): Promise<void> {
  if (cachedPool) {
    await cachedPool.end();
    cachedPool = null;
  }
}
