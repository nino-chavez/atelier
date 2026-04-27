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

- **Phase:** Design complete. M1 scoped. Pre-implementation. Implementation-grade ARCH spec landed for the analyst path.
- **Last milestone done:** M0 per `../../docs/strategic/BUILD-SEQUENCE.md`.
- **Most recent work (2026-04-27 session):**
  - M1/M2 redistribution: four schema tables (projects, territories, contributions, decisions) move into M1 alongside the five sync scripts so ADR-008 is honored against real persistence. Dogfooding ignition point moves from M2 to M1. Sequencing tightening per BUILD-SEQUENCE section 6, not an ADR.
  - BRD-OPEN-QUESTIONS hygiene sweep: 7 entries (4, 6, 10, 11, 12, 14, 17) folded from "open question" framing into spec at canonical homes. Genuine open list now: 3, 7, 8, 9, 16, 18.
  - Analyst-week-1 walk re-examination: every step (1-7) had latent operational details under its surface ADR resolution. All folded into ARCH. See walk section 7 for the per-step audit-trail. New ARCH subsections: 5.4 (trimmed), 6.2.1, 6.2.2, 6.2.3, 6.2.4, 6.3 (rewritten), 6.3.1, 6.4.1, 6.4.2, 6.4.3, 6.6.1, 6.7 + 6.7.1-5, 7.8.1, 7.9, 9.5, 9.6, 9.7.
  - Convention change: ASCII in commit messages and new doc content (no §, ·, em dash, smart quotes) per feedback memory. Pre-existing decorated content not retroactively swept.
- **Stack locked:** GitHub + Supabase + Vercel + MCP, GCP-portability constrained (ADR-027/028/029).
- **Three-tier consumer model:** Specification / Reference Implementation / Reference Deployment, all first-class at v1 (ADR-031).
- **Open ADR-relevant decisions:** D24 (embedding model default -- needed at M5 entry).
- **Genuinely open M1 items requiring decisions:** BRD-OPEN-QUESTIONS section 16 (adapter sequencing within M1) and section 18 (publish-delivery trigger model). Both have recommendations awaiting Nino's call.
- **Other genuinely open items (not blocking M1):** section 3 (embedding model -- benchmark), section 7 (scale ceiling -- benchmark), section 8 (cost accounting -- OUT v1 unless demand flips), section 9 (cross-repo -- DEFERRED to v1.x).
- **Nothing else blocks M1.**

## What the next session should do first

1. Read `../../README.md` for tier-routing and the document map.
2. Skim ARCH section 6 (the meaty bits expanded heavily on 2026-04-27): 6.2.1-4, 6.3-6.3.1, 6.4-6.4.3, 6.6.1, 6.7-6.7.5. Plus 7.8.1, 7.9, 9.5-9.7.
3. Resolve BRD-OPEN-QUESTIONS section 16 and section 18 with Nino before writing M1 code.
4. Confirm direction before starting M1 (four-table schema + five sync scripts per ADR-008 + the M1 expansion in BUILD-SEQUENCE section 5 M1).
5. If walking a second scenario (dev-week-1 or designer-week-1), use the analyst walk as the template -- and apply the latent-gaps re-examination discipline from walk section 7 from the start, not as an after-the-fact sweep.

## Drift discipline

Do **not** copy ADR counts, decision counts, route counts, or other state-derived numbers into this file. Refer to canonical state; don't replicate. (See `../../docs/methodology/METHODOLOGY.md §6.1` for the no-parallel-summary rule and the worked example.)

If something feels wrong while reading the canonical docs, file a `../../docs/functional/BRD-OPEN-QUESTIONS.md` entry rather than silently fixing it.
