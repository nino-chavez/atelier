-- S07 Remediation: Migrate HNSW index to inner product and RRF CTE to websearch_to_tsquery
-- See docs/architecture/decisions/ADR-049-hybrid-retrieval-cte.md

DROP INDEX IF EXISTS embeddings_embedding_hnsw_cosine;

CREATE INDEX embeddings_embedding_hnsw_ip
    ON embeddings USING hnsw (embedding vector_ip_ops)
    WITH (m = 16, ef_construction = 64);

CREATE OR REPLACE FUNCTION atelier_find_similar(
  p_query_embedding  float8[],
  p_query_text       text,
  p_kind             text DEFAULT NULL,
  p_limit            int  DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_composer_id  uuid;
  v_project_id   uuid;
  v_results      jsonb;
  v_k_rrf        int := 50;     -- ADR-049 RRF k=50 (canonical Supabase)
  v_pool_size    int;
BEGIN
  SELECT cv.composer_id, cv.project_id INTO v_composer_id, v_project_id
    FROM atelier_resolve_viewer() cv;
  IF v_composer_id IS NULL THEN
    RAISE EXCEPTION 'no_composer' USING ERRCODE = '28000';
  END IF;

  IF p_query_embedding IS NULL OR cardinality(p_query_embedding) = 0 THEN
    RAISE EXCEPTION 'query_embedding_required' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 10;
  END IF;

  -- Use 4x limit on each side for fusion candidate pool (RRF is sensitive
  -- to recall on each path).
  v_pool_size := p_limit * 4;

  WITH
  vector_hits AS (
    SELECT e.id,
           row_number() OVER (ORDER BY e.embedding <#> p_query_embedding::vector) AS rank
      FROM embeddings e
     WHERE e.project_id = v_project_id
       AND (p_kind IS NULL OR e.source_kind::text = p_kind)
     ORDER BY e.embedding <#> p_query_embedding::vector
     LIMIT v_pool_size
  ),
  bm25_hits AS (
    SELECT e.id,
           row_number() OVER (
             ORDER BY ts_rank_cd(to_tsvector('english', e.content_text),
                                 websearch_to_tsquery('english', COALESCE(p_query_text, ''))) DESC
           ) AS rank
      FROM embeddings e
     WHERE e.project_id = v_project_id
       AND (p_kind IS NULL OR e.source_kind::text = p_kind)
       AND to_tsvector('english', e.content_text) @@ websearch_to_tsquery('english', COALESCE(p_query_text, ''))
     ORDER BY ts_rank_cd(to_tsvector('english', e.content_text),
                         websearch_to_tsquery('english', COALESCE(p_query_text, ''))) DESC
     LIMIT v_pool_size
  ),
  fused AS (
    SELECT id, sum(score) AS rrf_score
      FROM (
        SELECT id, 1.0 / (v_k_rrf + rank) AS score FROM vector_hits
        UNION ALL
        SELECT id, 1.0 / (v_k_rrf + rank) AS score FROM bm25_hits
      ) sub
     GROUP BY id
     ORDER BY sum(score) DESC
     LIMIT p_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',           e.id,
           'source_kind',  e.source_kind::text,
           'source_ref',   e.source_ref,
           'trace_ids',    e.trace_ids,
           'content',      e.content_text,
           'model',        e.embedding_model_version,
           'score',        f.rrf_score
         ) ORDER BY f.rrf_score DESC), '[]'::jsonb)
    INTO v_results
    FROM fused f JOIN embeddings e ON e.id = f.id;

  RETURN jsonb_build_object(
    'matches',       v_results,
    'project_id',    v_project_id,
    'k_rrf',         v_k_rrf,
    'pool_size',     v_pool_size
  );
END;
$$;

REVOKE ALL ON FUNCTION atelier_find_similar(float8[], text, text, int) FROM public;
GRANT EXECUTE ON FUNCTION atelier_find_similar(float8[], text, text, int) TO authenticated, service_role;

COMMENT ON FUNCTION atelier_find_similar(float8[], text, text, int) IS
  'Hybrid retrieval (vector kNN via inner product + Postgres BM25 fused via RRF k=50) per ADR-049. Required by the canonical rebuild brief. Embedding passed as float8[] for PostgREST wire compatibility.';
