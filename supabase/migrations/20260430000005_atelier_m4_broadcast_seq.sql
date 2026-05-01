-- Atelier M4: per-project broadcast event sequence
--
-- ARCH 6.8 requires monotonic-per-project event.id and per-channel event.seq
-- so subscribers can dedup at-least-once redeliveries (id) and detect gaps
-- on reconnect (seq). At v1 there is exactly one channel per project so id
-- and seq are equal -- both come from this single sequence. The interface
-- keeps them distinct in the envelope (per ARCH 6.8) so the per-guild
-- channel extension noted as a non-feature at v1 has a place to diverge
-- without a wire-format change.
--
-- Mirrors the pattern already established by allocate_fencing_token() and
-- allocate_adr_number() in migration 2 (atelier_m1_counters).

ALTER TABLE projects
  ADD COLUMN next_broadcast_seq bigint NOT NULL DEFAULT 1;

ALTER TABLE projects
  ADD CONSTRAINT projects_broadcast_seq_positive CHECK (next_broadcast_seq > 0);

CREATE OR REPLACE FUNCTION allocate_broadcast_seq(p_project_id uuid)
RETURNS bigint AS $$
DECLARE
  v_seq bigint;
BEGIN
  UPDATE projects
     SET next_broadcast_seq = next_broadcast_seq + 1
   WHERE id = p_project_id
   RETURNING next_broadcast_seq - 1 INTO v_seq;

  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'project % does not exist', p_project_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN v_seq;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN projects.next_broadcast_seq IS 'ARCH 6.8: monotonic-per-project broadcast event sequence; allocated via allocate_broadcast_seq(); used as both envelope.id and envelope.seq at v1 (single channel per project)';
