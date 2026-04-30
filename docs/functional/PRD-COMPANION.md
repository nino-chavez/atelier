# PRD Companion: Open Decisions

**Status:** Draft v2.0
**Owner:** Nino Chavez
**Last updated:** 2026-04-26
**Related:** `PRD.md`, `../strategic/NORTH-STAR.md`, `BRD.md`, `../architecture/ARCHITECTURE.md`, `../architecture/decisions/`, `../strategic/STRATEGY.md`

---

## Purpose

This is the **staging area for design decisions that are OPEN or PROPOSED but not yet ADR'd**. When a decision lands and an ADR is written, the entry collapses to a single-line redirect to its ADR (see "Decided — redirect index" below).

For decided architectural choices, read the ADRs directly at `../architecture/decisions/`. The ADR log is canonical for both design-time decisions (after they land) and runtime decisions logged by the live system (per ADR-005, ADR-030).

PRD-COMPANION owns only what ADRs cannot: items still in flight.

---

## Open & Proposed decisions

### D24 — Embedding model default for find_similar

**Status:** OPEN

**Decision pending.** Default embedding-model choice for the find_similar vector index. Candidates:

- OpenAI `text-embedding-3-small` — adequate, cheap, external API
- Cohere Embed v3 — adequate, external API
- Self-hostable models (e.g., BGE-large-en) — eliminates external AI dependency for self-host compliance

**Constraint.** Swappability is the actual requirement (per ADR-012, vendor-neutrality). The default is a starting point, not a lock-in.

**Recommendation.** Benchmark ≥3 candidates against the labeled eval set drawn from this repo's own decisions corpus (per ADR-006). Pick the one that meets the precision/recall gate with the cleanest self-host story.

**Sequencing.** D24 must resolve before M5 of `../strategic/BUILD-SEQUENCE.md` begins (M5 ships find_similar; find_similar needs a chosen model). Recommend benchmarking during M3/M4 prep so M5 starts unblocked.

**Lands as.** A new ADR when the benchmark concludes.

---

## Decided — redirect index

These decisions landed as ADRs. Full rationale, alternatives, and consequences live in the linked ADR file. Entries are listed in chronological D# order; ADRs are numbered by the order they landed.

| D# | Decision | Outcome |
|---|---|---|
| D1 | Prototype is canonical artifact AND coordination dashboard | [ADR-001](../architecture/decisions/ADR-001-prototype-is-the-canonical-artifact-and-coordination-dashboa.md) |
| D2 | Contribution is the atomic unit | [ADR-002](../architecture/decisions/ADR-002-contribution-is-the-atomic-unit.md) |
| D3 | `scope_kind` generalized from day one | [ADR-003](../architecture/decisions/ADR-003-scope-kind-generalized-from-day-one.md) |
| D4 | Fencing tokens mandatory on all locks from v1 | [ADR-004](../architecture/decisions/ADR-004-fencing-tokens-mandatory-on-all-locks-from-v1.md) |
| D5 | Decisions write to repo first, datastore second | [ADR-005](../architecture/decisions/ADR-005-decisions-write-to-decisionsmd-first-datastore-second.md) |
| D6 | find_similar ships at v1 with eval harness + CI gate | [ADR-006](../architecture/decisions/ADR-006-fit-check-ships-at-v1-with-eval-harness-and-ci-gate.md) (ADR body uses original `fit_check` name; renamed to `find_similar` per Vocabulary Renames) |
| D7 | No multi-tenant SaaS; self-hosted OSS only | [ADR-007](../architecture/decisions/ADR-007-no-multi-tenant-saas-self-hosted-oss-only.md) |
| D8 | All 5 sync substrate scripts ship together | [ADR-008](../architecture/decisions/ADR-008-all-5-sync-substrate-scripts-ship-together.md) |
| D9 | Remote-principal actor class | [ADR-009](../architecture/decisions/ADR-009-remote-principal-actor-class-web-agents-as-first-class-compo.md) |
| D10 | Explicit exclusions enforce scope boundaries | [ADR-010](../architecture/decisions/ADR-010-explicit-exclusions-enforce-scope-boundaries.md) |
| D11 | Destination-first design; no feature deferral | [ADR-011](../architecture/decisions/ADR-011-destination-first-design-no-feature-deferral.md) |
| D12 | Capability-level architecture; no vendor lock-in | [ADR-012](../architecture/decisions/ADR-012-capability-level-architecture-no-vendor-lock-in.md) |
| D13 | 12-tool agent endpoint surface | [ADR-013](../architecture/decisions/ADR-013-12-tool-agent-endpoint-surface.md) |
| D14 | Territory + contract model extended to non-code | [ADR-014](../architecture/decisions/ADR-014-territory-contract-model-extended-to-non-code.md) |
| D15 | One guild, many projects (plural projects schema from v1) | [ADR-015](../architecture/decisions/ADR-015-one-hive-many-projects.md) (ADR body uses original `hive` term; renamed to `guild` per Vocabulary Renames) |
| D16 | Two orthogonal substrates: SDLC sync + coordination | [ADR-016](../architecture/decisions/ADR-016-two-orthogonal-substrates-sdlc-sync-coordination.md) |
| D17 | `/atelier` coordination route inside the prototype | Implementation consequence of D1; covered by [ADR-001](../architecture/decisions/ADR-001-prototype-is-the-canonical-artifact-and-coordination-dashboa.md) (no separate ADR) |
| D18 | Five role-aware lenses | [ADR-017](../architecture/decisions/ADR-017-five-role-aware-lenses-at-atelier.md) |
| D19 | MCP as v1 reference protocol | Covered by [ADR-013](../architecture/decisions/ADR-013-12-tool-agent-endpoint-surface.md) (no separate ADR; spec stays protocol-agnostic) |
| D20 | Triage never auto-merges | [ADR-018](../architecture/decisions/ADR-018-triage-never-auto-merges.md) |
| D21 | Figma is feedback surface, not design source | [ADR-019](../architecture/decisions/ADR-019-figma-is-feedback-surface-not-design-source.md) |
| D22 | Switchman as dependency for file-level locks | [ADR-026](../architecture/decisions/ADR-026-atelier-owns-the-lock-fencing-implementation-switchman-not-a.md) (own-implementation; Switchman not adopted) |
| D23 | Identity service default | [ADR-028](../architecture/decisions/ADR-028-identity-service-default-supabase-auth-byo-supported.md) (Supabase Auth default; BYO via OIDC) |
| D24 | Embedding model default for find_similar | **OPEN** — see Open & Proposed above |
| D25 | Naming: Atelier | [ADR-020](../architecture/decisions/ADR-020-naming-atelier.md) |
| D26 | Multi-trace-ID support on contributions and decisions | [ADR-021](../architecture/decisions/ADR-021-multi-trace-id-support-on-contributions-and-decisions.md) |
| D27 | `claim` atomic-creates open contributions | [ADR-022](../architecture/decisions/ADR-022-claim-atomic-creates-open-contributions.md) |
| D28 | Remote-surface commits via per-project endpoint git committer | [ADR-023](../architecture/decisions/ADR-023-remote-locus-commits-via-per-project-endpoint-committer.md) |
| D29 | Transcripts as repo-sidecar files, opt-in by config | [ADR-024](../architecture/decisions/ADR-024-transcripts-as-repo-sidecar-files-opt-in-by-config.md) |
| D30 | Review routing keyed by `territory.review_role` | [ADR-025](../architecture/decisions/ADR-025-review-routing-keyed-by-territoryreview-role.md) |
| D31 | Reference implementation stack: GitHub + Supabase + Vercel + MCP | [ADR-027](../architecture/decisions/ADR-027-reference-implementation-stack-github-supabase-vercel-mcp.md) |
| D32 | Reference impl preserves GCP-portability | [ADR-029](../architecture/decisions/ADR-029-reference-impl-preserves-gcp-portability-migration-mapping-d.md) |
| D33 | Per-ADR file split — DECISIONS.md becomes a directory | [ADR-030](../architecture/decisions/ADR-030-per-adr-file-split-decisionsmd-becomes-a-directory.md) |
| D34 | Three-tier consumer model | [ADR-031](../architecture/decisions/ADR-031-three-tier-consumer-model-specification-reference-implementa.md) |
| D35 | Adopt extended documentation structure (toolkit-derived, Atelier-extended) | [ADR-032](../architecture/decisions/ADR-032-adopt-extended-documentation-structure-toolkit-derived-ateli.md) |
| D36 | Contribution.kind scoped to output discipline (drop proposal, drop decision) | [ADR-033](../architecture/decisions/ADR-033-contribution-kind-scoped-to-output-discipline.md) |
| D37 | Contribution lifecycle state separated from blocked status flag | [ADR-034](../architecture/decisions/ADR-034-contribution-state-separated-from-blocked-status-flag.md) |
| D38 | Contract metadata covers ARCH 6.6.1 classifier surface | [ADR-035](../architecture/decisions/ADR-035-contract-metadata-covers-arch-661-classifier-surface.md) |
| D39 | Immortal author identity via composer_id; session_id is operational only | [ADR-036](../architecture/decisions/ADR-036-immortal-author-identity-via-composer-id.md) |
| D40 | Decisions table cleanup: drop "convention" category, add triggering-contribution link | [ADR-037](../architecture/decisions/ADR-037-decisions-table-cleanup-drop-convention-add-contribution-link.md) |
| D41 | Composer role split into discipline + access_level (architect added as first-class discipline) | [ADR-038](../architecture/decisions/ADR-038-composer-role-split-into-discipline-plus-access-level.md) |
| D42 | Plan-review state added to contribution lifecycle (per-territory opt-in, default off) | [ADR-039](../architecture/decisions/ADR-039-plan-review-state-in-contribution-lifecycle.md) |

D36–D40 surfaced by the pre-M1 data-model audit (`../architecture/audits/pre-M1-data-model-audit.md`); D41 by the 2026-04-28 expert review prompted same-day resolution of BRD-OPEN-QUESTIONS section 20. D42 by the 2026-04-30 architect-of-record strategic call on BRD-OPEN-QUESTIONS section 19; lands prior to M2 implementation per ADR-011 destination-first.

D26–D30 were surfaced by the analyst-week-1 walk (`../architecture/walks/analyst-week-1.md`).

---

## How this doc evolved

Originally PRD-COMPANION carried full rationale, alternatives, and consequences for every design decision (D1–D35), most of which had landed as ADRs. The duplication created two failure modes: drift (the two sources disagreeing over time) and archaeology (predecessor-project framing — *"hackathon-hive does X, so we do Y"* — that aged poorly once Atelier became its own thing).

On 2026-04-26 the DECIDED entries collapsed to single-line redirects in the index above. PRD-COMPANION now owns only what ADRs structurally cannot: items still OPEN or PROPOSED. The D# numbering is preserved so cross-references from elsewhere in the repo (BUILD-SEQUENCE, traceability.json, ADR bodies that say "Resolves D22") still resolve.

This change is recorded here rather than as an ADR per the ADR-hygiene rule in `../methodology/METHODOLOGY.md §6.1` — it's doc cleanup applying a separation principle, not a load-bearing architectural decision.

---

## References

- `../architecture/decisions/` — append-only canonical ADR log (the rationale archive)
- `../strategic/NORTH-STAR.md` — destination spec
- `../strategic/STRATEGY.md` — market / competitive context
- `PRD.md` — product requirements
- `BRD.md` — stories with trace IDs
- `../architecture/ARCHITECTURE.md` — capability-level architecture
- `BRD-OPEN-QUESTIONS.md` — non-decision open items (e.g., scale envelopes, upgrade semantics)
