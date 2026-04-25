# Developer

**Audience question:** How do I contribute to this repo, or fork it for my own project?

**Primary tier served:** Tier 2 — Reference Implementation extenders.

## Contents

| Doc | Purpose |
|---|---|
| [`fork-and-customize.md`](./fork-and-customize.md) | Tier-2 on-ramp. Start here if you want to fork Atelier and customize for your team. |
| [`upstreaming.md`](./upstreaming.md) | How to feed improvements back. Tier-2 customizations that are general-purpose belong upstream; tier-3 methodology/protocol improvements belong in the spec or in claude-docs-toolkit. |
| `setup.md` | Build from source, run locally, run the prototype, hit the endpoint. Populated at M2/M3. |
| `contributing.md` | Branch conventions, commit conventions, PR conventions, ADR conventions. Populated when first external contributor appears (post-M7). |
| [`extending/`](./extending/) | Per-extension guides: add-a-lens, add-a-sync-script, add-an-adapter, add-an-eval-case, add-a-territory. Populated as each capability ships. |

## Related layers

- For the methodology you're contributing to: [`../methodology/`](../methodology/)
- For canonical decisions you're working within: [`../architecture/decisions/`](../architecture/decisions/)
- For the architecture you're extending: [`../architecture/`](../architecture/)
- For testing your contribution: [`../testing/`](../testing/) (populates at M5)
