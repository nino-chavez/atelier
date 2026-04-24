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
