---
id: ADR-031
trace_id: BRD:Epic-1
category: strategy
session: doc-organization-2026-04-25
composer: nino-chavez
timestamp: 2026-04-25T13:30:00Z
---

# Three-tier consumer model: Specification, Reference Implementation, Reference Deployment

**Summary.** Atelier serves three distinct consumer intents, all first-class at v1, all open source, ordered by engagement depth. Standards-body labels are used in formal docs and ADRs; action labels are used in README routing.

| Tier | Formal label | README action | Reader's intent |
|---|---|---|---|
| 1 | **Reference Deployment** | **Deploy** | "Run Atelier as-is for my team via `atelier init && atelier deploy`. I don't want to think about the implementation." |
| 2 | **Reference Implementation** | **Extend** | "Fork this repo and customize: change schema, add lenses, swap fit_check model, write new sync adapters." |
| 3 | **Specification** | **Implement** | "Implement the 12-tool protocol on a different stack" or "apply Atelier's methodology to my project without using this codebase." |

**Rationale.** Atelier is three things in one repo: a methodology (transferable), a protocol (implementable), and a reference implementation (this codebase). The seven-layer audience model from claude-docs-toolkit serves consumers of *one product*; it doesn't carve out the three engagement levels Atelier actually has. Without explicit tiering, tier-3 readers get lost in implementation-specific docs, tier-2 readers find no on-ramp for forking, and tier-1 readers can't tell which docs are "must-read for deployment" vs "internal architecture." Standards-body taxonomy (Specification → Reference Implementation → Reference Deployment) maps directly to W3C/IETF practice, which Atelier earns by shipping an actual open protocol. The three-tier framing also enables the dogfood/refine loop with claude-docs-toolkit: refinements discovered in tier 2 (this repo) feed back into the toolkit, which then improves tier-1/tier-3 experiences for downstream adopters.

**Consequences.**
- README gains tier-routing as the primary navigation: three "I want to ___" paths (Deploy / Extend / Implement) each citing the entry doc for that tier.
- New documentation surfaces required (and authored as part of this PR):
  - `docs/methodology/adoption-guide.md` — tier-3 entry for methodology adopters
  - `docs/architecture/protocol/README.md` — tier-3 entry for protocol implementers (with `implementing-on-other-stacks.md`)
  - `docs/developer/fork-and-customize.md` — tier-2 on-ramp
  - `docs/developer/upstreaming.md` — cross-tier contribution loop (tier-2/tier-3 improvements feed back to tier-3 spec or claude-docs-toolkit)
- ADR-007 (no SaaS) remains in force — tier 1 is "deploy our reference impl into your cloud," not "consume our hosted service."
- ADR-027 (reference stack) remains the tier-1 default; tier-2 readers can swap; tier-3 readers ignore the stack entirely.
- `atelier init && atelier deploy` defaults to the tier-1 path with the reference stack.
- Doc structure (ADR-032) implements this tiering; reversing this ADR would also reverse ADR-032.

**Re-evaluation triggers.**
- Two of the three tiers see zero adoption in 12 months (collapse to one or two tiers).
- A fourth distinct consumer intent emerges that doesn't fit any tier (e.g., "managed Atelier" — would re-open ADR-007 first).
