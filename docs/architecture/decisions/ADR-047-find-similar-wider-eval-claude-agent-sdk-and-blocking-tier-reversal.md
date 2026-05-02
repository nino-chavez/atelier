---
id: ADR-047
trace_id: BRD:Epic-6
category: architecture
session: m7-track-2-section-26-wider-eval
composer: nino-chavez
timestamp: 2026-05-02T00:00:00Z
reverses: ADR-043
---

# find_similar wider-eval result: claude-agent-sdk corpus misses advisory tier; ADR-043's blocking-tier framing reversed; advisory's universality demoted to "Atelier-shape-corpus dependent"

**Summary.** The §26 wider eval against the claude-agent-sdk public docs corpus (44 chunked items; 117 deduped seeds via the same hand + 3-lens method that produced M5's 111-seed lift) measured **P=0.5540 / R=0.5423** on the production hybrid retrieval path (vector kNN + BM25 via RRF k=60, text-embedding-3-small 1536-dim per ADR-041). The result is **below ADR-043's advisory tier** (needed P≥0.60 AND R≥0.60) and far below the blocking tier (P≥0.85 AND R≥0.70). Per the activation rule's 0-of-2 outcome (M5 cleared advisory but missed blocking; claude-agent-sdk missed both): **the blocking-tier framing in ADR-043 is reversed** — the v1 destination is advisory only, not a way station to a blocking-tier future. The new finding the activation rule did not anticipate: **advisory tier itself is corpus-dependent.** Atelier-internal corpus clears it (M5: P=0.672, R=0.626); claude-agent-sdk doesn't. The ADR documents both findings, demotes ADR-043's blocking-tier framing per the rule, and amends the advisory-tier portability claim.

**Rationale.**

§26 was filed as the "wider eval" follow-up after M5 mitigated within-corpus seed-author bias (multi-author lens-flavored seed expansion lifted M5 recall from 0.471 to 0.626 / +15.5pp on the Atelier-internal corpus). The remaining open question: does advisory tier hold across corpora? Does blocking become reachable on smaller-but-better-discriminated corpora?

**Method (mirrors M5; ADR-042 + ADR-043 paths).**

- Corpus: claude-agent-sdk public docs — 31 pages from `code.claude.com/docs/en/agent-sdk/*.md` plus 2 GitHub READMEs (python + typescript). Two oversized reference docs (`python.md` 145KB, `typescript.md` 127KB) chunked by `## ` then `### ` headings into 7 + 5 sub-files (corpus root: `atelier/eval/find_similar/external-corpora/claude-agent-sdk/`). Final embedded count: 43 corpus items + the README that points at the corpus.
- Seeds: 27 hand-authored baseline (Claude Opus 4.7) + 30 each from 3 parallel lens-flavored agents (analyst, dev, PM per ADR-017) = 117 pre-dedup. Same Jaccard >= 0.7 dedup as M5 produced 0 drops (the 4 sources authored truly distinct angles).
- Retrieval: hybrid (vector kNN + Postgres BM25 via RRF k=60) via the production `findSimilar()` code path. Thresholds default 0.032 / weak 0.030, top_k_per_band 5 (per `.atelier/config.yaml` ADR-042 calibration).
- Model: text-embedding-3-small (1536-dim) per ADR-041. Per the user's 2026-05-02 §26 brief: M5 confirmed 3-large didn't help on Atelier corpus; retest unnecessary unless curious. Skipped the comparative run.

**Result: P=0.5540 / R=0.5423.**

```
seeds_total: 117
embedded_items: 43 (after chunking)
aggregate: tp=77 fp=62 fn=65
P=0.5540  R=0.5423
ADR-043 advisory (P>=0.60 AND R>=0.60): NOT CLEAR
ADR-043 blocking (P>=0.85 AND R>=0.70): NOT CLEAR
```

**Failure-mode diagnostic.** Of 117 seeds: 79% have a single canonical expected match (corpus topology is one-concept-per-doc with conceptual cross-links rather than overlap). 21 seeds returned zero precision (retrieval surfaced semantically-adjacent docs in the same domain cluster — e.g., "slash commands" query → `subagents.md`; "hooks" query → `custom-tools.md` + `agent-loop.md`; "skills" query → `claude-code-features.md`; "plugins" query → `mcp.md`). 41 seeds returned zero recall (the expected file didn't surface in the top-K primary band). The pattern is **lateral domain-cluster confusion** — exactly what a cross-encoder reranker is designed to discriminate (re-scoring top-K candidates with finer-grained query-document interaction). The hybrid retrieval baseline cannot disambiguate at this corpus's per-doc topic granularity.

**Activation rule outcome (per Nino's 2026-05-02 brief + ADR-043).**

The brief defined:

- 2-of-2 corpora clear blocking-tier with ≥50% margin → reranker ships v1.x default
- 1-of-2 → reranker stays opt-in
- 0-of-2 → reverse blocking-tier framing entirely (advisory IS v1 destination, not a way station)

Empirical result:

| Corpus | Advisory (P≥0.60, R≥0.60) | Blocking (P≥0.85, R≥0.70) |
|---|---|---|
| Atelier-internal (M5) | CLEAR (P=0.672, R=0.626) | NOT CLEAR |
| claude-agent-sdk (this run) | NOT CLEAR (P=0.554, R=0.542) | NOT CLEAR |

Strictly per rule: **0-of-2 corpora cleared blocking → reverse blocking-tier framing.** ADR-043's blocking-tier values (0.85/0.70) are no longer the v1.x target; they're retired as an aspirational gate that the v1 stack cannot reach without architectural augmentation (reranker, larger model, etc.) AND the augmentation is itself unproven against multiple corpora.

**The finding the activation rule did not anticipate: advisory itself is corpus-dependent.**

The activation rule assumed both corpora would at least clear advisory (M5 had cleared, and the wider-corpus hypothesis was generalization upward, not downward). Empirically, claude-agent-sdk doesn't clear advisory either. This is a structural finding about the v1 retrieval baseline:

- **Corpus topology matters more than corpus size.** claude-agent-sdk has 44 chunks (comparable to M5's 54 items) but a fundamentally different topic structure: many narrowly-overlapping single-doc topics where lateral semantic neighbors are easily confused. M5's ADR corpus has broader, distinctly-framed concept-per-doc separation that hybrid retrieval handles well.
- **Advisory portability is conditional, not universal.** Adopters whose corpus shape matches Atelier's (well-separated decision documents with distinct vocabulary per topic) get advisory-tier behavior at v1 defaults. Adopters whose corpus shape matches claude-agent-sdk's (multiple narrow-topic docs in the same domain cluster with shared vocabulary) need either: a larger embedding model (likely insufficient — M5 confirmed 3-small > 3-large on a similar topology), the cross-encoder reranker (the remediation §27 contemplates, now repositioned per below), or seed-side adjustment (multi-doc expected lists per topic to soften the binary single-expected pattern).

**Decision.**

1. **Reverse ADR-043's blocking-tier framing.** Per the activation rule's 0-of-2 outcome, the blocking-tier values (P≥0.85 AND R≥0.70) are no longer the v1.x target. ADR-043 stands as the canonical record of the M5 calibration outcome and the original advisory/blocking split, but its forward-looking blocking-tier promise is retired. `find_similar.gate.tier: blocking` config option still exists (so adopters who manually configure aggressive thresholds can use it), but it's no longer named as a v1.x default destination.

2. **Demote advisory-tier's universality claim.** Update ADR-043's advisory-tier framing: advisory holds for **Atelier-shape corpora** (well-separated decision documents with distinct vocabulary per topic). Adopters whose corpus shape differs may not clear advisory at v1 defaults. The `last-run.json` produced by the eval runner is the per-corpus measurement adopters should consult; the v1 ship gate is informational (per ADR-045) and per-corpus rather than universal.

3. **Resolve §27 cross-encoder reranker as v1.x opt-in.** Per the activation rule's 0-of-2 outcome it would be deferred indefinitely, but the diagnostic on this corpus (lateral domain-cluster confusion is the dominant failure mode) is exactly what a reranker addresses. v1.x adopters whose corpus shape doesn't clear advisory have a clear remediation path: enable the reranker. `find_similar.reranker.enabled` config slot is reserved at v1 (similar to BRD §22 schema reservation); adapter implementation lands at v1.x when an adopter signals need OR when measured data shows the reranker reliably lifts non-Atelier corpora into advisory.

4. **Update §27 status: OPEN → resolved as v1.x opt-in with clear activation criteria.** The criteria for v1.x reranker landing: (a) at least one adopter's measured corpus misses advisory by less than 15pp on either P or R, (b) the reranker measurably lifts that corpus into advisory in a controlled experiment, (c) the reranker's latency overhead at the adopter's typical query volume stays under 200ms p95 added to the baseline.

**Implementation alignments.**

- `.atelier/config.yaml`: gate.tier remains `advisory` default (already informational per ADR-045). No config changes from this ADR; the framing change lands in docs.
- `scripts/eval/find_similar/external/runner.ts` (new): the harness for running this kind of wider eval against any external corpus (this PR adds it).
- `atelier/eval/find_similar/external-corpora/claude-agent-sdk/`: the corpus + seeds + last-run.json land as fixtures (this PR commits them).
- ADR-006 frontmatter remains as authored (per ADR-hygiene; the original 0.75/0.60 values were the design-time aspiration; M5 + this ADR document the measured reality).
- ARCH 6.4: no change. Hybrid retrieval per ADR-042 is the v1 architecture; this ADR records that the v1 architecture is corpus-dependent in performance but not in correctness.

**Consequences.**

- BRD-OPEN-QUESTIONS §26 RESOLVED: wider eval data is collected against claude-agent-sdk; finding documented; activation rule applied.
- BRD-OPEN-QUESTIONS §27 RESOLVED: cross-encoder reranker is v1.x opt-in with documented activation criteria; not v1.x default.
- ADR-043 reversed for the blocking-tier framing portion. Advisory portion stands but with the corpus-dependence amendment from this ADR.
- ADR-006's wedge framing for find_similar (already softened in the M6 doc-only realignments per ADR-045's companion changes) stays softened: find_similar is a coordination signal that helps composers decide; it is not a hands-off duplicate-prevention gate, period. The corpus-dependence finding strengthens this reframing.
- Adopters get a clear remediation path when their corpus misses advisory: run the eval, inspect failure modes, optionally enable the v1.x reranker when it lands. The find_similar capability remains shipped at v1 in advisory-informational mode regardless of corpus shape.

**Re-evaluation triggers.**

- A third corpus measured that clears blocking-tier with ≥50% margin → re-open the blocking framing question (currently reversed; new data could reopen)
- A fourth corpus measured that misses advisory in a way reranker doesn't fix → consider deeper architectural change (different retrieval substrate; non-pgvector index; etc.)
- Adopter signals interest in blocking-tier behavior with their specific corpus + accepts the operational cost → wire reranker per the v1.x opt-in criteria above; this ADR's "v1.x opt-in" framing accommodates this without a new ADR
- The cross-encoder reranker measurably lifts ≥2 corpora from below-advisory into advisory in a controlled experiment → v1.x reranker becomes default (not opt-in); files a new ADR amending this one's "opt-in" resolution

**Cross-references.**

- BRD-OPEN-QUESTIONS §26 (this ADR's source open question) and §27 (cross-encoder reranker; resolved by this ADR as v1.x opt-in with criteria)
- ADR-006 (find_similar wedge framing — softened per cumulative ADR-045 + this ADR findings)
- ADR-041 (embedding model default; unchanged)
- ADR-042 (hybrid retrieval calibration; unchanged — the architecture is sound; the advisory-portability claim is the amendment)
- ADR-043 (advisory/blocking split; this ADR reverses the blocking-tier framing portion + amends advisory's universality)
- ADR-045 (eval gate informational + find_similar wedge demotion; cumulative with this ADR)
- `atelier/eval/find_similar/external-corpora/claude-agent-sdk/CORPUS.md` — corpus provenance + topic index
- `atelier/eval/find_similar/external-corpora/claude-agent-sdk/last-run.json` — full per-seed measurement record
- `scripts/eval/find_similar/external/runner.ts` — the runner that produced the result; adopters use the same runner against their own external corpora
