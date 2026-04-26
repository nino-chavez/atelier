# Architecture Decision Records (ADRs)

**Audience question:** What were the canonical decisions, in what order, and why?

**Primary tier served:** Cross-tier — every reader needs the decisions that bound the design.

Append-only canonical decision log per ADR-005 (decisions write to repo first) and ADR-030 (per-ADR file split). New ADRs are new files. Existing ADRs are never edited; reversals are new ADRs with `reverses: ADR-NNN` frontmatter.

## Index

| ADR | Title | Summary |
|---|---|---|
| [ADR-001](./ADR-001-prototype-is-the-canonical-artifact-and-coordination-dashboa.md) | Prototype is the canonical artifact AND coordination dashboard | The prototype web app serves as both the product artifact (strategy + design + current-state panels) and the coordination dashboard (`/ateli… |
| [ADR-002](./ADR-002-contribution-is-the-atomic-unit.md) | Contribution is the atomic unit | Tasks, decisions, PRs, proposals, and drafts all live in one `contributions` table. Distinguished by `kind` (implementation \| decision \| res… |
| [ADR-003](./ADR-003-scope-kind-generalized-from-day-one.md) | scope_kind generalized from day one | Territory `scope_kind` is one of five values at v1: `files`, `doc_region`, `research_artifact`, `design_component`, `slice_config`. Not "fil… |
| [ADR-004](./ADR-004-fencing-tokens-mandatory-on-all-locks-from-v1.md) | Fencing tokens mandatory on all locks from v1 | Every lock acquisition returns a monotonic per-project fencing_token. Every write to a locked artifact validates the token server-side. Stal… |
| [ADR-005](./ADR-005-decisions-write-to-decisionsmd-first-datastore-second.md) | Decisions write to decisions.md first, datastore second | `log_decision` is a four-step atomic operation: (1) append to `decisions.md` in repo, (2) insert row in datastore decisions table, (3) gener… |
| [ADR-006](./ADR-006-fit-check-ships-at-v1-with-eval-harness-and-ci-gate.md) | The semantic-search primitive ships at v1 with eval harness and CI gate | Establishes the eval harness and CI gate at ≥75% precision at ≥60% recall. **Note:** ADR-006 was written when the primitive was named `fit_check`; renamed to `find_similar` on 2026-04-26 for vocabulary consistency. ADR text preserved verbatim per append-only convention. |
| [ADR-007](./ADR-007-no-multi-tenant-saas-self-hosted-oss-only.md) | No multi-tenant SaaS; self-hosted OSS only | Atelier ships as an OSS template that teams self-host. No central Atelier service, no tenant database, no billing infrastructure at v1. Comm… |
| [ADR-008](./ADR-008-all-5-sync-substrate-scripts-ship-together.md) | All 5 sync substrate scripts ship together | `publish-docs`, `publish-delivery`, `mirror-delivery`, `reconcile`, and `triage` all ship at v1. No phased rollout. |
| [ADR-009](./ADR-009-remote-principal-actor-class-web-agents-as-first-class-compo.md) | Remote-principal actor class (web agents as first-class composers) | The actor model has six classes at v1. Principal + IDE harness and Principal + web harness are distinct. Web-surface principals are full composers, not second-class reviewers. |
| [ADR-010](./ADR-010-explicit-exclusions-enforce-scope-boundaries.md) | Explicit exclusions enforce scope boundaries | Atelier is explicitly NOT: a SaaS, an agent framework, a workflow engine, a task tracker UI, a chat app, a code editor, a design tool, a doc… |
| [ADR-011](./ADR-011-destination-first-design-no-feature-deferral.md) | Destination-first design; no feature deferral | The complete v1 design scope is specified in `../../strategic/NORTH-STAR.md`. No phasing in the design docs. No "Phase 2" or "coming soon." Build order is s… |
| [ADR-012](./ADR-012-capability-level-architecture-no-vendor-lock-in.md) | Capability-level architecture; no vendor lock-in | All architecture documents describe capabilities (versioned file store, relational datastore, pub/sub broadcast, identity service, vector in… |
| [ADR-013](./ADR-013-12-tool-agent-endpoint-surface.md) | 12-tool agent endpoint surface | The agent-facing endpoint exposes exactly 12 tools at v1: register, heartbeat, deregister, get_context, find_similar, claim, update, release, a… |
| [ADR-014](./ADR-014-territory-contract-model-extended-to-non-code.md) | Territory + contract model, extended to non-code | Territories are named domains with owner_role, scope_kind, scope_pattern, contracts_published, contracts_consumed. Contracts are typed inter… |
| [ADR-015](./ADR-015-one-hive-many-projects.md) | One hive, many projects | A "hive" is one team's deployed infrastructure (one datastore + one endpoint + one set of deploys). A hive hosts multiple projects. Schema i… |
| [ADR-016](./ADR-016-two-orthogonal-substrates-sdlc-sync-coordination.md) | Two orthogonal substrates: SDLC sync + coordination | SDLC sync substrate (5 scripts, repo ↔ external tools, hours-to-days timescale) and coordination substrate (blackboard + 12-tool endpoint, s… |
| [ADR-017](./ADR-017-five-role-aware-lenses-at-atelier.md) | Five role-aware lenses at /atelier | The `/atelier` coordination route has five lenses at v1: analyst, dev, PM, designer, stakeholder. Each is a default-view configuration — sam… |
| [ADR-018](./ADR-018-triage-never-auto-merges.md) | Triage never auto-merges | External-sourced content (comments from published-doc system, delivery tracker, design tool) is classified and drafted into `kind=proposal` … |
| [ADR-019](./ADR-019-figma-is-feedback-surface-not-design-source.md) | Figma is feedback surface, not design source | Design components live in the prototype (repo-canonical). Figma receives projections of components. Comments on Figma projections flow back … |
| [ADR-020](./ADR-020-naming-atelier.md) | Naming: Atelier | The product is named `Atelier`. Vocabulary: the place is `atelier`, the verb is `contribute`, the unit is `contribution`, the inhabitants ar… |
| [ADR-021](./ADR-021-multi-trace-id-support-on-contributions-and-decisions.md) | Multi-trace-ID support on contributions and decisions | `contributions.trace_id` and `decisions.trace_id` become `trace_ids text[]`. Singular case is a one-element array. GIN indexes replace btree… |
| [ADR-022](./ADR-022-claim-atomic-creates-open-contributions.md) | Claim atomic-creates open contributions | `claim` overloads to support atomic create-and-claim when invoked with `contribution_id=null` plus `kind`, `trace_ids`, `territory_id`, and … |
| [ADR-023](./ADR-023-remote-surface-commits-via-per-project-endpoint-committer.md) | Remote-surface commits via per-project endpoint committer | Remote-surface composers (surface=web; terminal sessions without repo access) write to the repo via a per-project endpoint git committer. Commit… |
| [ADR-024](./ADR-024-transcripts-as-repo-sidecar-files-opt-in-by-config.md) | Transcripts as repo-sidecar files, opt-in by config | Agent-session transcripts are stored as sidecar files in the repo (e.g., `research/US-1.3-deploy-research.transcript.jsonl`). Schema gains `… |
| [ADR-025](./ADR-025-review-routing-keyed-by-territoryreview-role.md) | Review routing keyed by territory.review_role | Contributions transitioning to `state=review` are routed to lenses by `territories.review_role`. Default mappings: `strategy-research → pm`,… |
| [ADR-026](./ADR-026-atelier-owns-the-lock-fencing-implementation-switchman-not-a.md) | Atelier owns the lock + fencing implementation; Switchman not adopted | Atelier ships its own lock-and-fencing implementation in M2 of `../../strategic/BUILD-SEQUENCE.md` rather than integrating Switchman. Resolves D22 (`PRD-COM… |
| [ADR-027](./ADR-027-reference-implementation-stack-github-supabase-vercel-mcp.md) | Reference implementation stack: GitHub + Supabase + Vercel + MCP | The Atelier reference implementation uses GitHub (versioned file store), Supabase (Postgres + Realtime + Auth + pgvector for relational data… |
| [ADR-028](./ADR-028-identity-service-default-supabase-auth-byo-supported.md) | Identity service default: Supabase Auth (BYO supported) | Atelier's reference identity service is Supabase Auth. Resolves D23 (`../../functional/PRD-COMPANION.md`) and BRD-OPEN-QUESTIONS §5. Teams can override with … |
| [ADR-029](./ADR-029-reference-impl-preserves-gcp-portability-migration-mapping-d.md) | Reference impl preserves GCP-portability; migration mapping documented | The Atelier reference implementation (per ADR-027: Supabase + Vercel) is constrained at v1 to use only features with documented GCP equivale… |
| [ADR-030](./ADR-030-per-adr-file-split-decisionsmd-becomes-a-directory.md) | Per-ADR file split — DECISIONS.md becomes a directory | The single-file canonical decision log is split into one file per ADR. File naming: `ADR-NNN-<slug>.md`. Index lives in this README. Original `DECISIONS.md` removed; cross-references updated. |
| [ADR-031](./ADR-031-three-tier-consumer-model-specification-reference-implementa.md) | Three-tier consumer model: Specification, Reference Implementation, Reference Deployment | Atelier serves three distinct consumer intents, all first-class at v1, all open source, ordered by engagement depth. Standards-body labels a… |
| [ADR-032](./ADR-032-adopt-extended-documentation-structure-toolkit-derived-ateli.md) | Adopt extended documentation structure (toolkit-derived, Atelier-extended) | Canonical docs move from root-flat into a `docs/` tree derived from claude-docs-toolkit's seven audience layers, with three Atelier-specific… |

## Conventions

- Filename: `ADR-NNN-<slug>.md` (slug derived from title; lowercase; hyphenated)
- Frontmatter: `id`, `trace_id`, `category`, `session`, `composer`, `timestamp`, optional `reverses`
- Body: `# Title`, `**Summary.**`, `**Rationale.**`, `**Consequences.**`, optional `**Re-evaluation triggers.**`
- Append-only: existing files are not modified; reversals are new files
- Cross-references: from anywhere in the repo, link as `docs/architecture/decisions/ADR-NNN-<slug>.md`

## Vocabulary renames (recorded as notes, not ADRs)

Per the ADR-hygiene rule in `../../methodology/METHODOLOGY.md §6.1`, vocabulary refinements that just apply a consistency principle do not warrant their own ADR. These renames landed on **2026-04-26**:

| Old term | New term | Reason | Applied to |
|---|---|---|---|
| `fit_check` | `find_similar` | Name the operation, not the use case (consistent with `acquire_lock`, `log_decision`, etc.) | Protocol surface, all live docs. ADR-006 body preserved with original wording. |
| `Constitution` | `Charter` | Lighter metaphor; less politically loaded | Vocabulary tables, prose throughout. |
| `Locus` | `Surface` | Plain English; Latin loanword was obscure | Vocabulary tables, prose throughout. Schema field name `session.locus` preserved in ADR-009 / ADR-023 for historical accuracy; will be `session.surface` in M2 implementation. |
| `Dev/Analyst/PM/Designer Principal` | `Dev/Analyst/PM/Designer Composer` | Reconciled vocabulary: Composer = role-bearing participant; Principal = security-identity layer | PRD §3 personas. |

ADR files (append-only) reference the original terms; current docs use the new terms.
