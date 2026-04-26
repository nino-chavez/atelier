# Adoption guide — apply Atelier's methodology to your own project

**Audience:** A team that wants to adopt Atelier's way-of-working without using this reference implementation.

**Tier served:** Tier 3 — Specification.

This guide assumes you've read [`METHODOLOGY.md`](METHODOLOGY.md) and want to apply the patterns to your own project — possibly on a different stack, possibly without the 12-tool MCP endpoint, possibly without the prototype web app.

---

## What you must adopt for the methodology to work

These are non-negotiable. Drop any one and the methodology fragments.

1. **Repo-canonical decisions.** Decisions live in version control as append-only files (per [`../architecture/decisions/`](../architecture/decisions/) — see ADR-005). Whether you store them as one file (Atelier's pre-ADR-030 model) or as a directory (current model), the rule is the same: append-only; reversals are new entries referencing old.

2. **Trace IDs as the single join key.** Every story, decision, research artifact, and design component carries a stable trace ID. Format is yours; consistency matters. (See [`METHODOLOGY.md §7`](METHODOLOGY.md).)

3. **Authority follows where content naturally changes** (per [`METHODOLOGY.md §4`](METHODOLOGY.md)). Discovery fields are repo-authoritative; delivery fields are tracker-authoritative; comments are source-authoritative-and-triaged. Don't bidirectionally sync canonical state.

4. **Publish-pull asymmetry.** Publishes from repo to external systems are deterministic and idempotent. Pulls from external systems to repo are probabilistic and human-gated (triage). Never auto-merge external content (see ADR-018).

5. **Two substrates kept orthogonal** (per [`METHODOLOGY.md §5`](METHODOLOGY.md)). SDLC sync substrate (hours-to-days; deterministic publishes; nightly mirrors) and coordination substrate (seconds-to-minutes; pub/sub; locks). Don't conflate them.

6. **Destination-first design.** No phasing in design docs. Capability-level architecture. (See ADR-011, ADR-012.)

## What you can adapt

These are encouraged variations. Choose what fits your team.

| Atelier's planned choice | Adaptable to | Constraint |
|---|---|---|
| 12-tool MCP endpoint (ADR-013) — lands at M2 | Any RPC shape with the same semantics | Must support session, context, contribution, lock, decision, contract operations |
| Postgres + pgvector + Realtime (ADR-027) — lands at M2 | Any datastore with relational, vector, and pub/sub capabilities | Must support RLS, append-only enforcement, monotonic counters for fencing |
| Role-aware lenses (ADR-017) — land at M3 | More or fewer lenses keyed to your team's roles | Same canonical state, different first-view cuts |
| Territory/contract model (ADR-014) | Different territory naming, scope_kind values | The model itself is the load-bearing piece |
| `.atelier/config.yaml` + `.atelier/territories.yaml` | Different config format | Same information must be expressible |
| Single-repo project (Q9 in BRD-OPEN-QUESTIONS) | Multi-repo projects | Trace IDs must be globally unique across repos |

## What you do NOT need from this reference impl

- The prototype web app (you may have your own canonical artifact surface, like a wiki or design tool) — lands at M3
- The Vercel/Supabase deploy (run the protocol on whatever stack) — reference impl lands across M1–M7
- The CLI (`atelier init`, `atelier deploy`, etc. — if your stack is different, your tooling will be too) — CLI polished at M7
- The find_similar service (you may not need semantic duplicate detection at v1) — lands at M5

If you keep the methodology + trace-ID discipline + decisions-as-code + publish-pull asymmetry, you've adopted Atelier's way-of-working. The rest is implementation choice.

## Common adaptation paths

**Path A — methodology only (no protocol, no datastore).** Use Atelier's repo conventions, trace IDs, authority model, and decisions discipline against an existing project. No coordination substrate. Suitable for solo or small-team projects where conflict is rare and human PR review is enough.

**Path B — methodology + protocol (own datastore).** Implement the 12-tool surface against your own datastore. Useful when you have an existing data layer (e.g., your own session store, your own Postgres) and want agent-facing coordination on top of it. See [`../architecture/protocol/`](../architecture/protocol/) for the spec.

**Path C — methodology + protocol + reference impl, customized.** Fork this repo. See [`../developer/fork-and-customize.md`](../developer/fork-and-customize.md). This is tier 2.

**Path D — full reference deployment** (once tier-1 ships at M7 with full CLI polish). `atelier init && atelier deploy` produces a working coordination substrate. This is tier 1; not really "adoption" — you're using the product.

## What to send back upstream

If your adaptation surfaces a methodology gap (a constraint that didn't fit, a pattern that broke), file it as feedback against this repo or against claude-docs-toolkit (whichever owns the gap). See [`../developer/upstreaming.md`](../developer/upstreaming.md) for the contribution loop.

The dogfood/refine relationship is bidirectional: Atelier's methodology evolves from real adoption pain. Your adaptation is data.
