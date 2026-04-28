# scripts/

Substrate and tooling scripts that run outside the prototype web app.

## Structure (not yet implemented)

```
scripts/
├── traceability/             # Registry generation + link injection
│   ├── build-registry.mjs    # Scan docs + emit traceability.json
│   ├── inject-links.mjs      # Inject trace-ID callouts into markdown
│   ├── validate-refs.mjs     # Pre-commit check: every trace ID resolves
│   └── schema.json           # JSON schema for traceability.json
└── sync/                     # The 5-script sync substrate (all v1)
    ├── publish-docs.mjs      # repo → published-doc system
    ├── publish-delivery.mjs  # contribution state → delivery tracker
    ├── mirror-delivery.mjs   # delivery tracker → registry (nightly)
    ├── reconcile.mjs         # bidirectional drift detector (reports only)
    └── triage/
        ├── classifier.mjs    # external comment → category
        ├── drafter.mjs       # classified comment → proposal draft
        └── route-proposal.mjs # drafted proposal → kind=proposal contribution
```

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
| Traceability registry | `traceability.json` | JSON | JSON with 2-space indent, key order matching schema | Trailing newline; key order per schema |
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
| `markdown_link_integrity` | Every relative markdown link in canonical docs resolves to a real file or anchor | `[BUILD-SEQUENCE](../strategic/BUILD-SEQENCE.md)` -- typo in path |
| `adr_reeval_trigger_check` | Each ADR with a `Re-evaluation triggers` section is checked against the trigger conditions; matched triggers are reported | An ADR's trigger says "if X publishes a fencing-token API" -- the check polls the documented external repo for evidence |
| `open_questions_hygiene` | Each OPEN entry in BRD-OPEN-QUESTIONS is examined: is the recommendation a spec? If yes, the entry is flagged for fold-in (per the spec-gap-vs-real-question test in METHODOLOGY 6.1) | An OPEN entry has a clear "Recommendation" with three concrete bullets but no genuine alternative -- flagged |
| `traceability_coverage` | Every BRD story has at least one resolution path: an ADR cites it, a contribution carries it, or implementation code cites it (M2+) | US-2.7 has no ADR, no contribution, and no code citation -- flagged for either work or scope removal |
| `frontmatter_validation` | ADRs and other frontmatter-bearing files have required fields (`id`, `trace_id`, `category`, etc.) and well-formed values | An ADR is missing the `composer` field |

### CI integration

The validator runs in three modes via flags:

- **`--per-pr`** (run on every PR via `.github/workflows/atelier-audit.yml`): trace_id_resolution + arch_section_resolution + adr_id_resolution + walk_fold_resolution + markdown_link_integrity + frontmatter_validation. Fast (under 10 seconds for typical projects). Hard-fails the PR on any check failure.

- **`--milestone-exit`** (run by the architect at milestone-status-to-Done transition via `atelier audit --milestone-exit`): all checks plus contract_name_resolution + open_questions_hygiene + traceability_coverage + adr_reeval_trigger_check. Produces the audit report at `docs/architecture/audits/milestone-<id>-exit.md` per METHODOLOGY 11.3.

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
