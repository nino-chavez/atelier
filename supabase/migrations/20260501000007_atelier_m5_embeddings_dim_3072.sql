-- Atelier M5 entry: cross-dimension swap to text-embedding-3-large (3072-dim)
--
-- Trigger: M5 calibration showed text-embedding-3-small (1536-dim) + hybrid +
-- multi-author seed set scoring P=0.683, R=0.626 against ADR-006's 0.75/0.60
-- gate. The user's M5-entry sequencing called for trying text-embedding-3-large
-- before shipping below the gate. ADR-041 commits to the OpenAI-compatible
-- adapter; -large is the same adapter with config swap + corpus rebuild.
--
-- Per BRD-OPEN-QUESTIONS section 25 (cross-dimension migration): rebuild from
-- source under new dimension. No production users at M5 entry -> brief
-- read-only window during rebuild is free. v1.x considers multi-column or
-- halfvec for higher-availability deployments. This migration is the section
-- 25 v1 resolution: drop + recreate at the new dimension.
--
-- Trace:
--   BRD: Epic-6 (find_similar quality)
--   ADR-041 (provider/model swap path; adapter unchanged)
--   ADR-042 (hybrid retrieval; orthogonal to dimension)
--   BRD-OPEN-QUESTIONS section 25 (cross-dimension swap; v1 path resolved)
--
-- Out of scope (deferred to v1.x or later):
--   - Multi-column transition (embedding_v1 vector(1536), embedding_v2 vector(3072))
--   - halfvec compression
--   - Matryoshka-style truncation to a common dimension
--
-- IMPORTANT: This migration drops the existing embeddings table. The
-- corresponding embed-runner CLI invocation rebuilds the index from the
-- file-resident corpus under the new model. Adopters who run this in a
-- deployment with prior data should:
--   1. Capture the existing eval baseline.
--   2. Run this migration during a planned read-only window.
--   3. Re-run embed-runner against the live corpus.
--   4. Re-run eval; verify precision/recall are at-least-as-good before
--      reopening writes.

-- =========================================================================
-- Drop the prior 1536-dim table + dependents
-- =========================================================================

DROP TABLE IF EXISTS embeddings CASCADE;

-- The pgvector extension stays installed (other dim columns unaffected).
-- The embedding_source_kind enum stays defined; reused below.

-- =========================================================================
-- Recreate at vector(3072)
-- =========================================================================

CREATE TABLE embeddings (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_kind              embedding_source_kind NOT NULL,
  source_ref               text NOT NULL,
  trace_ids                text[] NOT NULL DEFAULT '{}'::text[],
  content_text             text NOT NULL,
  content_hash             text NOT NULL,
  embedding                vector(3072) NOT NULL,
  embedding_model_version  text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, source_kind, source_ref)
);

COMMENT ON TABLE  embeddings                          IS 'ARCH 5.4 / ADR-006 / ADR-041 / ADR-042; M5-entry dim swap to vector(3072) per BRD-OPEN-QUESTIONS section 25 v1 resolution';
COMMENT ON COLUMN embeddings.source_ref               IS 'ARCH 5.4: repo path for file-backed sources or table+id reference for row-backed sources';
COMMENT ON COLUMN embeddings.trace_ids                IS 'ARCH 6.4.3: denormalized from source for trace-scoped query without join';
COMMENT ON COLUMN embeddings.content_text             IS 'Verbatim embedded text. Backs the BM25 + keyword fallback paths so vector and text paths see the same corpus';
COMMENT ON COLUMN embeddings.content_hash             IS 'SHA-256 of content_text. Embed pipeline skips re-embedding when hash unchanged';
COMMENT ON COLUMN embeddings.embedding_model_version  IS 'ARCH 6.4.2 model swappability. Format: "<provider>/<model>@<dim>" e.g. "openai/text-embedding-3-large@3072"';

-- updated_at trigger
CREATE TRIGGER embeddings_set_updated_at
  BEFORE UPDATE ON embeddings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================================================================
-- Indexes
-- =========================================================================

-- pgvector HNSW index has a 2000-dimension limit at build time. For 3072-dim
-- columns we still index with HNSW but build it AFTER initial bulk load via
-- the embed-runner CLI -- the runner inserts rows without an index, then
-- (manually for now; CLI flag at M7) the index is created. At v1 corpus sizes
-- (hundreds to low-thousands of rows) sequential scan is acceptable as a
-- transition state; the HNSW build is fast once the rows exist.
--
-- 2026-05-01 update: pgvector 0.5+ supports HNSW on up to 2000 dims for the
-- INDEX (build limit), but query distance ops work fine on 3072 with sequential
-- scan. We CREATE the index conditionally at the dim boundary; below 2000 dim
-- we get HNSW, above we fall back to no vector index (sequential scan).
--
-- Concrete behavior: at 3072-dim we rely on the corpus being small enough
-- that sequential scan latency is acceptable. The eval harness validates
-- correctness regardless of index presence; query latency at adopter scale
-- is the M7 hardening concern. The condition below is a runtime check via a
-- DO block so future dim changes (back to 1536, or to halfvec) auto-pick
-- the right strategy.

DO $$
DECLARE
  v_dim integer;
BEGIN
  SELECT atttypmod INTO v_dim
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
   WHERE c.relname = 'embeddings' AND a.attname = 'embedding';
  IF v_dim > 0 AND v_dim <= 2000 THEN
    EXECUTE 'CREATE INDEX embeddings_embedding_hnsw_cosine ON embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)';
  ELSE
    -- HNSW skipped at this dimension; sequential scan is the transition state.
    -- Documented in ADR-042 + section 25 v1 resolution.
    RAISE NOTICE 'embeddings.embedding dim=% exceeds HNSW 2000-dim limit; index skipped (sequential scan acceptable at v1 corpus size)', v_dim;
  END IF;
END
$$;

-- Project + source-kind for denormalized listing.
CREATE INDEX embeddings_project_kind_idx
  ON embeddings (project_id, source_kind);

-- Trace-scoped queries (ARCH 6.4.3).
CREATE INDEX embeddings_trace_ids_gin
  ON embeddings USING GIN (trace_ids);

-- BM25 / keyword-fallback FTS index over content_text.
CREATE INDEX embeddings_content_fts
  ON embeddings
  USING GIN (to_tsvector('english', content_text));

-- =========================================================================
-- RLS scaffold
-- =========================================================================

ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
