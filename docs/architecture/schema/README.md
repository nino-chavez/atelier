# Schema

**Audience question:** What are the canonical data shapes — territories, contributions, decisions, locks, schema enums?

**Primary tier served:** Tier 2 (canonical schema) and Tier 3 (schema as spec) — same source, dual-purpose presentation.

## Contents (planned, populated at M2)

| Doc | Purpose |
|---|---|
| `territory-contracts.md` | The territory + contract model (per ADR-014). What a territory declares; what consumers can query. |
| `datastore-schema.md` | Relational tables: `projects`, `composers`, `sessions`, `contributions`, `decisions`, `locks`, `contracts`, `telemetry`. RLS policies. Indexes. |
| `config-schema.md` | `.atelier/config.yaml` and `.atelier/territories.yaml` schemas. |
| `scope-kind-enum.md` | The 5 scope kinds: `files`, `doc_region`, `research_artifact`, `design_component`, `slice_config` (per ADR-003). |

## Related layers

- For the protocol that operates on this schema: [`../protocol/`](../protocol/)
- For the architecture that owns this schema: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)

## Status

**Pre-M2.** This directory is a placeholder. Schema reference docs land at M2 alongside the relational schema implementation.
