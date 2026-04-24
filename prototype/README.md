# prototype/

The canonical artifact web app. Per ADR-001, the prototype is **both** the product artifact and the coordination dashboard.

## Routes (per `NORTH-STAR.md` §4)

| Route | Purpose |
|---|---|
| `/` | Project home — slices index, demo reel, project status |
| `/strategy` | BRD/PRD rendered, personas, opportunity statements |
| `/design` | Component library, flows, linked external design frames |
| `/slices/[id]` | Single slice prototype + three panels + mini-`/atelier` panel |
| `/atelier` | Live coordination view — role-aware lenses over sessions/contributions/decisions/locks |
| `/traceability` | Bidirectional link registry |

## Sub-routes

- `/atelier/analyst` — analyst lens
- `/atelier/dev` — dev lens
- `/atelier/pm` — PM lens
- `/atelier/designer` — designer lens
- `/atelier/stakeholder` — stakeholder lens
- `/atelier/observability` — admin-gated system health view

## Status

Pre-implementation scaffold. See `NORTH-STAR.md`, `PRD.md` Epic 3, `BRD.md` Epic 3, `ARCHITECTURE.md` §4 for the full spec. See `BRD-OPEN-QUESTIONS.md §1` for the pre-build territory-model validation that should occur before code is written.

## Directory plan (not yet implemented)

```
prototype/
├── src/
│   ├── app/                  # Routes
│   │   ├── page.tsx                          # /
│   │   ├── strategy/page.tsx                 # /strategy
│   │   ├── design/page.tsx                   # /design
│   │   ├── slices/[id]/page.tsx              # /slices/[id]
│   │   ├── atelier/
│   │   │   ├── page.tsx                      # /atelier (role-aware default)
│   │   │   ├── analyst/page.tsx              # analyst lens
│   │   │   ├── dev/page.tsx                  # dev lens
│   │   │   ├── pm/page.tsx                   # PM lens
│   │   │   ├── designer/page.tsx             # designer lens
│   │   │   ├── stakeholder/page.tsx          # stakeholder lens
│   │   │   └── observability/page.tsx        # admin-gated
│   │   └── traceability/page.tsx             # /traceability
│   ├── components/           # Shared UI
│   ├── lib/
│   │   ├── protocol/         # Agent interop protocol client
│   │   ├── datastore/        # Coordination datastore client
│   │   └── registry/         # Traceability registry queries
│   └── design-tokens/        # Token primitives consumed by components
└── eval/
    └── fit_check/            # Labeled eval set + runner
        ├── positive-pairs.yaml
        ├── negative-pairs.yaml
        ├── adversarial.yaml
        └── runner.ts
```
