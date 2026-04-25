---
last_updated: 2026-04-25
status: pre-implementation, design phase complete, doc-organization cleanup complete
sunset_at: M2 (replaced by `get_context` per US-2.4)
---

# Session checkpoint

Ephemeral session-to-session state. Not canonical — see `../../docs/methodology/METHODOLOGY.md §6.1` for doc organization.

This file is a **pre-M2 stand-in for `get_context`**. Once the 12-tool endpoint ships at M2, this file is retired and session continuity becomes a protocol primitive.

---

## Where we are

- **Phase:** Design complete. Pre-implementation.
- **Last milestone done:** M0 per `../../docs/strategic/BUILD-SEQUENCE.md`. Doc-organization cleanup landed (ADR-030, ADR-031, ADR-032).
- **Stack locked:** GitHub + Supabase + Vercel + MCP, GCP-portability constrained (ADR-027/028/029).
- **Three-tier consumer model:** Specification / Reference Implementation / Reference Deployment, all first-class at v1 (ADR-031).
- **Open ADR-relevant decisions:** D24 only (embedding model default — needed at M5 entry).
- **Nothing blocks M1.**

## What the next session should do first

1. Read `../../README.md` for tier-routing and the document map.
2. Read `../../docs/strategic/BUILD-SEQUENCE.md` for the milestone plan.
3. Confirm direction with the user before starting M1 (the five SDLC sync substrate scripts per ADR-008).
4. If user wants to walk a second scenario instead (dev-week-1 or designer-week-1), use `../../docs/architecture/walks/analyst-week-1.md` as the template.

## Drift discipline

Do **not** copy ADR counts, decision counts, route counts, or other state-derived numbers into this file. Refer to canonical state; don't replicate. (See `../../docs/methodology/METHODOLOGY.md §6.1` for the no-parallel-summary rule and the worked example.)

If something feels wrong while reading the canonical docs, file a `../../docs/functional/BRD-OPEN-QUESTIONS.md` entry rather than silently fixing it.
