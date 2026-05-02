# scripts/

Substrate and tooling scripts that run outside the prototype web app.

## Structure

The sync substrate landed at M1 step 4.iii (commit history). The traceability
substrate lands later in M1 (step 4.v exit gate prep). All TypeScript; entry
points use `npx tsx` shebangs so they run directly without compilation.

```
scripts/
├── traceability/             # Registry generation + link injection (not yet implemented)
│   ├── build-registry.ts     # Scan docs + emit traceability.json
│   ├── inject-links.ts       # Inject trace-ID callouts into markdown
│   ├── validate-refs.ts      # Pre-commit check: every trace ID resolves
│   └── schema.json           # JSON schema for traceability.json (graph-ready per below)
└── sync/                     # The 5-script sync substrate (all v1; M1 step 4.iii)
    ├── lib/
    │   ├── write.ts          # Internal write library (M1 step 4.ii); claim / update / release / logDecision
    │   ├── event-bus.ts      # In-memory typed event bus; trigger-source-agnostic per "publish-delivery trigger model" below
    │   └── adapters.ts       # External-system adapter interfaces + registry; M1 ships noop adapter, M2 step 4.iv adds GitHub
    ├── publish-docs.ts       # repo doc → published-doc system
    ├── publish-delivery.ts   # contribution state → delivery tracker (polling source + bus subscriber)
    ├── mirror-delivery.ts    # delivery tracker → registry (nightly)
    ├── reconcile.ts          # bidirectional drift detector + branch-reaping pass (default-off per BRD-OPEN-QUESTIONS section 24)
    └── triage/
        ├── classifier.ts     # external comment → category (heuristic v1; LLM seam for v1.x)
        ├── drafter.ts        # classified comment → proposal draft
        └── route-proposal.ts # drafted proposal → contribution with kind=<discipline> + requires_owner_approval=true (per ADR-033)
```

## Traceability registry: graph-ready from M1

`traceability.json` ships as an adjacency-list-shaped graph from M1, even though v1 query patterns treat the corpus as flat. The shape:

```jsonc
{
  "$schema": "./scripts/traceability/schema.json",
  "generated_at": "<iso8601>",
  "project_id": "<uuid>",
  "project_name": "<string>",
  "template_version": "<semver>",
  "counts": { ... },              // unchanged from existing shape
  "entries": [                    // nodes in the graph
    {
      "id": "BRD:Epic-1",
      "label": "Project scaffolding & lifecycle",
      "kind": "brd-epic",
      "docPath": "docs/functional/BRD.md",
      "docUrl": "#epic-1--project-scaffolding--lifecycle",
      "prototypePages": []
    },
    ...
  ],
  "edges": [                      // edges in the graph; populated by build-registry.mjs at M1
    { "from": "ADR-033", "to": "BRD:Epic-2", "rel": "implements" },
    { "from": "US-2.4", "to": "ADR-013", "rel": "depends_on" },
    { "from": "ADR-033", "to": "BRD-OPEN-QUESTIONS:section-20", "rel": "supersedes" },
    ...
  ]
}
```

**Edge relations at v1:**
- `implements` -- ADR or contribution implements a BRD story / epic
- `depends_on` -- entry references another entry as a precondition
- `supersedes` -- new entry replaces an old one (e.g., ADR-033 supersedes the kind=proposal mechanism in ADR-018)
- `derives_from` -- entry was authored in response to another (e.g., a strategy addendum derives from a referenced external source)

**Why graph-ready at M1:** v1 find_similar treats the corpus as flat semantic vectors. v1.x graph-aware find_similar (see strategy addenda) re-ranks results by graph proximity to the query's trace_id. If `traceability.json` is flat at M1, the v1.x feature is a schema migration + data backfill. If `traceability.json` is graph-ready at M1, it's a retrieval-layer addition only. Cost difference: ~zero now vs. one milestone of M1 work later. Recommendation surfaced by 2026-04-28 expert review.

**Edges are derived, not authored.** `build-registry.mjs` infers edges from frontmatter (`trace_id` -> implements; `reverses` -> supersedes; cross-references in body text -> depends_on). Authors do not hand-edit edges.

## Status

Pre-implementation scaffold. See `BRD.md` Epic 9 (sync substrate) and Epic 10 (external integrations) for the full spec.

## Rules of the road

- **Publishes are full overwrites with banners** per `NORTH-STAR.md` §8.
- **Pulls are probabilistic, human-gated.** Never auto-writes back to repo.
- **Triage never auto-merges** per ADR-020.
- **Adapter interface** is uniform across external-system classes (delivery trackers, doc systems, design tools). New adapters implement the interface; sync scripts don't branch on provider.

---

## Round-trip integrity contract (M1 exit gate)

Per `docs/strategic/BUILD-SEQUENCE.md` §5 M1 exit criteria, the sync substrate must satisfy: **markdown → datastore → projector → markdown is byte-identical** for the canonical doc classes. "Byte-identical" requires a precise contract — otherwise trivial normalizations produce false drift signals while real divergences slip through.

### Doc classes in scope

| Doc class | Path pattern | Parser | Projector | Permitted normalizations |
|---|---|---|---|---|
| ADR file | `docs/architecture/decisions/ADR-NNN-*.md` | YAML frontmatter + Markdown body | YAML frontmatter (key order: `id, trace_id, category, session, composer, timestamp, reverses?`) + Markdown body verbatim | Trailing newline addition; YAML key order canonicalized to the listed sequence |
| Territories config | `.atelier/territories.yaml` | YAML | YAML with stable key order per entry (`name, owner_role, review_role, scope_kind, scope_pattern, contracts_published, contracts_consumed, description`) | Trailing newline; key order canonicalized |
| Project config | `.atelier/config.yaml` | YAML | YAML preserving the template's section order; comments preserved | Trailing newline; comment preservation required (use a YAML library that round-trips comments) |
| Traceability registry | `traceability.json` | JSON | JSON with 2-space indent, top-level key order [`$schema`, `generated_at`, `project_id`, `project_name`, `template_version`, `counts`, `entries`, `edges`]; per-entry key order [`id`, `label`, `kind`, `docPath`, `docUrl`, `prototypePages`, `adr`, `source`, `status`, `note`]; per-edge key order [`from`, `to`, `rel`] | Trailing newline; top-level + per-entry + per-edge key order canonicalized |
| BRD story regions | `docs/functional/BRD.md` US-X.Y blocks | Markdown headings + structured story format | Markdown verbatim within story bounds | Trailing newline only |
| PRD-COMPANION decision entries | `docs/functional/PRD-COMPANION/*.md` (OPEN/PROPOSED) | Markdown with structured decision header | Markdown verbatim | Trailing newline only |

### What is NOT a permitted normalization

- Any change to ADR body text (titles, sections, prose)
- Any change to BRD story IDs, acceptance criteria text, or NFR text
- Any change to `traceability.json` `entries[]` contents
- Any reordering of array elements (territories list, traceability entries)
- Any whitespace change inside a code block
- Any line-ending change other than the file's existing convention

### Test shape

`scripts/test/roundtrip.mjs` (lands at M1):
1. For each doc class above, enumerate matching files.
2. Parse → write to staging datastore → re-render via projector.
3. Diff against original, applying only the permitted normalizations from the table.
4. Fail on any remaining difference; report as `<file>: <hex offset> expected <byte> got <byte>`.

CI gate: runs on every PR; blocks merge if any canonical doc fails round-trip.

### Adding a doc class

A PR that adds a new doc class to the round-trip set must:
1. Add the row to the table above.
2. Define the parser, projector, and permitted normalization set explicitly.
3. Include at least one round-trip test fixture.
4. Be merge-approved by an `architect` role composer.

The contract is the source of truth -- the test reads from this table at run time (or asserts that its hardcoded list is consistent with the table; M1 implementation chooses).

---

## publish-delivery trigger model

`publish-delivery` (per ARCH section 6.5) fires on contribution state transitions (`claimed` and beyond). The trigger mechanism evolves across milestones to avoid pulling later substrate work forward into M1:

| Milestone | Trigger mechanism | Why |
|---|---|---|
| **M1** | Polling. A cron job runs `publish-delivery` every `policy.publish_delivery_poll_interval_seconds` (default 60) and scans `contributions` for rows where `updated_at > last_run AND state in (claimed, in_progress, review, merged, blocked)`. | The endpoint surface is not yet live (lands at M2). The broadcast substrate is not yet live (lands at M4). Polling is the only mechanism that works against M1's direct-DB-write substrate without pulling future capabilities forward. |
| **M2** | Post-commit hooks via endpoint write path. Every `claim` / `update` / `release` call that changes contribution state invokes `publish-delivery` synchronously after the DB transaction commits. The polling cron remains as a safety-net catch-up but scans `WHERE last_synced_at < updated_at - 300s` (5-minute lag triggers catch-up sync). | The endpoint becomes the canonical write path; hooking into it gives near-real-time delivery sync without polling overhead. The catch-up cron handles the rare hook-fired-but-sync-failed case. |
| **M4** | Broadcast subscription via `BroadcastService` (per ADR-029). `publish-delivery` becomes a long-running subscriber to `contribution.state_changed` events; the cron is removed. | The broadcast substrate is the canonical event bus; subscriptions are the right abstraction once it exists. Removing the cron eliminates the periodic load. |

**Cutover discipline.** Each cutover is a one-line change to the trigger registration in `scripts/sync/publish-delivery.mjs` (or its successor) -- not a rewrite of the publish logic. The script's input contract (a `ContributionStateChange` event) is identical at every milestone; only the source of the event changes. This is what makes the milestone progression non-destructive.

**Implementation pattern: internal event bus from M1 onward.** To make the cutover claim above actually one-line rather than "small refactor": M1's polling implementation publishes detected state changes to an in-memory event bus (`scripts/sync/lib/event-bus.ts`), and `publish-delivery` is registered as a subscriber. At M2, the endpoint's post-commit hook publishes to the same bus. At M4, `BroadcastService` events (per ARCH 6.8) are bridged into the same bus by a thin `subscribe -> bus.publish` adapter. The `publish-delivery` subscriber code does not change across milestones; only the bus's source-of-events changes. This is what the "one-line cutover" actually requires under the hood, and M1 must establish this pattern up front to honor the claim.

---

## Throwaway-branches convention (per-contribution branch lifecycle)

In an AI-speed reality where agents may try N variants of an implementation before settling on one, the per-contribution branch in the remote repo can become a flood of discarded iterations. To keep `git log` and the contribution branch readable:

**Convention.** Agents work in **ephemeral local branches** (e.g., `<contribution_kind>/<trace>-<short>--draft-<n>`) when iterating on multiple variants. Only the accepted variant is force-pushed to the canonical contribution branch (`<contribution_kind>/<trace>-<short>` per ARCH 6.2.2.1) at the moment the agent calls `update(state="review")`.

**Why force-push, not merge.** Merging N draft branches into one canonical branch produces a noisy history with abandoned iterations interleaved. Force-pushing the accepted variant to the contribution branch produces clean history that reads as the agent's final intent. The **forensic record** of the iteration process lives in `transcript_ref` (per ADR-024) -- transcripts capture every variant the agent tried plus its reasoning, in append-only sidecar files that survive force-push.

**Endpoint enforcement.** The push-handler in ARCH 6.2.2.1 only updates `commit_count` and `last_observed_commit_sha` on the canonical contribution branch; pushes to draft-suffix branches are ignored (the endpoint sees them but does not record them in `contributions`). This prevents "ghost commits" from appearing in observability.

**Squash-on-merge to main.** When the contribution merges via PR (per ARCH 6.2.3), the merging admin chooses squash by convention (no enforcement at the protocol layer; teams that prefer merge-commits can override). The squash combines the agent's final iteration into one commit on `main`, attributed via Co-Authored-By per section 7.8 attribution rules. The contribution branch is deleted post-merge.

**Surfaced by:** 2026-04-28 AI-speed red-team pivot (Ghost Implementation Surge gap).

**Reaping rejected/orphaned contribution branches.** The happy-merge case deletes the contribution branch post-PR-squash. The rejected-contribution and orphaned-branch cases (e.g., agent creates branch, contribution gets `state=rejected`, branch lingers; or session reaping cascade-deletes the contribution row, leaving an orphan branch) are handled by `reconcile.ts`'s branch-reaping pass: lists `atelier/*` branches whose last-commit age exceeds `ATELIER_RECONCILE_BRANCH_REAPING_MAX_AGE_DAYS` (default 30) AND whose contribution_id either resolves to a `merged` or `rejected` row OR does not resolve at all. Off by default per `ATELIER_RECONCILE_BRANCH_REAPING_ENABLED=false`; dry-run by default when enabled (`--reap-branches --apply` to actually delete). Branch enumeration + deletion go through the delivery adapter's optional `listManagedBranches` / `deleteRemoteBranch` methods (M1 noop adapter returns an empty list; M2 GitHub adapter calls the GitHub branch API). Resolved per BRD-OPEN-QUESTIONS section 24 during M1 step 4.iii.

**Invariants across milestones.**
- `last_synced_at` on the contribution row is updated atomically with the external upsert; replay on retry is idempotent on `(contribution_id, external_issue_url)`.
- Adapter calls are bounded by `adapter.timeout_seconds` (default 30); adapter failures are logged but do not block subsequent contributions.
- Failed syncs surface in `/atelier/observability` (per ARCH section 8.2) regardless of trigger mechanism.

---

## Extended cross-doc consistency (M1 traceability validator scope)

The traceability validator (`scripts/traceability/validate-refs.mjs`) catches cross-doc drift before it accumulates. The original scope was "every trace ID resolves." M1 ships the extended scope below, operationalizing the per-PR review and milestone-exit drift sweep specified in METHODOLOGY section 11.

### Check classes

| Check | What it verifies | Failure example |
|---|---|---|
| `trace_id_resolution` | Every trace ID referenced anywhere in `docs/`, `prototype/`, `research/`, `.atelier/` resolves to an entry in `traceability.json` | A doc cites a trace ID like `US-XX.YY` (where XX.YY is a placeholder) that does not resolve to a real BRD story |
| `arch_section_resolution` | Every reference in the form `ARCH section X.Y[.Z]`, `ARCHITECTURE.md section X.Y[.Z]`, or `section X.Y[.Z]` (in a context that names ARCH) resolves to a real heading in `docs/architecture/ARCHITECTURE.md` | A walk references `section 6.4.5` that was never written |
| `adr_id_resolution` | Every reference in the form `ADR-NNN` resolves to a real file under `docs/architecture/decisions/` | CLAUDE.md cites `ADR-040` that doesn't exist |
| `contract_name_resolution` | Every name listed in `.atelier/territories.yaml: contracts_published` or `contracts_consumed` is defined in `docs/architecture/schema/contracts/<name>-v*.yaml` (post-M2 when the schema dir populates) | A territory consumes `feature_scope` but no contract file defines it |
| `walk_fold_resolution` | Every "folded into" reference in a walk's gaps table resolves to a real ARCH subsection | A walk says "folded into section 7.4.3" but that subsection doesn't exist |
| `markdown_link_integrity` | Every relative markdown link in canonical docs resolves to a real file or anchor | a relative link to `../strategic/BUILD-SEQENCE.md` (typo: missing the second "U") -- flagged |
| `adr_reeval_trigger_check` | Each ADR with a `Re-evaluation triggers` section is checked against the trigger conditions; matched triggers are reported | An ADR's trigger says "if X publishes a fencing-token API" -- the check polls the documented external repo for evidence |
| `open_questions_hygiene` | Each OPEN entry in BRD-OPEN-QUESTIONS is examined: is the recommendation a spec? If yes, the entry is flagged for fold-in (per the spec-gap-vs-real-question test in METHODOLOGY 6.1) | An OPEN entry has a clear "Recommendation" with three concrete bullets but no genuine alternative -- flagged |
| `traceability_coverage` | Every BRD story has at least one resolution path: an ADR cites it, a contribution carries it, or implementation code cites it (M2+) | US-2.7 has no ADR, no contribution, and no code citation -- flagged for either work or scope removal |
| `frontmatter_validation` | ADRs and other frontmatter-bearing files have required fields (`id`, `trace_id`, `category`, etc.) and well-formed values | An ADR is missing the `composer` field |
| `operational_completeness` | For each spec'd capability with a user-facing surface, a corresponding user-docs runbook exists under `docs/user/`. The mapping is declared in `.atelier/config.yaml: review.validator.operational_completeness_map`. | A new external integration adapter ships at M1.5 but no `docs/user/integrations/<provider>.md` runbook exists for it; or a new MCP client appears in BRD/ARCH but no `docs/user/connectors/<client>.md` |
| `semantic_contradiction` | (RESERVED at v1; implementation v1.x per BRD-OPEN-QUESTIONS section 22). When enabled via `review.semantic_contradiction.enabled: true` in `.atelier/config.yaml`, an LLM-backed check compares PR content against the configured anchor docs (NORTH-STAR, STRATEGY, PRD, ARCHITECTURE, ADR index) and flags potential contradictions. Adapter pattern matches ADR-041 (OpenAI-compatible `/v1/chat/completions`); adopters override `base_url` + `model_name` to swap providers. v1 default `enabled: false` keeps validator behavior unchanged | A new ADR's rationale contradicts NORTH-STAR §14 (e.g., proposes a feature in the explicit-exclusions list); an LLM-flagged finding with citations cross-referenced to the anchor doc |

### CI integration

The validator runs in three modes via flags:

- **`--diff`** / **`--staged`** (run by the author during writing, before commit, via `atelier audit --diff` or `--staged`): same check classes as `--per-pr` but scoped to uncommitted (`--diff`) or staged (`--staged`) changes only. Designed to complete in under 2 seconds against a typical diff. Intent: fast feedback while authoring, not just at PR boundary. Catches the AI-speed drift class where new content cites trace IDs / ARCH sections / ADR ids that don't exist before the commit lands. Output identical to `--per-pr`. Optional but recommended as a pre-commit hook.

- **`--per-pr`** (run on every PR via `.github/workflows/atelier-audit.yml`): trace_id_resolution + arch_section_resolution + adr_id_resolution + walk_fold_resolution + markdown_link_integrity + frontmatter_validation. Fast (under 10 seconds for typical projects). Hard-fails the PR on any check failure.

- **`--milestone-exit`** (run by the architect at milestone-status-to-Done transition via `atelier audit --milestone-exit`): all checks plus contract_name_resolution + open_questions_hygiene + traceability_coverage + adr_reeval_trigger_check + operational_completeness. Produces the audit report at `docs/architecture/audits/milestone-<id>-exit.md` per METHODOLOGY 11.3.

- **`--quarterly`** (run by cron via `.github/workflows/atelier-quarterly.yml`): adr_reeval_trigger_check + a fresh traceability_coverage report. Posts the result to the configured messaging adapter (Slack/Teams/Discord per `.atelier/config.yaml: integrations.messaging`) for the architect + pm to discuss.

### Output format

Per check, the validator emits structured JSON when invoked with `--json` and a human-readable summary by default:

```
$ atelier audit --per-pr
trace_id_resolution        OK    (95 stories, 33 ADRs, 18 open questions all resolve)
arch_section_resolution    OK    (140 references checked)
adr_id_resolution          OK    (32 distinct ADR IDs cited; all resolve)
walk_fold_resolution       OK    (21 fold references checked across 3 walks)
markdown_link_integrity    OK    (412 links checked)
frontmatter_validation     OK    (33 ADRs validated)

PASS: all 6 checks succeeded
```

Failures include source location and a fix suggestion:

```
arch_section_resolution    FAIL  docs/architecture/walks/dev-week-1.md:148
                                 References "section 7.4.5" but ARCHITECTURE.md has no such heading
                                 Suggested fixes:
                                   - Did you mean "section 7.4.2"?
                                   - Or add the missing subsection to ARCHITECTURE.md
```

### Extension hooks

Teams may add project-specific check classes by dropping a script under `scripts/traceability/checks/<check_name>.mjs` that exports the check function and registering it in `.atelier/config.yaml: review.validator.custom_checks: [<check_name>]`. Custom checks run alongside the bundled set in the configured mode (`per_pr` / `milestone_exit` / `quarterly`).

### Implementation note on adr_reeval_trigger_check

The `Re-evaluation triggers` section format in ADRs is intentionally human-readable, not machine-parseable. The check's MVP at M1 is: enumerate ADRs with a `Re-evaluation triggers` section and surface the list to the architect with a prompt -- "review whether any of these triggers have fired." Automated trigger detection (parsing trigger conditions and polling external sources) is a v1.x extension. The reminder is the value at v1; the automation is a stretch.

## YAML lint (`scripts/lint/yaml-lint.ts`)

A Node-only YAML 1.2 linter that runs in the PR CI gate. Closes the PR #10 follow-up: a colon-in-step-name silently broke `.github/workflows/atelier-audit.yml` parsing on GitHub Actions for several weeks before the hot-fix landed. The linter catches the class.

**Scope:**

- `.github/workflows/*.yml` and `*.yaml`
- `.atelier/*.yaml` and `*.yml`

The target list is an explicit allowlist in `scripts/lint/yaml-lint.ts:TARGETS` -- when a new YAML surface lands in the repo, add the glob there.

**What it catches:**

- YAML 1.2 syntax errors (the colon-in-unquoted-value class generally; the PR #10 specific case verified)
- Empty YAML files (almost always an unfinished commit)
- Tab characters in indentation (forbidden by spec; some editors silently insert them)

**What it doesn't catch:**

- Schema validation (per-config validators handle shape; e.g., `loadConfig` for `.atelier/config.yaml`)
- Style rules (line length, key ordering -- no opinion at v1)
- YAML 1.1-vs-1.2 quirks (the parser defaults to 1.2 which matches every consumer Atelier touches)

**Invocation:**

- `npm run lint:yaml` -- runs the linter; exits 0 on clean, 1 on findings
- CI: the `Fast checks (PR)` job runs it on every PR before the traceability validator
- Local pre-commit hook: optional. Adopters who want enforcement at `git commit` time wire a hook themselves (the repo doesn't ship a forced pre-commit framework dependency to keep adopter setup minimal). Suggested `.git/hooks/pre-commit`:
  ```sh
  #!/bin/sh
  npm run lint:yaml || { echo "yaml-lint failed; fix or 'git commit --no-verify' to bypass"; exit 1; }
  ```
