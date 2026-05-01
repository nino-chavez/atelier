# find_similar eval set

This directory holds the labeled seed set ADR-006 + BRD Epic-6 require:
the curated query corpus the M5 CI gate enforces against `find_similar`.

## Files

- `seeds.yaml` — committed seed set. Each entry is a query + expected
  source_refs that should appear in `primary_matches`. Methodology in the
  file header.
- `README.md` — this doc.

## Running

The runner under `scripts/eval/find_similar/runner.ts` consumes this
directory + a live datastore (where `embed-runner.ts` has populated the
embeddings table) and produces precision/recall metrics:

```
npm run eval:find_similar -- --project <project-uuid>
```

CI runs the same command and gates on the thresholds from
`.atelier/config.yaml find_similar.ci_precision_gate / ci_recall_gate`
(currently 0.75 / 0.60 per ADR-006).

## What's a "match"

Per ADR-006 + ARCH 6.4.1, a result is a TP iff the source_ref appears in
`primary_matches` (above the default threshold). Weak suggestions don't
count toward precision or recall — they're a UX affordance, not a
correctness signal.

## When to update seeds

Seed evolution is a normal part of M5+ work. Triggers:

- A new ADR cluster forms — add seeds covering it.
- An ADR is reversed — update or remove seeds that referenced the
  reversed ADR's source_ref. Both ADRs stay in the index per ARCH 6.4.2;
  seeds may need to disambiguate which one should match.
- Eval drift — if the gate falls below threshold without a corresponding
  product change, audit whether the seeds have grown stale (the corpus
  moved but the seed expected lists didn't).

Seed changes are PR-reviewed by the architect role per
`.atelier/territories.yaml` review_role for `docs/architecture/`.

## Cost notes

Each eval run embeds N query strings (one per seed) via the configured
adapter. The corpus side is amortized: `embed-runner.ts` populates the
table once, and the `--rebuild` flag re-embeds only when the model swaps.
At ~20 seeds and ~$0.02/M-tokens for `text-embedding-3-small`, a single
run costs well under a cent.
