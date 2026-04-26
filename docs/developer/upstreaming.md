# Upstreaming — feeding improvements back

**Audience:** Anyone (tier 1, 2, or 3) who has discovered an improvement worth contributing back.

**Tier served:** Cross-tier.

The dogfood/refine loop only works if downstream improvements flow back upstream. This doc tells you where each kind of improvement belongs.

---

## Where does my improvement go?

| You discovered... | Send to | Why |
|---|---|---|
| A bug in the reference impl (this repo) | This repo, as a PR or issue | Fix the reference impl |
| A new adapter (Linear, Confluence, Slack, etc.) | This repo, as a PR adding to `prototype/src/adapters/` and `docs/developer/extending/` | Adapters benefit all tier-2 forks |
| A methodology refinement (a constraint we should add, a pattern we should drop) | This repo, as a PR to `docs/methodology/METHODOLOGY.md` and a new ADR | Methodology evolution is repo-canonical |
| A protocol gap (the 12-tool surface needs a thirteenth, or one tool needs new semantics) | This repo, as a new ADR proposing the change | Protocol changes are ADR-worthy per ADR-013 |
| A schema gap (a column we should add, a constraint we should change) | This repo, as a PR to `docs/architecture/schema/` and a new ADR | Schema changes are ADR-worthy |
| A doc-layer refinement (a layer the toolkit should have, a pattern that audits well) | claude-docs-toolkit | Doc structure is owned upstream of Atelier (per ADR-032) |
| A way-of-working insight that's not Atelier-specific (general agile + agent practice) | A blog post, conference talk, or upstream methodology doc — not this repo | Atelier is opinionated; not every insight fits |

## How to propose a methodology change

1. Open an issue describing the gap (constraint that didn't fit, pattern that broke).
2. Propose the refinement as a draft ADR. Use the template from [`../architecture/decisions/README.md`](../architecture/decisions/README.md).
3. Link evidence: a real adoption pain, not a hypothetical.
4. Maintainer review against the load-bearing decisions ([`CLAUDE.md`](../../CLAUDE.md) load-bearing list).
5. If accepted, the ADR is appended; if rejected, the issue is closed with rationale.

Reversals of existing ADRs follow the same flow but additionally must reference the prior ADR with `reverses:` frontmatter.

## How to propose a protocol change

The 12-tool surface is load-bearing per ADR-013. Changes are major.

1. Same flow as methodology change.
2. Additionally: backwards-compatibility analysis. A new tool is additive (low risk). A semantic change to an existing tool breaks every tier-3 implementation (high risk). Spell out the impact.
3. If accepted, version the protocol (semver-style) — protocol changes should not silently break tier-3 implementations.

## How to propose a doc-structure refinement to claude-docs-toolkit

Per ADR-032, Atelier commits to feeding refinements upstream. Examples of what to upstream:

- New audience layer (Atelier's `methodology/` layer is one example)
- New audit dimension (Atelier's three-tier consumer model is another)
- A pattern that improves drift detection
- A pattern that improves audit-passability

Send these as PRs against claude-docs-toolkit. Reference the Atelier use case as evidence.

## What we will NOT accept upstream

- Customizations specific to one team's workflow (those stay in your fork)
- Refinements that violate load-bearing ADRs without a corresponding reversal proposal
- Speculative additions ("might be useful someday") — destination-first means real demand, not anticipation
- Documentation drift (per `METHODOLOGY.md §6.1` no-parallel-summary rule) — even if well-intentioned

## Cross-tier loop visualization

```
  Tier 3 (Specification adopters)
       discovers methodology gap
              ↓
  PR to this repo (docs/methodology/ + ADR)
              ↓
  Maintainer review → accepted ADR
              ↓
  Tier 2 (Reference Impl extenders)
       pulls main, gets methodology update
              ↓
  Their fork now reflects the refinement
              ↓
  Tier 1 (Reference Deployment users)
       next `atelier upgrade` propagates the change
```

The loop only works if everyone participates. If you noticed something worth fixing and didn't upstream it, the methodology stagnates.
