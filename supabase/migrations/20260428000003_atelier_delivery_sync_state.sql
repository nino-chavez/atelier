-- Atelier M1 step 4.iv: delivery_sync_state table
--
-- Persistent contribution<->external mapping per delivery adapter.
-- Surfaced by step 4.iv when the GitHub adapter actually exercises the
-- mapping path -- M1 step 4.iii used a telemetry-derived lookup as a
-- deliberate seam (see scripts/sync/mirror-delivery.ts).
--
-- The table is keyed by (contribution_id, adapter) so a single
-- contribution may sync to multiple adapters (e.g., GitHub Issues +
-- Linear) without one overwriting the other. Each adapter sees its own
-- row; reads are project-scoped per ARCH 5.3.

CREATE TABLE delivery_sync_state (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contribution_id uuid         NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  adapter         text         NOT NULL,                                  -- e.g., 'github', 'linear', 'jira', 'noop'
  external_id     text         NOT NULL,
  external_url    text         NOT NULL,
  external_state  text,
  last_synced_at  timestamptz  NOT NULL DEFAULT now(),
  metadata        jsonb        NOT NULL DEFAULT '{}'::jsonb,              -- adapter-specific fields (assignee, sprint, points, etc.)
  CONSTRAINT delivery_sync_state_unique UNIQUE (contribution_id, adapter)
);

CREATE INDEX delivery_sync_state_project_idx  ON delivery_sync_state (project_id);
CREATE INDEX delivery_sync_state_external_idx ON delivery_sync_state (adapter, external_id);

-- Touch updated_at-style behavior on UPDATE so callers can use
-- INSERT ... ON CONFLICT (contribution_id, adapter) DO UPDATE without
-- having to set last_synced_at explicitly.
CREATE OR REPLACE FUNCTION delivery_sync_state_touch() RETURNS trigger AS $$
BEGIN
  NEW.last_synced_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER delivery_sync_state_touch_on_update
  BEFORE UPDATE ON delivery_sync_state
  FOR EACH ROW EXECUTE FUNCTION delivery_sync_state_touch();

ALTER TABLE delivery_sync_state ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE delivery_sync_state IS 'M1 step 4.iv; persistent contribution<->external mapping per delivery adapter';
