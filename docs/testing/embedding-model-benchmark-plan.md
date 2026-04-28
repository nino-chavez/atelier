# Embedding model benchmark plan (D24 resolution)

**Status:** Design draft 2026-04-28. The plan itself can land now; the benchmark runs require the find_similar pipeline (M5 implementation work) plus a constructed seed eval set. Resolves `BRD-OPEN-QUESTIONS.md` section 3 and the D24 decision; lands as a new ADR per BUILD-SEQUENCE M7.

**Audience:** whoever runs the benchmark (Nino, an analyst, or a contractor with IR/ML background). The plan is detailed enough to brief without further design.

---

## 1. Purpose and gating

The find_similar capability (per ADR-006, BRD Epic 6, ARCH section 6.4) ships at M5. Its precision and recall depend on the embedding model's representation of Atelier's content classes (decisions, contributions, BRD/PRD sections, research artifacts).

Per BUILD-SEQUENCE section 7 question 3, **D24 (embedding model default) must resolve before M5 begins**. Recommended resolution window: M3 or M4. The ADR-006 CI gate is `>=75% precision at >=60% recall` -- the chosen model must clear the gate against the seed eval set.

This plan exists so M5 begins with a chosen model and a documented selection rationale rather than figuring it out under implementation pressure.

---

## 2. Scope

**In scope:**
- Shortlist of candidate models (5-7 covering the tradeoff space)
- Seed eval set design and minimum size
- Evaluation methodology and tooling
- Decision criteria including tie-breakers
- ADR draft template for capturing the resolution

**Out of scope:**
- Actually running the benchmarks (requires the M5 find_similar pipeline or a standalone benchmarking harness)
- Constructing the seed eval set (manual labeling work; ~1-2 person-weeks)
- Production deployment of the chosen model
- Model retraining or fine-tuning (out of v1 scope; teams use off-the-shelf models)

---

## 3. What can be done now (no implementation dependency)

These four pieces are desk work and can land before M3:

1. **Candidate shortlist** -- pick 5-7 models worth benchmarking from the broader landscape. See section 4 below.
2. **Seed eval set structure** -- define what categories of queries, what labeling schema, where to draw source content from. See section 5 below; the actual queries can be drafted now even without the pipeline to score them.
3. **Evaluation methodology** -- which metrics, at what K values, with what tooling. Standard IR practice; pick the variant. See section 6.
4. **Decision criteria** -- how to pick a winner from the benchmark output. See section 7.

Once M5's find_similar pipeline exists (or a standalone benchmark harness is written, which is faster), the benchmark itself takes ~1-2 days for 5-7 models.

---

## 4. Candidate model shortlist

Pick from these tradeoff axes: external-API vs self-hostable, dimension size (affects index storage), embedding quality on technical-document content (Atelier's corpus is mostly ADRs, design docs, BRD stories -- structured English with technical jargon).

| Candidate | Type | Dim | Strengths | Tradeoffs |
|---|---|---|---|---|
| **OpenAI text-embedding-3-small** | external API | 1536 | Strong baseline; ubiquitous; fast | Data-egress concern for regulated teams; per-call cost; vendor dependency |
| **OpenAI text-embedding-3-large** | external API | 3072 | Higher quality than -small | Larger storage; higher cost; same egress concerns |
| **Cohere embed-english-v3.0** | external API | 1024 | Often strongest on retrieval benchmarks; supports input_type hints (search_document vs search_query) which can help precision | Vendor dependency; per-call cost |
| **BAAI/bge-large-en-v1.5** | self-hostable | 1024 | Strong open model; widely deployed; documented MTEB scores | Requires hosting (CPU acceptable but slow; GPU much better); somewhat older (2023) |
| **mixedbread-ai/mxbai-embed-large-v1** | self-hostable | 1024 | Modern (2024); strong MTEB performance; matryoshka representation (truncate to smaller dims with controlled quality loss) | Newer means less production track record |
| **nomic-embed-text-v1.5** | self-hostable | 768 (matryoshka to 64-768) | Modern; flexible dimensions; permissive license; reasonable hosting requirements | Smaller native dim than the 1024-class options |
| **intfloat/e5-large-v2** | self-hostable | 1024 | Well-validated; widely used; documented behavior on technical content | 2023 vintage; newer alternatives may outperform |

The shortlist intentionally includes both API and self-hostable candidates. Per the existing recommendation in BRD-OPEN-QUESTIONS section 3 ("Default to a self-hostable model for regulated-team viability"), the API options are baselines to confirm self-hostable models are competitive.

**Models intentionally excluded:**
- Sentence-transformer models older than 2023 (likely outperformed by 2024 options)
- Massively-large models (>4096 dim) that bloat the index without proportional retrieval gains for this corpus size
- Multilingual-only models (Atelier's bundled content is English; teams using other languages can swap via the configured model)

If the benchmark reveals all candidates clear the ADR-006 gate by a wide margin, narrowing further by cost/hosting wins. If they cluster near the gate, additional candidates may be needed.

---

## 5. Seed eval set structure

The eval set is the ground truth against which the benchmark scores. It must be drawn from Atelier's actual content (this repo's ADRs, BRD, walks, research artifacts) so the scores reflect performance on the real corpus, not generic IR benchmarks.

### Format

Each eval case has the shape:

```
{
  query_id: "<unique>",
  query_text: "<natural-language description of work intent>",
  expected_matches: [
    { source_kind: "decision" | "contribution" | "brd_section" | "research_artifact",
      source_ref: "<ADR-NNN | US-X.Y | research/X.md>",
      relevance: 1.0 to 0.0 }
  ],
  expected_non_matches: [
    { source_kind: ..., source_ref: ... }
  ],
  category: "duplication-detection" | "context-retrieval" | "cross-cutting" | "adversarial",
  notes: "<why these expected/non-expected matches>"
}
```

### Categories and minimum counts

| Category | Purpose | Minimum count | Source |
|---|---|---|---|
| **duplication-detection** | Catches the find_similar core use case: a new contribution describes work substantially similar to an existing ADR or contribution | 30 cases | Drawn from the actual ADR pairs that share design intent (e.g., ADR-027/ADR-028 pair on reference stack) |
| **context-retrieval** | A query for "what's relevant to topic X" should surface the right ADRs/sections | 30 cases | Drawn from BRD epics + their related ADRs |
| **cross-cutting** | Multi-trace-id work that should match decisions across multiple epics | 15 cases | Drawn from ADRs that carry multiple trace_ids (per ADR-021) |
| **adversarial** | Queries that LOOK related but should NOT match (vocabulary overlap, structurally similar but semantically different) | 25 cases | Manually constructed: pairs that share keywords but discuss different concerns |

Total minimum: **100 cases**. Sweet spot is 200-300 for stable precision/recall numbers across N candidate models.

### Labeling process

1. Author drafts query + expected matches + expected non-matches.
2. Second labeler reviews independently; disagreements resolved by discussion.
3. Each case includes a "why" note for future audit.
4. Eval set commits to `prototype/eval/find_similar/seed-set.jsonl` (per `.atelier/config.yaml: find_similar.eval_set_path`) with author + labeler frontmatter.

**Effort:** ~1 person-week to draft 100 cases + ~3 person-days for second-labeler review = ~1.5 person-weeks total.

### Bias mitigation

- Don't draw all queries from one section of the corpus (e.g., all from ADRs); spread across content classes
- Include cases where the "obvious match by keyword" is wrong (catches bag-of-words behavior masquerading as semantic understanding)
- Include cases where the right answer involves multiple trace IDs (per ADR-021 multi-trace support)
- Re-label periodically as the corpus grows (eval-set drift is real)

---

## 6. Evaluation methodology

### Metrics

| Metric | Why | Reporting |
|---|---|---|
| **Precision@K** at K = 5, 10, 20 | The find_similar response surfaces top-k; precision at the surfaced level is what matters in practice | Per K per category per model |
| **Recall@K** at K = 5, 10, 20 | Relevant items the model misses are duplication leaks; recall matters for the core use case | Per K per category per model |
| **MRR (Mean Reciprocal Rank)** | Captures "where in the ranked list does the first relevant result appear" -- single-number summary | Per category per model |
| **NDCG@10** | Penalizes ranking errors at the top of results more than at the bottom; aligns with how UIs surface results | Per category per model |
| **Latency p95** | Including embedding generation + kNN search; matters for responsiveness | Per model |
| **Cost per 1000 queries** | API calls + storage + (for self-hostable) compute | Per model, normalized |

### ADR-006 gate

The gate is **>=75% precision at >=60% recall**. Operationalize as: at K=10, precision >= 0.75 AND recall >= 0.60 across the full eval set.

A model that clears the gate on the full set but fails on a specific category (e.g., adversarial) is recorded with the per-category breakdown so the team understands the tradeoff.

### Tooling

Pre-M5: a standalone Python or Node script that:
1. Loads the seed eval set
2. For each candidate model, embeds query + corpus
3. Runs kNN against the embedded corpus (e.g., via `faiss` or `numpy` for the small scale)
4. Computes the metrics
5. Outputs CSV + a summary markdown report

Post-M5: this becomes part of `atelier eval find_similar` (US-11.8) which exercises the live find_similar pipeline.

The standalone tool is faster to write (~2 days) than waiting for M5 and lets D24 resolve in the M3/M4 window per BUILD-SEQUENCE recommendation.

---

## 7. Decision criteria

When the benchmark numbers are in, pick the default by this priority:

1. **Clear the ADR-006 gate.** Any model failing the gate is rejected; if all fail, escalate to seed-eval-set re-design or model-shortlist expansion.
2. **Among gate-clearers, prefer self-hostable** per the BRD-OPEN-QUESTIONS section 3 recommendation (regulated-team viability is a real constraint for adoption).
3. **Among self-hostable gate-clearers, prefer the highest precision at K=10** -- duplication-detection is the core use case and false positives there are most costly.
4. **Tie-break by hosting cost.** Smaller dimension = smaller index = lower hosting bill.
5. **Tie-break by license clarity.** Apache 2.0 / MIT preferred; non-commercial-only licenses excluded entirely.
6. **Tie-break by maintainer health.** Active commits in last 6 months; documented release cadence.

**Document the API alternative** in the resolution ADR as the recommended swap for teams whose constraints flip (e.g., teams without infra to host, accepting the egress tradeoff).

---

## 8. Deliverables

The benchmark run produces:

1. **Numbers report** -- `prototype/eval/find_similar/benchmark-<date>.md` with per-model per-category metrics, the gate-pass/fail call, the recommended default, the recommended API alternative.
2. **Seed eval set commit** -- `prototype/eval/find_similar/seed-set.jsonl` with the 100+ labeled cases.
3. **ADR resolving D24** -- `docs/architecture/decisions/ADR-NNN-embedding-model-default.md` with the chosen default, the rationale linked to numbers, the API alternative as a documented swap, the swappability mechanics (already specified in ARCH 6.4.2).
4. **Benchmark tooling** -- the standalone script committed to `prototype/eval/find_similar/run-benchmark.mjs` (or equivalent) so future model evaluations are reproducible.

---

## 9. Estimated effort

| Task | Effort | Dependency |
|---|---|---|
| Seed eval set authoring (100 cases, single author) | ~5 person-days | None; can start immediately |
| Second-labeler review + reconciliation | ~3 person-days | Seed set drafted |
| Standalone benchmark tooling | ~2 person-days | Seed set finalized |
| Benchmark runs across 7 candidates | ~1-2 days (mostly compute time + setup) | Tooling + seed set + model access |
| Analysis + ADR drafting | ~1-2 person-days | Numbers report |

**Total elapsed: ~2 calendar weeks** if a single person does everything in series. Parallelizable to ~1 week with two people (eval-set author + tooling author working in parallel).

**Cost (for the benchmark itself):** primarily API costs for the external models. Estimate $100-300 total depending on candidates and corpus size at benchmark time.

---

## 10. Pre-conditions to start

The benchmark can begin as soon as these exist:

- Seed eval set (the bulk of the upfront work)
- Standalone benchmark harness OR M5 find_similar pipeline
- API keys / hosted-model deployments for the candidates
- Decision on whether to include any non-shortlisted models (revisit at start time -- model landscape moves fast; the 2026-04-28 shortlist may be stale by the actual run date)

Nothing else gates start. Recommend kicking off seed-set authoring at M2 exit so the benchmark itself can run during M3/M4 and an ADR lands before M5 begins.

---

## 11. Open questions about the plan itself

These are plan-design questions distinct from the embedding-model question:

- **Should the eval set live in the repo or external?** Currently planned in-repo at `prototype/eval/find_similar/`. Pro: transparent, version-controlled. Con: bloats the repo if the set grows large (>500 cases). Recommendation: in-repo until 500 cases, then evaluate compression or external storage.
- **Should the benchmark re-run periodically?** Models improve; today's winner may not be tomorrow's. Recommend: re-run annually + on any major model release. Adds operational cost; document expectation.
- **Should the API alternative be benchmarked at every release?** If teams swap to the API path, they want current data. Same answer: annual re-benchmark + on-release.
- **Multilingual considerations.** The seed set is English. Atelier's bundled content is English, but adopting teams may write in other languages. The chosen model should be checked against a small multilingual sample even if the main eval is English. Adds ~1 day to the benchmark.

---

## 12. Cross-references

- BRD-OPEN-QUESTIONS section 3 -- the open question this plan addresses
- ADR-006 -- find_similar at v1 with eval harness and CI gate; defines the >=75%/>=60% precision/recall threshold
- ARCH section 6.4.x -- find_similar specification (signature, thresholds, corpus, lifecycle, scoping)
- ARCH section 5.4 -- vector index data shape including embedding_model_version column for swappability
- BUILD-SEQUENCE section 7 question 3 -- D24 must resolve before M5 begins
- `.atelier/config.yaml: find_similar.embedding_model` -- the config knob that consumes the chosen default
