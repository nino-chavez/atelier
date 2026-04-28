-- Atelier M1: per-project monotonic counters
--
-- Required by the internal write library (scripts/sync/lib/write.ts):
--   - next_fencing_token: monotonic-per-project allocation for locks.fencing_token
--                         per ARCH 5.1 + ARCH 7.4
--   - next_adr_number:    monotonic-per-project allocation for ADR-NNN ids
--                         per ARCH 6.3.1 (spec calls for a dedicated adr_sequence
--                         table; we collapse onto projects to avoid an extra row
--                         per project for a single counter -- semantically equivalent)
--
-- Both columns are incremented atomically via UPDATE ... RETURNING. Gaps in the
-- ADR sequence are acceptable per ARCH 6.3.1 ("that NNN is 'spent'; the next
-- decision uses NNN+1"). The fencing-token sequence has the same property.

ALTER TABLE projects
  ADD COLUMN next_fencing_token  bigint  NOT NULL DEFAULT 1,
  ADD COLUMN next_adr_number     integer NOT NULL DEFAULT 1;

ALTER TABLE projects
  ADD CONSTRAINT projects_counters_positive CHECK (
    next_fencing_token > 0 AND next_adr_number > 0
  );

-- Helper functions: atomic-increment-and-return.
--
-- Both functions perform a single UPDATE with RETURNING the pre-increment
-- value. The row-level lock acquired by UPDATE serializes concurrent callers,
-- guaranteeing each caller receives a distinct value.

CREATE OR REPLACE FUNCTION allocate_fencing_token(p_project_id uuid)
RETURNS bigint AS $$
DECLARE
  v_token bigint;
BEGIN
  UPDATE projects
     SET next_fencing_token = next_fencing_token + 1
   WHERE id = p_project_id
   RETURNING next_fencing_token - 1 INTO v_token;

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'project % does not exist', p_project_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN v_token;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION allocate_adr_number(p_project_id uuid)
RETURNS integer AS $$
DECLARE
  v_number integer;
BEGIN
  UPDATE projects
     SET next_adr_number = next_adr_number + 1
   WHERE id = p_project_id
   RETURNING next_adr_number - 1 INTO v_number;

  IF v_number IS NULL THEN
    RAISE EXCEPTION 'project % does not exist', p_project_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN v_number;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN projects.next_fencing_token IS 'ARCH 5.1 / 7.4: monotonic-per-project; allocated via allocate_fencing_token()';
COMMENT ON COLUMN projects.next_adr_number    IS 'ARCH 6.3.1: monotonic-per-project ADR-NNN counter; allocated via allocate_adr_number(); gaps are acceptable';
