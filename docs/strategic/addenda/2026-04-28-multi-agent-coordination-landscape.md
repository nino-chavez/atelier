# Multi-agent coordination landscape (2026-04-28)

**Status:** Strategy addendum. Snapshot of analysis inputs as of 2026-04-28. STRATEGY.md not modified by this document; recommendations in section 7 are tracked separately.

**Triggered by:** Review of Maggie Appleton's 2026 AI Engineer Summit talk "Collaborative AI Engineering: One Dev, Two Dozen Agents, Zero Alignment" + survey of all 33 active and historical projects on GitHub Next (https://githubnext.com/).

**Scope:** What signals from the broader multi-agent coordination landscape should influence Atelier's architecture, methodology, and positioning? What does the landscape validate? What does it expose as gaps? Where does Atelier intentionally diverge?

---

## 1. Inputs analyzed

| Input | Provenance | Most relevant claim for Atelier |
|---|---|---|
| Appleton talk (2026) | YouTube via GitHub channel | Alignment touchpoints have collapsed because implementation is now minutes; PR holds all the coordination weight |
| ACE (Agent Collaboration Environment) | GitHub Next active research, paired with Appleton talk | Multiplayer microVM sessions; team-editable plans; agents read team conversation as input |
| Continuous AI | GitHub Next WIP (June 2025) | LLM-powered automation in platform-based software collaboration |
| Repo Mind | GitHub Next prototype (March 2026) | Semantic retrieval + graph-based summaries for codebase comprehension |
| Discovery Agent | GitHub Next prototype (May 2025) | Agentic setup, build, and testing of repositories |
| SpecLang | GitHub Next prototype (Nov 2023) | Software developed entirely in natural language |
| Copilot Workspace | GitHub Next completed (April 2024) | Agentic dev environment with plan-then-implement |
| Realtime GitHub | GitHub Next prototype (Nov 2023) | Multiplayer collaboration for entire repositories |
| Mosaic, Visualizing a Codebase, GitHub Blocks, Flat Data, TestPilot, Copilot for PRs | GitHub Next, various dates | Various adjacent patterns (design systems, repo visualization, custom blocks, data-in-git, test generation, PR collaboration) |

23 of 33 GitHub Next projects have direct or pattern-level relevance to Atelier's problem space. The 10 less-relevant ones (fonts, voice, calculation, etc.) are excluded from this analysis.

---

## 2. Themes that emerge

**2.1. Multi-agent coordination is an active research frontier at GitHub.**

ACE, Discovery Agent, Agentic Workflows, Continuous AI, Realtime GitHub, Collaborative Workspaces, Copilot Workspace -- many projects converge here. Atelier's bet that this is the right problem to solve is independently validated by GitHub's research investment. Competitive risk: GitHub has institutional advantage to ship if they decide to scale a winner.

**2.2. Plan-as-artifact pattern is emerging across multiple projects.**

ACE makes plans editable. SpecLang treats specs as source. Copilot Workspace had plan-then-implement workflows. Three independent projects converging on the same pattern. Combined with Appleton's "collapsed window" critique, this is the strongest signal that planning-as-discrete-checkpoint deserves first-class support, not just an implicit early-warning via find_similar.

**2.3. Semantic retrieval + graph-based summaries (Repo Mind) generalizes find_similar.**

Atelier does semantic retrieval per-row via embeddings (ARCH 6.4.x). Repo Mind adds graph-based summaries to surface relationships pure embedding search misses. Atelier's `traceability.json` is already graph-shaped; future find_similar could exploit it (return matches plus their connected ADRs/stories/contributions, not just isolated rows).

**2.4. Managed-runtime is the path GitHub validates; Atelier rejects it.**

GitHub Spark, Copilot Workspace, ACE all centralize compute. Atelier per ADR-007 explicitly doesn't. Both paths can be right for different audiences. Worth noting as competitive positioning, not architecture change.

**2.5. Spec-driven (SpecLang) is the aggressive version of Atelier's discipline.**

SpecLang: "spec is the source." Atelier: "spec is canonical; code follows but is still authored." Atelier is the conservative middle. Worth tracking which way the market goes.

---

## 3. What Atelier already addresses (validated positions)

| Atelier position | Validated by |
|---|---|
| Multi-composer coordination as the central problem (NORTH-STAR section 4; ADR-009; three composer-surface walks) | ACE, Discovery Agent, Realtime GitHub, Collaborative Workspaces |
| find_similar as a first-class duplication-detection primitive (ADR-006) | Repo Mind (semantic retrieval centrality) |
| Prototype-as-canonical-artifact (ADR-001; METHODOLOGY 2) | SpecLang, Copilot Workspace (spec/plan-driven workflows are real) |
| PR as a coordination surface (ARCH 6.2.3) | Copilot for PRs (PR-as-collaboration-point validated) |
| Decision-log discipline (ADR-005, ADR-030); rigorous-before-fast | Appleton's "reclaim time for rigorous thinking" thesis |
| Capability-level architecture; vendor-neutral (ADR-012) | Repo Mind / Continuous AI / etc. demonstrate the substrate is generalizable across providers |
| Designer territory + design contracts (ARCH 6.6.2; designer-week-1 walk) | Mosaic (design-systems-as-derivable-artifact) |
| Data-in-git pattern (`traceability.json`; round-trip integrity contract) | Flat Data (validated pattern) |

---

## 4. Where Atelier intentionally diverges

| Divergence | Rationale |
|---|---|
| Federated compute (composers bring own tools) vs. ACE's centralized microVM | ADR-007 (no SaaS); ADR-009 (composers' agents stay in their lanes); ADR-027 (reference stack supports self-hosting). Atelier's bet: teams want their own tools; substrate makes them coherent. |
| Artifacts as canonical (decisions, contributions, prototype) vs. ACE's session-as-canonical (Slack-channel metaphor) | ADR-010 explicit exclusion of chat. Atelier preserves rigorous output in the repo; chat lives in tools designed for it; per-contribution transcripts (ADR-024) capture conversation tied to specific work. |
| Conservative spec-canonical-but-code-authored vs. SpecLang's spec-IS-source | METHODOLOGY 2 + ADR-011 destination-first design. Atelier targets professional teams iterating on shipping software; aggressive spec-driven approaches may prove right for new categories but Atelier optimizes for the team-already-shipping case. |
| Self-hosted OSS template vs. Spark's "anyone creates software" managed product | Different audiences. Spark targets end-user creators; Atelier targets professional mixed teams. Both can succeed without contradiction. |

---

## 5. Gaps surfaced

**5.1. No first-class "plan" artifact between claim and implementation.**

The strongest gap. Three independent projects (ACE, SpecLang, Copilot Workspace) plus Appleton's collapsed-window critique all point at the same pattern: agent-generated plan → human/team edits collaboratively → code follows.

Atelier's contribution lifecycle is `open → claimed → in_progress → review → merged`. There's no checkpoint where a human edits the agent's intent before implementation begins. The `content_stub` field (ARCH 6.2.1) is the closest hook but it's currently just an initial body, not a reviewable plan.

**Proposed addition (filed as BRD-OPEN-QUESTIONS section 19):** opt-in `plan_review` state between `claimed` and `in_progress`, gated per-territory via `territories.yaml: requires_plan_review: true`. The agent calls `update(state="plan_review", payload=<plan markdown>)`; the territory's `review_role` approves; only then can `state="in_progress"` happen.

This addresses the "should we build it" bottleneck at the right point -- before code, not at PR.

**5.2. Alignment-checkpoint visibility in `/atelier` lenses is implicit.**

Atelier has alignment mechanisms (territories, find_similar warning, decision-log, PR review) but they're scattered across surfaces. Role-aware lenses per ADR-017 surface state, not the alignment-checkpoint cadence. A composer working at speed may not see "we are at the should-we-build moment" as a discrete signal.

**Possible addition:** a checkpoint indicator in `/atelier` lenses showing where each in-flight contribution sits relative to alignment touchpoints (find_similar gate cleared? plan reviewed? contracts checked? PR open?). Small UX add, not a substrate change. Not filed as a separate BRD-OPEN-QUESTIONS entry; folds into Epic 15 (role-aware lenses) at M3 implementation time.

**5.3. find_similar could exploit graph structure (v1.x).**

Repo Mind's semantic-retrieval-plus-graph-summaries pattern surfaces relationships pure embedding search misses. Atelier's `traceability.json` is graph-shaped; v1's find_similar treats it as a flat corpus. A v1.x extension could return matches plus their connected ADRs/stories/contributions/decisions in a single response.

Not v1 work. Tracked as a v1.x extension hook to consider when Repo Mind matures or when Atelier hits the limits of flat semantic search.

---

## 6. Competitive positioning sharpening

GitHub is shipping multiple agent-coordination products. Atelier's tier-3 positioning per ADR-031 (Specification + Reference Implementation + Reference Deployment) matters more than previously weighted. Atelier as the open methodology + protocol is differentiated from GitHub's product line; Atelier as "another collaboration tool" is not.

**What Atelier specifically protects that GitHub's product line does not:**

- **Methodology portability.** A team adopts Atelier's discipline (slice-based authoring, decision-log conventions, territory model) without committing to a specific platform. The methodology survives platform changes.
- **Multi-vendor MCP standard.** Atelier's protocol surface is MCP, an open standard. Teams using ACE or Copilot Workspace are committed to GitHub's proprietary surface.
- **Non-SaaS deployment.** Atelier per ADR-007 self-hosts. Teams with regulated-data, sovereign-cloud, or air-gap requirements cannot use ACE/Spark/Copilot Workspace as primary.
- **Capability-level architecture.** Per ADR-012 the architecture is vendor-neutral; the reference impl runs on GitHub + Supabase + Vercel + MCP but the spec implements on any equivalent stack (GCP per ADR-029 is the documented migration target).

These are real differentiators. Worth a short note in `risks.md` (or a new strategic-positioning doc) capturing them so the team's narrative stays sharp under competitive pressure.

---

## 7. Recommendations

Three threads with concrete actions:

**(R1) File plan_review checkpoint as BRD-OPEN-QUESTIONS section 19.** Strongest signal from this analysis. Decide before M2 contribution-lifecycle endpoint work lands. If accepted, becomes an ADR + ARCH addition (likely a new section 6.2.1.7 or similar).

**(R2) Update METHODOLOGY 11.4 quarterly destination check** to include "scan adjacent research surfaces (GitHub Next, comparable industry sources) for emerging patterns that should inform Atelier's direction." This addendum is the first such scan; the cadence makes it recurring rather than ad-hoc.

**(R3) Track Repo Mind and Continuous AI as influence candidates.** Both recent (2025-2026), both in Atelier's problem space. Add to the quarterly scan list. Don't act now; revisit as they publish more.

**Three things to NOT do** (bounded scope; preserves architectural commitments):

- Don't add team chat or session-as-canonical patterns -- ADR-010 holds; rationale unchanged
- Don't shift to managed-compute / shared-microVM -- ADR-007 + ADR-027 hold; this is positioning, not gap
- Don't try to compete with ACE on its own terms -- different team shapes; different bets

---

## 8. Pattern observed (meta)

This addendum is itself a process artifact worth noting. Two cycles ago I performed the same kind of analysis (Appleton talk review) before this comprehensive one. That review identified one gap (plan_review). This broader addendum identified the same gap plus several others (alignment-checkpoint visibility, graph-aware find_similar). The lesson: pattern-emergence requires breadth of inputs, not depth on one. A single talk analysis is necessary but not sufficient; the second pass against a broader corpus surfaced additional patterns.

This validates METHODOLOGY 11.4 quarterly destination check (per R2) as the right cadence -- not because every quarter will reveal something new, but because the cumulative breadth is what surfaces emerging patterns.

---

## 9. Cross-references

- `../STRATEGY.md` -- canonical strategy (this addendum does not modify it)
- `../STRATEGY.md` section 10 "Known staleness" -- the quarterly re-audit cadence this addendum partially fulfills
- `../risks.md` -- competitive positioning notes worth refreshing per section 6 above
- `../../functional/BRD-OPEN-QUESTIONS.md` section 19 -- plan_review checkpoint per R1
- `../../methodology/METHODOLOGY.md` section 11.4 -- quarterly destination check per R2
- `../../architecture/decisions/` -- ADR-001, ADR-006, ADR-007, ADR-009, ADR-010, ADR-011, ADR-012, ADR-018, ADR-027, ADR-031 (the load-bearing decisions referenced in this analysis)
