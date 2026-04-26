# Strategic risks register

**Status:** Active
**Owner:** Nino Chavez
**Last updated:** 2026-04-25

This doc records **load-bearing strategic bets** — the assumptions whose disconfirmation would change Atelier's strategic story (commercial path, adoption story, scope) but **not** the spec. The spec is destination-first per ADR-011: every feature in [`NORTH-STAR.md`](./NORTH-STAR.md) ships regardless of how these bets resolve.

This is **not a project risk register** (no schedule slippage, dependency blockers, or build-time hazards). Those belong in `.atelier/checkpoints/` ephemeral state. This doc tracks **strategic bets** — claims about the world that informed our design but cannot be verified until after build.

---

## Why this doc exists separately from spec docs

Mixing "what we're building" with "what might happen if our bets are wrong" creates two confusions:

1. **Readers can't tell spec from speculation.** "Ships at v1 with eval harness" is a contract; "if the bar misses, we still ship as OSS" is contingency thinking. Mixing them in the same paragraph makes the contract sound conditional.
2. **Destination-first design (ADR-011) gets undermined.** The spec describes what gets built — period. Hedge language ("if X holds, then Y") implies the destination depends on the bet. It doesn't.

The fix: spec docs describe what's being built. This doc tracks the strategic bets the build depends on for its commercial / adoption story.

---

## Active bets

### Bet 1 — Find_similar precision

**The bet.** Semantic search can answer "is this already done or in flight?" at ≥75% precision with ≥60% recall on a labeled eval set drawn from a real Atelier-coordinated project.

**Why it matters.** Per ADR-007 (no SaaS), Atelier ships as open-source self-hosted. The only plausible commercial surface is a managed find_similar service — hosted vector index, hosted eval harness, precision SLA. That commercial wedge depends on the precision threshold actually being hit.

**Disconfirming test.** `atelier eval find_similar` against the seed eval set. CI gate enforces the threshold (per ADR-006). Test fires at M5 entry; full readout post-M5.

**Fallback path if the bet misses.** The three open-source tiers (Specification / Reference Implementation / Reference Deployment per ADR-031) still ship as planned — every feature in NORTH-STAR is in v1 scope. The managed-find_similar commercial wedge closes; Atelier's value proposition becomes methodology + open-source reference impl with no managed offering. Educational and consultative value remain.

**Re-evaluation triggers.**
- M5 eval results below threshold across multiple model choices.
- Eval set itself proves unreliable (high inter-rater disagreement on labels).
- Embedding-model landscape shifts so dramatically that current benchmarks become irrelevant.

---

### Bet 2 — Regulated-RTM segment exists for the Forge app

**The bet.** Enterprise teams in regulated industries need traceable agent participation in their SDLC at sufficient scale to support a Jira Forge app as a focused commercial offering.

**Why it matters.** Per STRATEGY §6, the Forge app for regulated-RTM is one of three potential commercial surfaces (alongside managed find_similar and consulting). Whether it materializes as a real market depends on regulated-industry adoption signals.

**Disconfirming test.** Post-v1 launch: tracked enterprise adoption + outreach to regulated-industry contacts within the first 6 months of v1. Target signal: 3+ inbound conversations about regulated-RTM use cases.

**Fallback path if the bet misses.** Drop Forge app from commercial roadmap. Maintain protocol + impl as OSS only. No reduction in spec scope.

**Re-evaluation triggers.**
- 12 months post-v1 with zero regulated-industry inbound.
- Major shift in regulated-industry tooling that absorbs Atelier's value (e.g., Jira itself ships equivalent capability).

---

### Bet 3 — Mixed-surface teams have unmet coordination needs

**The bet.** Teams with composers in IDE + browser + terminal surfaces have real coordination friction that current tools don't solve, and Atelier's solution is well-targeted.

**Why it matters.** This is the core wedge per STRATEGY §3 (coordination substrate market gap). If incumbent agent frameworks (Claude Code Agent Teams, Cursor Composer, etc.) close this gap before v1 ships, the wedge narrows.

**Disconfirming test.** Track competitive movements in agent-team coordination during M1–M7 build. Specifically: do Anthropic / OpenAI / Cursor ship cross-surface coordination primitives that match Atelier's territory + contract model?

**Fallback path if the bet misses.** Atelier's wedge narrows to (a) non-code territories (research artifacts, doc regions, design components) and (b) the prototype-as-canonical-artifact model. Both still differentiate vs. agent-team frameworks. Spec unchanged.

**Re-evaluation triggers.**
- A major agent platform ships territory + contract primitives.
- Cross-surface coordination becomes a standard MCP capability.

---

## Bets that resolved

*(Empty until a bet's disconfirming test fires.)*

---

## Conventions

- **Each bet has four parts**: the bet (what we're claiming), why it matters (commercial / adoption consequence), disconfirming test (how we'd know it's wrong), fallback path (what we do if it's wrong).
- **The spec stays unchanged regardless of how a bet resolves.** If a bet's resolution would change the spec, it's not a strategic bet — it's an open design question and belongs in [`../functional/BRD-OPEN-QUESTIONS.md`](../functional/BRD-OPEN-QUESTIONS.md).
- **Resolved bets move to "Bets that resolved"** with the resolution date and outcome. They are not deleted (audit trail).
- **New bets are added as they surface during build.** This doc is editable, not append-only — bets get refined, fallback paths sharpen as we learn more.
