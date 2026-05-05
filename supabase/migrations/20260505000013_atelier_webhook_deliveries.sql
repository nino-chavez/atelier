-- Atelier M8/S12: webhook deliveries table for HMAC-verified inbound
-- webhooks (GitHub, Figma at v1; Supabase Auth Hooks deferred to v1.x).
--
-- Per ARCH §6.2.2.1 (commit observation), §6.2.3 (merge confirmation
-- authoritative source), §6.4.2 (embedding-pipeline trigger),
-- §6.5.2 (Figma comment triage), §716 (`state=merged` requires either
-- webhook merge-observation OR an authorized reviewer's manual update).
-- Until M8 (this migration) the substrate had zero webhook receivers
-- and the merge-observation contract was unenforceable.
--
-- The table is the idempotency ledger: delivery_id is PRIMARY KEY, every
-- received webhook records into it before processing, and duplicate
-- deliveries (which providers retry aggressively under load) become a
-- no-op via INSERT ... ON CONFLICT DO NOTHING.
--
-- Trace:
--   ARCH §6.2.2.1, §6.2.3, §6.4.2, §6.5.2, §716, §902-905
--   M8 grounding-audit S12 finding (docs/architecture/audits/v1-comprehensive-grounding-audit.md)
--   §31 entry (resolved by this PR)

SET search_path = public;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id   text        PRIMARY KEY,
  source        text        NOT NULL,
  event_type    text,
  project_id    uuid        REFERENCES projects(id) ON DELETE SET NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  outcome       text,
  error_message text
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_source_received
  ON webhook_deliveries (source, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_project_received
  ON webhook_deliveries (project_id, received_at DESC)
  WHERE project_id IS NOT NULL;

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- service_role-only: webhook receivers run with the service-role-equivalent
-- connection (POSTGRES_URL → postgres superuser → BYPASSRLS). The explicit
-- policy makes the intent legible to auditors even though the connection
-- bypasses RLS structurally; if the receiver path is later refactored
-- onto a non-bypass role, this policy is the contract that makes the
-- service-role write path explicit.
CREATE POLICY "Service role only on webhook_deliveries"
  ON webhook_deliveries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE webhook_deliveries IS
  'Idempotency ledger for HMAC-verified inbound webhooks (S12). PK on delivery_id; every receiver records before processing.';
