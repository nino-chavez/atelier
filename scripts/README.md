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
