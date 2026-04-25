---
id: ADR-032
trace_id: BRD:Epic-1
category: methodology
session: doc-organization-2026-04-25
composer: nino-chavez
timestamp: 2026-04-25T14:00:00Z
---

# Adopt extended documentation structure (toolkit-derived, Atelier-extended)

**Summary.** Canonical docs move from root-flat into a `docs/` tree derived from claude-docs-toolkit's seven audience layers, with three Atelier-specific extensions: `methodology/` as a peer to `developer/`, and `protocol/` + `schema/` as sub-layers of `architecture/`. Empty layers (ops/, testing/, user/) are pre-allocated with READMEs citing the BUILD-SEQUENCE milestone where they fill in. Refinements discovered through Atelier's adoption are upstreamed to claude-docs-toolkit.

**Rationale.** Three forces:

1. **Audit-passability at v1.** Running an imaginary docs audit on completed Atelier (post-M7) — using claude-docs-toolkit's seven-layer rubric — current state scores ~4/10 (functional and strategic excellent; everything else thin or empty). Pre-allocating the destination structure now realizes destination-first design (ADR-011) at the doc layer.
2. **Tier separability (ADR-031).** The three-tier consumer model needs structural enforcement, not just narrative description. Tier-3 readers need `docs/methodology/` and `docs/architecture/protocol/` as separable surfaces; folding them into developer onboarding (toolkit's default) breaks the spec/impl separation.
3. **Toolkit refinement loop.** Atelier is the test case for documenting projects that are also specs (methodology + protocol + reference impl). The toolkit's seven-layer model needs extensions for this class; Atelier discovers and upstreams them.

**Atelier-specific extensions to the toolkit's seven layers:**

| Layer | Origin | Why Atelier needs it as a peer |
|---|---|---|
| `methodology/` | Atelier addition | Toolkit folds methodology into developer/. For projects that ARE methodologies (transferable to other repos), this needs a separate home. |
| `architecture/protocol/` | Atelier addition | Toolkit assumes architecture is internal-design-only. For projects that ship open protocols, the spec-level reference is a different doc class. |
| `architecture/schema/` | Atelier addition | Territory contracts, datastore schema, config schema, scope_kind enum are reference material, not architecture-as-narrative. |
| `architecture/walks/` | Atelier addition | Scenario validations of the architecture (analyst-week-1, etc.) — distinct from architecture-as-spec. |

**Final structure:**

```
atelier/
├── README.md, CLAUDE.md, AGENTS.md, traceability.json   # root: cold-start + agent constitution
└── docs/
    ├── methodology/        # Atelier's way-of-working (tier-3 entry for adopters)
    ├── strategic/          # NORTH-STAR, STRATEGY, BUILD-SEQUENCE
    ├── functional/         # PRD, PRD-COMPANION, BRD, BRD-OPEN-QUESTIONS
    ├── architecture/
    │   ├── ARCHITECTURE.md
    │   ├── decisions/      # per-ADR files (ADR-030)
    │   ├── protocol/       # 12-tool open spec (tier-3 entry for implementers)
    │   ├── schema/         # territory contracts, datastore schema, config schema
    │   ├── walks/          # scenario validation
    │   └── diagrams/       # placeholder
    ├── developer/          # contribute to THIS repo (tier-2 on-ramp + extending guides)
    ├── ops/                # self-host runbooks (populates at M7)
    ├── testing/            # eval harness, fit_check methodology (populates at M5)
    └── user/               # Diátaxis: tutorials, guides, reference, explanation (v1)
```

**Consequences.**
- ~14 canonical docs move from root into `docs/<layer>/`. CLAUDE.md precedence list updates with new paths. Cross-doc references in moved files updated.
- `traceability.json` paths updated repo-wide.
- Empty layer READMEs cite the BUILD-SEQUENCE milestone where they populate (e.g., `docs/ops/README.md`: "Self-host operational docs land here at M7").
- `prototype/`, `scripts/`, `research/`, `walks/` (now `docs/architecture/walks/`), `.atelier/` remain at root as code/data/config/ephemeral peers to `docs/`.
- Refinements upstreamed to claude-docs-toolkit (committed to follow up post-PR):
  - methodology/ as first-class layer (for projects that are methodologies)
  - architecture/protocol/ + architecture/schema/ as sub-layers (for projects that ship open specs)
  - Empty layers as destination-first signals (not audit gaps), gated on milestone-citing READMEs
  - Three-tier consumer model as audit dimension (Specification / Reference Implementation / Reference Deployment) for projects-that-are-also-specs
- Reversing this ADR also reverses ADR-031 (the tiering loses structural support).

**Re-evaluation triggers.**
- Doc count drops dramatically (e.g., consolidation phase).
- claude-docs-toolkit revises its model in a way that supersedes Atelier's extensions.
- Cross-doc reference churn from moves causes ongoing pain (mitigated by the one-PR migration; if it persists, structural problem).
