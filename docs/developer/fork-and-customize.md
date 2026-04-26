# Fork and customize — Reference Implementation tier 2 on-ramp

**Audience:** A team that wants to fork this repo and customize for their own way-of-working.

**Tier served:** Tier 2 — Reference Implementation.

This is the on-ramp for tier-2 readers. You're past "deploy as-is" (tier 1) but not implementing the protocol from scratch on a different stack (tier 3). You want our schema, our endpoint, our prototype — with your modifications.

---

## What forking will get you (once tier-2 ships)

**Status (2026-04-25): pre-implementation.** The reference implementation lands across M1–M7 of [`../strategic/BUILD-SEQUENCE.md`](../strategic/BUILD-SEQUENCE.md). Forking right now gives you the canonical design corpus only; the runtime artifacts arrive at the milestones below.

| Capability | Lands at |
|---|---|
| 5 sync scripts (per ADR-008) | M1 |
| 12-tool MCP endpoint scaffold (per ADR-013) | M2 |
| Relational schema with RLS, fencing tokens, pub/sub broadcast (per ADR-004, ADR-016) | M2 |
| Five role-aware lens shells in `/atelier` (per ADR-017) | M3 |
| Fit_check eval harness with seed eval set (per ADR-006) | M5 |
| Territory + contract model wired to `.atelier/territories.yaml` (per ADR-014) | M2 (declaration), M2/M3 (runtime) |
| `atelier init` / `atelier deploy` CLI | M7 (polished); raw forms across M2/M3/M6 per BUILD-SEQUENCE §9 |

## Common customizations

Each links to the relevant guide in [`extending/`](./extending/) (populated as each capability ships).

| You want to... | Read this | Lands at |
|---|---|---|
| Add a sixth role-aware lens | `extending/add-a-lens.md` | M3 |
| Add a new sync script (e.g., publish to your wiki) | `extending/add-a-sync-script.md` | M1 |
| Add a delivery-tracker, published-doc, or design-tool adapter | `extending/add-an-adapter.md` | M6 |
| Add a fit_check eval case | `extending/add-an-eval-case.md` | M5 |
| Declare a new territory | `extending/add-a-territory.md` | M2 |
| Extend the trace-ID format | `extending/add-a-trace-id-format.md` | M1 |
| Swap the embedding model (D24) | `extending/swap-embedding-model.md` | M5 |
| Change the deploy stack (per ADR-029 portability constraint) | [`../ops/migration/`](../ops/migration/) | M7 |

## What you should NOT customize

These are load-bearing per the canonical [`../architecture/decisions/`](../architecture/decisions/). Customize them and you exit the methodology — you're now tier-3 implementing your own thing.

- **Append-only decisions** (ADR-005). Make decisions a writable mutable store and you lose audit + reversal semantics.
- **Fencing tokens on every lock** (ADR-004). Skip this and stale-session writes corrupt artifacts silently.
- **Triage never auto-merges** (ADR-018). Auto-merge external content and you lose the human-gated safety property.
- **Capability-level architecture** (ADR-012). Hard-code vendors into the architecture (rather than the reference impl) and you make portability impossible.
- **12-tool surface** (ADR-013). Add or remove tools and you fork the protocol — that's a tier-3 move, not tier-2.
- **Repo-canonical for discovery fields** (CLAUDE.md). Move design content into your datastore and you lose every methodology benefit.

## How to fork cleanly (when tier-2 ships)

This flow becomes runnable as the reference impl ships across M1–M7. Pre-M2, only steps 1, 2, 3, 6, 7 apply.

1. **Fork on GitHub** (or your versioned file store). Don't clone-and-rename — preserve the fork link so you can pull upstream changes.

2. **Update `.atelier/config.yaml`** with your project-id, datastore credentials, identity provider, deploy targets.

3. **Customize `.atelier/territories.yaml`** for your team's roles. Use the seed territories as a starting point; rename, split, or merge as needed. Keep `review_role` set per ADR-025.

4. **(Post-M5) Run the test suite** before any code changes (`atelier eval fit_check` + integration tests). If anything fails out-of-the-box, file an upstream bug — don't customize broken code.

5. **(Post-M3) Make customizations in clearly-marked locations.** Conventions:
   - Custom adapters in `prototype/src/adapters/<your-org>/`
   - Custom lenses in `prototype/src/app/atelier/lenses/<your-org>/`
   - Custom sync scripts in `scripts/sync/<your-org>/`
   - Custom MCP tool extensions: don't extend the core 12; add a separate extension endpoint (preserves protocol fidelity)

6. **Track upstream.** Pull `main` from this repo periodically. Methodology improvements upstream into your customizations.

7. **Log new ADRs for your fork-specific decisions** under your fork's `docs/architecture/decisions/` (per ADR-030). This keeps your customization history append-only and traceable.

## When to upstream a customization

If your customization is general-purpose (not your-team-specific), it probably belongs upstream. See [`upstreaming.md`](./upstreaming.md) for the contribution loop.

Examples of what belongs upstream:
- A new `scope_kind` value that other teams would use
- A bug fix in the reference impl
- A new adapter for a popular external system (Linear, Confluence, Slack, etc.)
- A methodology refinement discovered through real use

Examples of what stays in your fork:
- Your-org-specific territory definitions
- Your-org-specific lens that surfaces your team's metrics
- Integrations with internal tools

## Status

**Pre-M2.** This guide is the framing. Per-extension guides under [`extending/`](./extending/) populate as each capability ships. The fork-friendly conventions (clearly-marked customization locations, upstream-pull discipline) become enforceable once the reference impl exists at M3+.
