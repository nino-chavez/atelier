-- Atelier M5 entry: revert to text-embedding-3-small (1536-dim)
--
-- Trigger: M5 calibration tested both text-embedding-3-small (1536) and
-- text-embedding-3-large (3072) against the multi-author 111-seed set.
-- 3-small produced P=0.683, R=0.626; 3-large produced P=0.648, R=0.634.
-- Per the M5-entry sequencing ("pick the one with measurably better lift"),
-- 3-small wins on the empirical comparison. This migration reverts the
-- table to vector(1536); the embed-runner re-embeds the corpus under the
-- selected model.
--
-- Pattern parity with migration 7: drop + recreate (no production users at
-- M5 entry; downtime is free per BRD-OPEN-QUESTIONS section 25 v1 path).
-- The HNSW index returns at this dimension (under the 2000-dim build
-- limit).
--
-- Trace:
--   BRD: Epic-6 (find_similar quality)
--   ADR-041 (provider/model swap path)
--   ADR-042 (hybrid retrieval)
--   BRD-OPEN-QUESTIONS section 25 (cross-dimension swap; second exercise of
--     the v1 path within 24 hours -- methodology-honesty signal that "event-
--     triggered" framing was effectively near-term-deferred. Section 25 is
--     updated alongside this migration to reflect the v1 resolution.)

DROP TABLE IF EXISTS embeddings CASCADE;

CREATE TABLE embeddings (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_kind              embedding_source_kind NOT NULL,
  source_ref               text NOT NULL,
  trace_ids                text[] NOT NULL DEFAULT '{}'::text[],
  content_text             text NOT NULL,
  content_hash             text NOT NULL,
  embedding                vector(1536) NOT NULL,
  embedding_model_version  text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, source_kind, source_ref)
);

COMMENT ON TABLE  embeddings                          IS 'ARCH 5.4 / ADR-006 / ADR-041 / ADR-042; M5-entry final dim choice vector(1536) after empirical comparison vs vector(3072)';
COMMENT ON COLUMN embeddings.source_ref               IS 'ARCH 5.4: repo path for file-backed sources or table+id reference for row-backed sources';
COMMENT ON COLUMN embeddings.trace_ids                IS 'ARCH 6.4.3: denormalized from source for trace-scoped query without join';
COMMENT ON COLUMN embeddings.content_text             IS 'Verbatim embedded text. Backs the BM25 + keyword fallback paths so vector and text paths see the same corpus';
COMMENT ON COLUMN embeddings.content_hash             IS 'SHA-256 of content_text. Embed pipeline skips re-embedding when hash unchanged';
COMMENT ON COLUMN embeddings.embedding_model_version  IS 'ARCH 6.4.2 model swappability. Format: "<provider>/<model>@<dim>" e.g. "openai/text-embedding-3-small@1536"';

CREATE TRIGGER embeddings_set_updated_at
  BEFORE UPDATE ON embeddings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- HNSW index (m=16, ef_construction=64; pgvector defaults). vector(1536) is
-- under the 2000-dim build limit so the index lands cleanly.
CREATE INDEX embeddings_embedding_hnsw_cosine
  ON embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX embeddings_project_kind_idx
  ON embeddings (project_id, source_kind);

CREATE INDEX embeddings_trace_ids_gin
  ON embeddings USING GIN (trace_ids);

CREATE INDEX embeddings_content_fts
  ON embeddings
  USING GIN (to_tsvector('english', content_text));

ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
