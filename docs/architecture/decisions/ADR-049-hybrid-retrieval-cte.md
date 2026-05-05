---
id: ADR-049
trace_id: BRD:Epic-6
category: architecture
session: m8-grounding-audit-s07
composer: nino-chavez
timestamp: 2026-05-05T00:00:00Z
---

# Canonical Hybrid Retrieval via Single CTE

**Supersedes:** ADR-042 (app-side RRF fold + RRF k=60 + cosine `<=>` + custom OR-tokenizer). The hybrid retrieval ambition (vector + BM25 fused via RRF) carries forward; the implementation specifics are replaced per the M8 grounding audit's S07 finding. Frontmatter `reverses` field reserved for full reversals; this is a refinement-superseding relationship.

## Context
During the v1 Comprehensive Grounding Audit (S07), we identified that our `find_similar` implementation diverged from the canonical Supabase hybrid retrieval architecture. We were performing the Reciprocal Rank Fusion (RRF) in application-side TypeScript after making parallel `pg.Pool` queries for vector kNN and keyword search. Additionally, we were using the cosine distance operator `<=>` instead of the more performant inner-product `<#>` for normalized OpenAI embeddings, and using a custom tokenizer instead of `websearch_to_tsquery`.

## Decision
We are refactoring our hybrid retrieval pipeline to align with the canonical Supabase pattern:
1.  **Inner Product:** We will migrate the `hnsw` index from `vector_cosine_ops` to `vector_ip_ops` and use the `<#>` operator for similarity, as `text-embedding-3-small` outputs normalized vectors.
2.  **Single SQL CTE:** The RRF fold will happen entirely within PostgreSQL using a single CTE, eliminating the application-side `Map` and sorting.
3.  **websearch_to_tsquery:** We abandon the custom `buildOrTsQuery` tokenizer in favor of `websearch_to_tsquery` for full-text search.
4.  **RRF k=50:** We adopt the Supabase canonical RRF constant of 50, replacing our previously calibrated 60.

This decision supersedes ADR-042.

## Consequences
- Performance will improve due to reduced data transfer between the DB and the application.
- Indexing will be slightly faster and memory-efficient using `vector_ip_ops`.
- Existing queries in both the application script and the RPC function will use the single CTE shape.
