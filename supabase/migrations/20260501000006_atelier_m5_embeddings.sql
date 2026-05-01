-- Atelier M5: vector index for find_similar
--
-- Lands the pgvector substrate ARCH 5.4 specifies and ARCH 6.4 / 6.4.1 / 6.4.2
-- consumes. ADR-006 (find_similar + eval harness + CI gate) and ADR-041
-- (OpenAI-compatible adapter, text-embedding-3-small @ 1536 dim) commit the
-- shape this migration realizes.
--
-- Trace:
--   BRD: Epic-6 (find_similar + eval harness)
--   ADR-006 (load-bearing: ships at v1 with eval harness + 75/60 CI gate)
--   ADR-041 (load-bearing: vector(1536) for text-embedding-3-small at v1)
--   ADR-029 (named-adapter pattern; this migration encodes vector dim choice
--            but the adapter shape itself stays in code per ADR-041)
--
-- Scope:
--   - pgvector extension enable (Supabase ships it in the standard image)
--   - embeddings table per ARCH 5.4 (project-scoped, source-kind taxonomy,
--     embedding_model_version for swappability per ARCH 6.4.2)
--   - HNSW index on embedding for kNN (m=16, ef_construction=64 defaults;
--     ARCH 5.4 + ADR-041 trade-off table indicate HNSW is the right fit at
--     atelier corpus sizes -- ivfflat targets very large corpora)
--   - tsvector + GIN index for the BM25-shaped keyword fallback per US-6.5
--     and ARCH 6.4 ("If vector index unavailable: fall back to keyword
--     search; response carries degraded=true")
--   - GIN index on trace_ids for trace-scoped queries per ARCH 6.4.3
--   - RLS scaffold (default-deny; service_role bypasses; M2 hardening pattern
--     from migration 1 carries forward)
--
-- Out of scope (future migrations):
--   - Cross-dimension model swap migration (BRD-OPEN-QUESTIONS section 25;
--     event-triggered when a second adapter at different dim is contributed)
--   - JWT-bound RLS policies for find_similar reads (M2 endpoint hardening
--     applies the same policy pattern it lands for the rest of the schema)

-- =========================================================================
-- Extension
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- =========================================================================
-- Enum: source taxonomy (ARCH 6.4.2 corpus composition)
-- =========================================================================
--
-- Mirrors the table in ARCH 6.4.2 verbatim. Adding a value later is non-
-- transactional in Postgres but additive (ALTER TYPE ADD VALUE), matching
-- the migration-2 pattern for contribution_state.

CREATE TYPE embedding_source_kind AS ENUM (
  'decision',
  'contribution',
  'brd_section',
  'prd_section',
  'research_artifact'
);

-- =========================================================================
-- Embeddings table (ARCH 5.4)
-- =========================================================================
--
-- One row per indexed corpus item. project_id scopes everything via RLS per
-- section 5.3. trace_ids is denormalized from the source row so trace-scope
-- queries (ARCH 6.4.3) do not need to join back to the source table at
-- query time. content_text holds the embedded payload (verbatim) so the
-- keyword fallback per US-6.5 works against the same corpus the embedder
-- saw -- one source of truth for "what was searchable when" + cheap to
-- rebuild on model swap.
--
-- (project_id, source_kind, source_ref) is unique: one embedding per source
-- item per dimension regime. embedding_model_version is metadata, not a
-- dedup key -- the swap procedure in ARCH 6.4.2 retires old-version rows
-- after a grace period rather than letting two co-exist for the same source.

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

COMMENT ON TABLE  embeddings                          IS 'ARCH 5.4 / ADR-006 / ADR-041; one row per indexed corpus item per ARCH 6.4.2';
COMMENT ON COLUMN embeddings.source_ref               IS 'ARCH 5.4: repo path for file-backed sources (decision, brd_section, prd_section, research_artifact) or table+id reference for row-backed sources (contribution=<uuid>)';
COMMENT ON COLUMN embeddings.trace_ids                IS 'ARCH 6.4.3: denormalized from source for trace-scoped query without join';
COMMENT ON COLUMN embeddings.content_text             IS 'Verbatim embedded text. Backs the keyword fallback (ARCH 6.4 + US-6.5) so vector and keyword paths see the same corpus';
COMMENT ON COLUMN embeddings.content_hash             IS 'SHA-256 of content_text. Embed pipeline (ARCH 6.4.2) skips re-embedding when hash unchanged';
COMMENT ON COLUMN embeddings.embedding_model_version  IS 'ARCH 6.4.2 model swappability. Format: "<provider>/<model>@<dim>" e.g. "openai/text-embedding-3-small@1536"';

-- updated_at trigger (mirrors contributions pattern from migration 1)
CREATE TRIGGER embeddings_set_updated_at
  BEFORE UPDATE ON embeddings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================================================================
-- Indexes
-- =========================================================================

-- HNSW vector index for kNN. Cosine distance is the default for normalized
-- embeddings produced by the OpenAI-compatible API; ADR-041 commits to
-- text-embedding-3-small which returns L2-normalized vectors, so cosine
-- and inner-product orderings agree. m / ef_construction are the pgvector
-- HNSW defaults -- tuneable on a follow-up if eval data shows recall problems.
CREATE INDEX embeddings_embedding_hnsw_cosine
  ON embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Project + source-kind for denormalized listing (e.g., admin: how many
-- contribution rows are indexed for project X).
CREATE INDEX embeddings_project_kind_idx
  ON embeddings (project_id, source_kind);

-- Trace-scoped queries (ARCH 6.4.3). Same GIN pattern as
-- contributions_trace_ids_gin / decisions_trace_ids_gin from migration 1.
CREATE INDEX embeddings_trace_ids_gin
  ON embeddings USING GIN (trace_ids);

-- Keyword fallback (ARCH 6.4 + US-6.5): tsvector index over content_text.
-- Computed at query time via to_tsvector('english', ...) rather than as a
-- generated column so the indexed expression is unambiguous and stable
-- under future model swaps that may change content normalization.
CREATE INDEX embeddings_content_fts
  ON embeddings
  USING GIN (to_tsvector('english', content_text));

-- =========================================================================
-- RLS scaffold (matches migration 1 pattern; M2 endpoint hardens later)
-- =========================================================================
--
-- M1's pattern: ENABLE RLS without policies = default-deny for non-bypass
-- roles; service_role bypasses. The find_similar handler at M5 entry runs
-- under service_role (same as the existing AtelierClient mutation paths)
-- and applies project_id scoping in SQL itself. M2 endpoint hardening
-- (composer-bound RLS via JWT sub) extends to this table at the same time
-- it extends to the rest of the schema -- per ARCH 5.3.

ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
