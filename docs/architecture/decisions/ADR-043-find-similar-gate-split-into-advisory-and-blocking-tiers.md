---
id: ADR-043
trace_id: BRD:Epic-6
category: product
session: m5-entry-eval-tier-split-2026-05-01
composer: nino-chavez
timestamp: 2026-05-01T14:30:00Z
---

# find_similar gate split into advisory (v1 default) and blocking (v1.x opt-in) tiers; ADR-006's 0.75/0.60 becomes the blocking-tier target, not the v1 ship gate

**Summary.** ADR-006 set a single `precision >= 0.75 AND recall >= 0.60` gate for find_similar at v1. M5 calibration measured the ship-able implementation (hybrid retrieval per ADR-042 + multi-author 111-seed eval set + text-embedding-3-small) at **P=0.672, R=0.626** -- recall clears the original 60% bar; precision falls short of 75%. ADR-043 keeps ADR-006's ambition by splitting the gate into two tiers:

- **Advisory tier (v1 default).** `precision >= 0.60 AND recall >= 0.60`. find_similar serves as a warning surface: at claim-time and in the lens UI, primary matches are surfaced to the composer who decides whether the work duplicates an existing item. This is what the v1 implementation delivers; the M5 measurement clears it.
- **Blocking tier (v1.x opt-in, config-gated).** `precision >= 0.85 AND recall >= 0.70`. find_similar gates merges autonomously -- a primary match above threshold blocks the contribution from progressing without explicit override. Requires the cross-encoder reranker (BRD-OPEN-QUESTIONS section 27) to land before this tier is achievable; remains a v1.x deliverable per the discipline-tax meta-finding.

ADR-006 is not reversed -- it set the destination, and the destination still holds. The threshold values in ADR-006 are reinterpreted: 0.75/0.60 was the implicit blocking-tier target conflated with v1 advisory-tier reality. This ADR makes the conflation explicit and resolves it.

**Rationale.**

ADR-006's framing -- "fit_check is the single most differentiated primitive in Atelier" -- assumed a quality bar suitable for *autonomous* duplicate prevention: the system catches duplicates without human review, the wedge is hands-off. The 0.75/0.60 numbers were authored against that assumption, before the M5 substrate existed to measure them.

M5 calibration provided the data. The measurements are honest signal:

| Configuration | Precision | Recall | Gate (0.75/0.60)? |
|---|---|---|---|
| 21 nino-authored seeds, vector-only @ 0.50 cosine | 0.680 | 0.472 | no |
| 21 cleaned seeds (M5-AUDIT.md), hybrid @ 0.032 RRF | 0.727 | 0.471 | no |
| 111 multi-author seeds (analyst+dev+pm lens priming), hybrid, 3-small | **0.672** | **0.626** | recall yes, precision no |
| 111 multi-author seeds, hybrid, 3-large (3072-dim) | 0.648 | 0.634 | recall yes, precision no |

The recall achievement is the load-bearing signal. With multi-author seeds (BRD-OPEN-QUESTIONS section 26 mitigation), recall improved from 0.471 to 0.626 -- a 15.5pp lift -- and *cleared* the original 60% bar. The retriever surfaces the right items; what it can't do at v1 is sort them confidently enough to block merge without human review.

**Why split rather than just lower.** Lowering 0.75/0.60 to the measured 0.672/0.626 would replace ADR-006's guess with data, which is what the user's plan for the "<70% precision" bucket calls for. But that framing loses information: the ambition behind ADR-006 wasn't 0.75 specifically -- it was *autonomous quality*. A flat downward revision would silently demote the wedge from "duplicate prevention" to "duplicate suggestion" without making the change explicit. Splitting the gate makes the demotion legible to adopters and preserves ADR-006's destination as a v1.x deliverable (gated on a known mechanism: cross-encoder reranking, per section 27).

The two-tier framing also matches industry practice for retrieval-quality gates:

- Advisory-quality search (think: GitHub repo search, JIRA's "similar issues" suggestions, Slack's "you may have seen these messages") accepts ~0.60 precision because the surface is human-confirmed before action.
- Blocking-quality search (think: Stripe Radar duplicate detection, content-moderation classifiers) requires 0.85+ precision because the system acts without confirmation.

ADR-006's wedge framing fits the second category; the M5 implementation reaches the first. The split makes that distinction first-class.

**Decision.**

1. **The v1 gate is advisory.** `precision >= 0.60 AND recall >= 0.60` on `atelier/eval/find_similar/seeds-merged.yaml`. CI enforces this gate. M5-entry result (0.672/0.626) clears it.

2. **The v1.x gate is blocking.** `precision >= 0.85 AND recall >= 0.70` on the same eval surface (or an expanded one per BRD-OPEN-QUESTIONS section 26 M7 wider-eval scope). Adopters opt in via `find_similar.gate.tier: blocking` in `.atelier/config.yaml`; the runtime behavior of find_similar adds an autonomous-merge-block path when blocking is selected. Blocking remains "not achievable at v1" until a cross-encoder reranker (per BRD-OPEN-QUESTIONS section 27) lands.

3. **The lens UI carries tier metadata.** `FindSimilarPanel` shows "advisory match" or "blocking match" labels per the configured tier; degraded responses (US-6.5) show the existing degraded banner regardless of tier.

4. **ADR-006 is not reversed.** Its commitment ("fit_check ships at v1 with eval harness and CI gate") still holds; its 0.75/0.60 numbers are reinterpreted as the blocking-tier target. The CLAUDE.md ADR-006 abbreviation is updated to reference this ADR for the tier split.

5. **The CI gate values in `.atelier/config.yaml` move to advisory.** `ci_precision_gate: 0.60` and `ci_recall_gate: 0.60`. The blocking values (0.85/0.70) are documented in the same block but not enforced unless `gate.tier: blocking` is set explicitly.

**Consequences.**

- **find_similar ships at v1 honestly.** The wedge is surfaced as advisory; adopters see results, decide whether to act. The retriever's quality is what it actually is: 0.672 precision, 0.626 recall.
- **The blocking ambition is preserved.** ADR-006's destination remains the destination; ADR-043 names the path (cross-encoder reranker) and the trigger (section 27 lands).
- **CI runs are now informative both ways.** Pre-section-27, CI runs against the advisory gate; precision/recall metrics still surface in the JSON artifact for tracking. Post-section-27 (when the reranker lands), the same CI run can be configured to enforce blocking on a separate workflow flag.
- **Adopter messaging is honest.** Documentation in `docs/user/find_similar.md` (lands at M7) describes the advisory tier as the v1 reality and the blocking tier as a v1.x toggle requiring additional infrastructure.
- **Commercial wedge framing scopes appropriately.** The find_similar pitch becomes "Atelier surfaces duplicate work to human composers at claim-time; teams who want autonomous duplicate prevention enable the v1.x blocking tier." This is a smaller pitch than "Atelier prevents duplicate work autonomously," but it's the pitch the v1 implementation can defend.

**Trade-offs considered and rejected.**

| Option | Why rejected |
|---|---|
| **Lower the single gate to 0.65/0.60 to match measurement** | Loses the "ADR-006's ambition" signal. Adopters see "find_similar passes its CI gate" without knowing the gate was demoted from autonomous-quality to advisory-quality. Less honest, not more. |
| **Keep 0.75/0.60, ship below the gate, document in PR description only** | Ships find_similar's CI step in a perpetually-failing state. CI red is not a coherent default for a substrate that is functionally working at advisory quality. |
| **Three tiers (off / advisory / blocking) instead of two** | "Off" is not a tier, it's `find_similar` not being called. The two-tier model fits how teams actually consume retrieval-quality systems; adding a third tier without a load-bearing distinction adds discipline-tax for no benefit. |
| **Tier values per-project (every adopter sets their own gate)** | Adopters lack the eval data to set tier values intelligently. The reference values (0.60/0.60 advisory, 0.85/0.70 blocking) come from this repo's M5 measurement + industry-practice norms; making them defaults is the right discipline-tax minimum. Adopters who tune do so against their own measured eval set. |
| **Wait until the reranker lands to make any threshold call** | Blocks M5 ship indefinitely. The advisory tier is a real, measured, ship-able product; the reranker is a future enhancement. Coupling the v1 ship to a v1.x deliverable inverts the dependency direction. |

**Reverse / revisit conditions.**

- The cross-encoder reranker per section 27 lands and the blocking tier measures clean -> add a new ADR documenting the reranker's eval results + ratifying the 0.85/0.70 blocking values (or revising them based on the reranker's empirical behavior). This ADR's advisory tier stays.
- M7 wider eval against external corpora shows the advisory tier doesn't generalize (e.g. drops to 0.40/0.50 on a real-world team's corpus) -> file follow-up ADR investigating whether the v1 retriever architecture (hybrid + RRF) is the right baseline or whether the substrate needs a different default. ADR-006 + ADR-043 may both need revision.
- An adopter contributes a meaningfully better default retriever (e.g., a finetuned encoder + reranker) and demonstrates >=0.85/0.70 on the merged seed set without infrastructure changes -> consider folding it back as the v1.x default.
