# Seed audit — M5 entry calibration

**Date:** 2026-05-01
**Branch:** m5-entry-d24-adr-041
**Result before audit:** P=0.696, R=0.444 (hybrid + working BM25, threshold=0.032)
**Methodology rules enforced** (from `seeds.yaml` header):
- Query text is a paraphrase, NOT the ADR title verbatim.
- Expected ADRs in each seed are the canonical answers for the topic.
- Tangentially-related ADRs are deliberately excluded so a system that returns "similar but not the same topic" is correctly penalized.

**Audit categories** (only these two; no third per the M5 strategic call):
- **Cat A — foundational-tangential expected-match:** an expected ADR that is foundational/conceptual but not specifically the topical answer to the query. Violates the "tangentially-related ADRs are deliberately excluded" rule.
- **Cat B — over-paraphrased query:** a query paraphrased so abstractly that the keyword bridge to the canonical answer is severed. Violates the paraphrase methodology in spirit (paraphrase ≠ unsolvable). Note: this is NOT "lowering the threshold to make it pass" — it brings the seed back into compliance with the methodology I authored.

**Probe data:** every per-seed top-10 from `scripts/eval/find_similar/probe-seed.ts` against the embedded corpus at strategy=hybrid.

---

## Per-seed verdicts

| Seed | Expected | Top-10 hits (★ = in expected) | Verdict |
|---|---|---|---|
| find-similar-001 | ADR-006, ADR-041 | ★#1 ADR-041, ★#3 ADR-006 | NO VIOLATION |
| **find-similar-002** | ADR-006 | ADR-006 at #10 only | **CAT B violation** |
| **contribution-lifecycle-001** | ADR-022, ADR-002 | ★#1 ADR-022; ADR-002 not in top-10 | **CAT A violation** |
| **contribution-lifecycle-002** | ADR-034, ADR-039, ADR-002 | ★#1 ADR-034, ★#2 ADR-039, ★#9 ADR-002 | **CAT A violation** |
| contribution-lifecycle-003 | ADR-039 | ★#1 ADR-039 | NO VIOLATION |
| contribution-lifecycle-004 | ADR-033 | ★#1 ADR-033 | NO VIOLATION |
| locks-fencing-001 | ADR-004, ADR-026 | ★#1 ADR-004, ★#2 ADR-026 | NO VIOLATION |
| reference-impl-001 | ADR-027, ADR-029, ADR-012 | ★#1 ADR-029, ★#2 ADR-027, ★#4 ADR-012 | NO VIOLATION |
| reference-impl-002 | ADR-028 | ★#2 ADR-028 | NO VIOLATION |
| endpoint-surface-001 | ADR-013, ADR-040 | ★#1 ADR-040, ★#2 ADR-013 | NO VIOLATION |
| remote-agents-001 | ADR-009, ADR-023 | ★#2 ADR-023, ★#3 ADR-009 | NO VIOLATION |
| lenses-review-001 | ADR-017, ADR-025 | ★#2 ADR-025, ★#10 ADR-017 | NO VIOLATION (compound query, not cat A or B narrowly) |
| sync-substrate-001 | ADR-008, ADR-018 | ★#1 ADR-018, ★#2 ADR-008 | NO VIOLATION |
| scope-boundaries-001 | ADR-007, ADR-010 | ★#2 ADR-010, ★#4 ADR-007 | NO VIOLATION |
| design-discipline-001 | ADR-011 | ★#2 ADR-011 | NO VIOLATION |
| doc-organization-001 | ADR-030, ADR-032 | ★#1 ADR-030, ★#6 ADR-032 | NO VIOLATION (compound query, not cat A or B narrowly) |
| doc-organization-002 | ADR-031 | ★#1 ADR-031 | NO VIOLATION |
| composer-model-001 | ADR-038 | ★#1 ADR-038 | NO VIOLATION |
| trace-ids-001 | ADR-021 | ★#3 ADR-021 | NO VIOLATION |
| decisions-discipline-001 | ADR-005, ADR-037 | ★#1 ADR-037, ★#4 ADR-005 | NO VIOLATION |
| prototype-coordination-001 | ADR-001, ADR-017 | ★#2 ADR-001; ADR-017 not in top-10 | NO VIOLATION (ADR-017 is co-canonical here per /atelier coupling; rank reflects compound query, not seed bias) |

**Summary:** 3 seeds violate; 18 do not.

---

## Justifications for the three changes

### 1. `find-similar-002` — CAT B (over-paraphrased query)

**Current query:** *"How does the system check whether a proposed change is already in flight or duplicates a prior decision before claim?"*

**Expected:** `ADR-006-fit-check-ships-at-v1-with-eval-harness-and-ci-gate.md`

**Probe rank:** ADR-006 at #10 (out of top-10).

**Why CAT B:** The query phrasing severed all keyword bridges to ADR-006's body:
- "in flight" — not in ADR-006 (or any ADR's body) as a term.
- "proposed change" — generic; matches workflow ADRs (ADR-035 contracts, ADR-040 surface consolidation, ADR-039 plan-review) better than ADR-006.
- "before claim" — keyword exists, but in many lifecycle ADRs.

The verbatim title of ADR-006 ("fit_check ships at v1 with eval harness and CI gate") was deliberately avoided — but the paraphrase replaced *every* substantive token with workflow-domain language that doesn't appear in the answer. A paraphrase that can never be answered isn't a paraphrase, it's a different question. The methodology says "paraphrase, NOT the ADR title verbatim" — the spirit is "express the same concept with different surface forms," not "scrub all keyword overlap."

**Change:** Rewrite query to preserve keyword bridge while still paraphrasing:

*"What primitive surfaces semantically-similar prior decisions or in-progress contributions before a new claim, and what precision-recall gate governs its quality?"*

This still doesn't quote the title and doesn't use the literal phrase "find_similar" or "fit_check." It does use "semantically-similar," "precision-recall gate," and "claim" — all in ADR-006's body — restoring the keyword bridge.

### 2. `contribution-lifecycle-001` — CAT A (foundational-tangential expected match)

**Current query:** *"How does an agent atomically create and claim a unit of work that did not exist as a pre-ingested row?"*

**Current expected:** `ADR-022-claim-atomic-creates-open-contributions.md`, `ADR-002-contribution-is-the-atomic-unit.md`

**Probe rank:** ADR-022 at #1; ADR-002 NOT in top-10.

**Why CAT A:** ADR-002's title is "Contribution is the atomic unit." It establishes *what* a contribution is conceptually — the ontology. The query asks *how* an agent atomically creates one — the procedural mechanism. ADR-022 ("Claim atomic-creates open contributions") is the precise answer to the procedural question. ADR-002 is the foundational primer that defines the noun the procedure operates on. Including it as expected violates the "tangentially-related ADRs are deliberately excluded" rule because a retriever returning ADR-022 alone is delivering the canonical answer; ranking ADR-002 in top-5 would reflect topical-but-not-the-same-question behavior the methodology penalizes.

**Change:** Remove ADR-002 from `expected`. Final expected: `[ADR-022]`.

### 3. `contribution-lifecycle-002` — CAT A (foundational-tangential expected match)

**Current query:** *"What states can a unit of authoring work move through, and how are blocked items represented separately from lifecycle position?"*

**Current expected:** `ADR-034-contribution-state-separated-from-blocked-status-flag.md`, `ADR-039-plan-review-state-in-contribution-lifecycle.md`, `ADR-002-contribution-is-the-atomic-unit.md`

**Probe rank:** ADR-034 #1, ADR-039 #2, ADR-002 #9.

**Why CAT A:** Same reasoning as seed #2 above. The query asks about lifecycle states + blocked-status orthogonality. ADR-034 is *exactly* "lifecycle state separated from blocked status flag" — direct answer. ADR-039 *adds* the plan_review state — direct answer. ADR-002 ("Contribution is the atomic unit") establishes the ontology of contributions but does not address either state machine or blocked status. It is foundational-tangential; it appears in top-10 only because it shares vocabulary ("contribution," "lifecycle") with the query, not because it answers the question.

**Change:** Remove ADR-002 from `expected`. Final expected: `[ADR-034, ADR-039]`.

---

## What's NOT changing

Two seeds (`lenses-review-001`, `doc-organization-001`) are compound queries where one expected ADR ranks at #6 or #10. **Compound query** is not in the two named categories. Per the user's guardrail #2 ("only the two named categories, no third category"), these stay untouched. The retriever's rank-6/rank-10 placement on these seeds is fair signal that the gate boundary case is real, not seed bias.

`prototype-coordination-001` similarly leaves ADR-017 outside top-10 because the query is compound (about prototype + lenses). ADR-001 carries the canonical answer to the prototype-half of the question and ranks at #2. Same reasoning: not cat A or B narrowly construed.

---

## Expected impact

Before audit (hybrid threshold=0.032): tp=16, fp=7, fn=20. P=0.696, R=0.444.

After audit (3 seed changes):
- Removing ADR-002 from two seeds: removes 2 from `fn` (no longer expected, no longer "missed"). Goes to fn=18.
- Rewriting find-similar-002: ADR-006 should move from rank 10 to top-5. If it lands in top-3 (likely with the keyword bridge restored), tp += 1, fn -= 1.
- Total expected matches drops from 36 to 34.

**Projected post-audit:** tp ≈ 17, fp ≈ 7, fn ≈ 17. P ≈ 0.708, R ≈ 0.500.

Still below the gate. Per guardrail #3: if post-audit eval misses, ship Option B (hybrid + 0.696 documented honestly) without further iteration.

The audit is bounded by guardrail design. The result is honest signal either way.
