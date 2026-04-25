# Architecture

**Audience question:** How is Atelier designed?

**Primary tier served:** Tier 2 (Reference Implementation) for `ARCHITECTURE.md` and reference-impl details; Tier 3 (Specification) for `protocol/` and `schema/`.

## Contents

| Path | Purpose |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Capability-level architecture. Components, data model, flows, operational concerns. Vendor-neutral by design (per ADR-012). |
| [`decisions/`](./decisions/) | Per-ADR files. Append-only canonical decision log (per ADR-005, ADR-030). |
| [`protocol/`](./protocol/) | The 12-tool open specification (per ADR-013). Tier-3 entry for protocol implementers. |
| [`schema/`](./schema/) | Territory contracts, datastore schema, config schema, scope_kind enum. Reference material. |
| [`walks/`](./walks/) | Scenario validations of the architecture (analyst-week-1, dev-week-1, etc.). |
| [`diagrams/`](./diagrams/) | Component diagrams, sequence diagrams, data-flow diagrams. Populated as diagrams arrive. |

## Related layers

- For the methodology the architecture serves: [`../methodology/`](../methodology/)
- For requirements the architecture satisfies: [`../functional/`](../functional/)
- For how to extend the architecture: [`../developer/extending/`](../developer/extending/)
