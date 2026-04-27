---
last_updated: 2026-04-27
status: pre-implementation, design phase complete, M1 scoped
sunset_at: M2 (replaced by `get_context` per US-2.4)
---

# Session checkpoint

Ephemeral session-to-session state. Not canonical — see `../../docs/methodology/METHODOLOGY.md §6.1` for doc organization.

This file is a **pre-M2 stand-in for `get_context`**. Once the 12-tool endpoint ships at M2, this file is retired and session continuity becomes a protocol primitive.

---

## Where we are

- **Phase:** Design complete. M1 scoped. Pre-implementation.
- **Last milestone done:** M0 per `../../docs/strategic/BUILD-SEQUENCE.md`.
- **Most recent change:** M1/M2 redistribution in BUILD-SEQUENCE.md — four schema tables (`projects`, `territories`, `contributions`, `decisions`) move into M1 alongside the five sync scripts so ADR-008 is honored against real persistence. Dogfooding ignition point moves from M2 to M1. Not an ADR (see `../../docs/methodology/METHODOLOGY.md §6.1` ADR-hygiene rule); a sequencing tightening per `../../docs/strategic/BUILD-SEQUENCE.md §6`.
- **Stack locked:** GitHub + Supabase + Vercel + MCP, GCP-portability constrained (ADR-027/028/029).
- **Three-tier consumer model:** Specification / Reference Implementation / Reference Deployment, all first-class at v1 (ADR-031).
- **Open ADR-relevant decisions:** D24 (embedding model default — needed at M5 entry).
- **Open M1 sequencing items:** `../../docs/functional/BRD-OPEN-QUESTIONS.md §16` (adapter sequencing), §17 (round-trip whitelist), §18 (publish-delivery trigger model). All three want answers before M1 implementation starts.
- **Nothing else blocks M1.**

## What the next session should do first

1. Read `../../README.md` for tier-routing and the document map.
2. Read `../../docs/strategic/BUILD-SEQUENCE.md` §5 M1 + M2 (recently updated) and §7 for the open sequencing questions.
3. Resolve `../../docs/functional/BRD-OPEN-QUESTIONS.md §16, §17, §18` with the user before writing M1 code.
4. Confirm direction with the user before starting M1 (four-table schema + five sync scripts per ADR-008).
5. If user wants to walk a second scenario instead (dev-week-1 or designer-week-1), use `../../docs/architecture/walks/analyst-week-1.md` as the template.

## Drift discipline

Do **not** copy ADR counts, decision counts, route counts, or other state-derived numbers into this file. Refer to canonical state; don't replicate. (See `../../docs/methodology/METHODOLOGY.md §6.1` for the no-parallel-summary rule and the worked example.)

If something feels wrong while reading the canonical docs, file a `../../docs/functional/BRD-OPEN-QUESTIONS.md` entry rather than silently fixing it.
