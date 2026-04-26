# Extending guides

**Audience question:** How do I add a [lens / sync script / adapter / eval case / territory] without breaking existing things?

**Primary tier served:** Tier 2 — Reference Implementation extenders.

## Contents (planned, populated as each capability ships)

| Guide | Lands at | Topic |
|---|---|---|
| `add-a-lens.md` | M3 | Add a sixth role-aware lens to `/atelier` (per ADR-017) |
| `add-a-sync-script.md` | M1 | Add a new SDLC sync script (per ADR-008's 5-script substrate) |
| `add-an-adapter.md` | M6 | Add a delivery-tracker, published-doc, or design-tool adapter (per Epic 10) |
| `add-an-eval-case.md` | M5 | Add a find_similar eval case (per ADR-006, US-6.6) |
| `add-a-territory.md` | M2 | Declare a new territory in `.atelier/territories.yaml` (per US-1.5, ADR-014) |
| `add-a-trace-id-format.md` | M1 | Extend the trace-ID registry (per ADR-021 multi-trace support) |

Each guide follows a common shape: prerequisites, interface contract, tests required, doc updates required, ADR-required-yes/no.
