---
id: ADR-045
trace_id: BRD:Epic-2
category: architecture
session: m6-strategic-call-2026-05-01
composer: nino-chavez
timestamp: 2026-05-01T00:00:00Z
---

# Extend `get_context` with `scope_files` parameter for pre-claim file-overlap awareness

**Summary.** `get_context` gains an optional `scope_files: string[]` parameter. When provided, the response is filtered to active coordination state (presence, claims, locks) intersecting the supplied file scope. This is the substrate-level surface for "before I claim work touching these files, who else is currently active there?" — a coordination capability that locks (post-claim mutex per ADR-004) and `find_similar` (semantic similarity per ADR-006) collectively did not address. The capability does NOT add a 13th MCP tool; it extends `get_context` per the existing 12-tool surface lock (ADR-013 + ADR-040).

**Rationale.**

The capability gap surfaced 2026-05-01 during the M6 strategic re-evaluation of `find_similar`'s utility. Audit of the predecessor projects (hackathon-hive, hive-dashboard) confirmed neither had a "fit_check" or analogous semantic-similarity tool — coordination there was via atomic `claim` (one composer per task) + `acquire_lock` (one writer per file). Atelier inherited both patterns. The find_similar primitive in ADR-006 was an Atelier-specific addition framed as semantic duplicate detection, NOT file-overlap awareness.

**The unfilled gap.** Atelier's locks fire AFTER claim — they prevent two writers, but they do not surface "this file has activity adjacent to your intended scope" BEFORE the composer commits to the claim. A composer about to start work has no canonical query for "what's happening adjacent to my intended files." The information exists across `presence`, `locks`, `contributions.artifact_scope` — but no single surface composes them for the natural pre-claim question.

**Why extend `get_context` rather than add a new tool.** Per the check-existing-primitives discipline + ADR-013/040's 12-tool surface lock:

1. The capability is structurally a `get_context` query — it asks "what is the current coordination state, filtered by file scope" — which is exactly `get_context`'s purpose, just with a new filter axis.
2. Adding a 13th tool would amend ADR-013/040's compile-time-enforced lock; the cost (spec amendment + tool surface inflation) is not justified when an existing tool's parameter set covers the shape.
3. Composers already know to call `get_context` for "what's happening" — adding `scope_files` as a filter is a natural extension, not a new concept to learn.
4. The implementation is a single SQL query folded into `get_context`'s existing handler, joining `contributions` + `locks` + `composers` filtered by `artifact_scope` array intersection (`&&` operator on Postgres `text[]`).

**Why this isn't `find_similar`.** The two capabilities answer different questions:

| | `find_similar` (semantic) | `get_context(scope_files)` (overlap) |
|---|---|---|
| Question | "Is the work I'm proposing semantically similar to existing work?" | "Who is currently active on the files I intend to touch?" |
| Input | Free-form description text | Concrete file path patterns |
| Computation | Vector embedding + kNN against indexed corpus | SQL array intersection over active state |
| Cost | OpenAI embedding API call + pgvector kNN | Single SQL query |
| Determinism | Embedding-model-dependent; subject to noise | Deterministic given same active state |
| Failure mode | Degraded: keyword fallback or NoopEmbedder | None substantive (failed query → standard error) |
| When useful | "Have we discussed this kind of thing before?" | "Is anyone touching these files right now?" |

Both ship at v1; both surface different signals; neither replaces the other.

**Decision.**

The `get_context` signature extends to:

```
get_context(
  trace_id?:              string | string[],
  since_session_id?:      string,
  lens?:                  string,
  kind_filter?:           string[],
  charter_excerpts?:      boolean,
  with_contract_schemas?: boolean,
  scope_files?:           string[]              // NEW — filter active state by file-scope intersection
) → ContextResponse
```

When `scope_files` is provided, `ContextResponse` carries a new section:

```
overlapping_active: {
  contributions: [
    {
      id, kind, state, composer_id, composer_display_name,
      artifact_scope,                     // the contribution's full scope
      overlapping_files: string[],        // intersection with the queried scope_files
      since: <timestamp>                  // when the contribution entered claimed/in-flight state
    },
    ...
  ],
  locks: [
    {
      id, contribution_id, holder_composer_id, holder_display_name,
      artifact_scope,
      overlapping_files: string[],
      acquired_at: <timestamp>,
      ttl_remaining_seconds: <integer>
    },
    ...
  ]
}
```

The `overlapping_active` section is empty arrays (not absent) when `scope_files` is supplied but no active overlaps exist — composers can rely on the section's presence to indicate they queried for it.

When `scope_files` is omitted, the `overlapping_active` section is absent from the response (preserves current `get_context` behavior for callers not using the new parameter).

**Implementation surface.**

- ARCH §6.7 extended with `scope_files` parameter + `overlapping_active` response section
- `scripts/endpoint/lib/handlers.ts:getContext` extended with the SQL query (single query joining `contributions` + `locks` + `composers` with `artifact_scope && $scope_files`)
- `prototype/src/lib/atelier/lens-data.ts` — lenses that surface "what's happening adjacent to me" can pass current claim's intended scope_files
- Smoke test extension in `scripts/endpoint/__smoke__/endpoint.smoke.ts` — covers empty result, single overlap, multiple overlaps, no-scope-files (backward-compat), invalid file pattern (BAD_REQUEST)

**Consequences.**

- **Composers gain a canonical surface for pre-claim coordination.** Before claiming work touching files X, Y, the composer (or their agent) calls `get_context({scope_files: ["X", "Y"]})` and sees who's currently active on those files.
- **The 12-tool surface lock holds.** No tool added; `get_context`'s parameter set extends.
- **find_similar's role narrows + sharpens.** find_similar is now unambiguously the semantic-similarity surface (search aid, advisory at v1 per ADR-043). Pre-claim file-overlap is `get_context`'s job. Two capabilities, two clear roles, no overlap.
- **No new external dependencies.** SQL-only; no embeddings, no OpenAI, no eval gate. Works offline. Works with `find_similar.embeddings` configured to NoopEmbedder.
- **Cost: small.** Single SQL query per `get_context` call when `scope_files` is supplied. The `contributions.artifact_scope` GIN index that supports lock overlap detection (per ARCH §5.2) also serves this query.

**Trade-offs considered and rejected.**

| Option | Why rejected |
|---|---|
| **New 13th MCP tool (`check_overlap`, `active_on`, `fit_check`, etc.)** | Breaks the 12-tool surface lock from ADR-013 + ADR-040. The capability doesn't justify the spec inflation when `get_context` already handles "what's the current state" queries. Naming was also misleading: `fit_check` echoes the former `find_similar` name (re-conflating two distinct capabilities); generic names (`check_overlap`) duplicate `get_context`'s purpose under a different label. |
| **Field on `claim()` response (`existing_overlaps` in `similar_warnings`)** | Wrong flow ergonomics. Composer would have to claim FIRST, then see overlaps, then maybe release — more friction than scout-then-claim. The `similar_warnings` field on `claim()` stays for find_similar's semantic warnings (its current purpose); file-overlap is a pre-claim concern, not a post-claim warning. |
| **Panel-only in `/atelier` (no MCP surface)** | Excludes agent-driven workflows. An agent considering a claim cannot query `/atelier`'s rendered HTML; it needs an MCP tool surface. The agent surface is the load-bearing one for the pre-claim question because agents make most claim decisions in v1 mixed-team workflows per ADR-009. |
| **Defer to v1.x** | Per ADR-011 destination-first, "we know we need this and it's small" should ship at v1. The implementation is a single SQL query + signature extension; the cost is bounded; the value to composer ergonomics is meaningful. Deferring would be exactly the "Phase 2 / coming soon" pattern ADR-011 prohibits. |

**Reverse / revisit conditions.**

- If real-use data shows composers don't actually query `scope_files` (because they don't know their file scope pre-claim, or because the social layer covers it), the parameter stays as documented capability but is operationally ignored. Doesn't reverse the ADR; just informs M7 polish on whether to surface the affordance more aggressively in lens UIs.
- If a future tool surfaces a need to query overlapping active state by NON-file scope (territory, trace_id, contract dependency, etc.), `get_context`'s `scope_files` parameter generalizes — consider renaming to `overlap_filter` with multiple axis support. Land as amending ADR if/when the second axis is contributed.
- If file-overlap awareness becomes load-bearing enough that it warrants its own tool (high-frequency calls justifying a dedicated wire-level surface, observability separation, etc.), consider promoting at v1.x with an ADR amendment to ADR-013/040's surface lock. Do NOT pre-promote at v1.

**Surfaces alongside this ADR (not in this ADR's scope).**

The same M6-strategic-call session that produced this ADR also recalibrated find_similar's role and the eval gate's CI behavior. Those changes are NOT decisions — they are doc corrections + an implementation alignment to existing decisions:

- STRATEGY.md, NORTH-STAR.md, BRD.md, ARCH.md realignments demoting find_similar from "the wedge" to "one capability among several" — direct doc edits per the ADR hygiene test (no new decision).
- ADR-006 frontmatter amendment recording the wedge-framing demotion — same rationale.
- `.atelier/config.yaml` + `.github/workflows/atelier-audit.yml` flipping the eval gate to informational — implementation alignment to ADR-043's existing advisory-tier framing.

These land in the same PR as this ADR for cohesion (the strategic correction is one shape that touches multiple files), but only the `get_context` extension itself is the new decision.
