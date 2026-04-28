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

- **Phase:** Design complete. M1/M1.5/M2 scoped. Pre-implementation. Implementation-grade ARCH spec landed across all three composer surfaces (analyst/dev/designer).
- **Last milestone done:** M0 per `../../docs/strategic/BUILD-SEQUENCE.md`.
- **Most recent work (2026-04-27 session, multiple sub-sessions):**
  - M1/M2 redistribution: four schema tables move into M1 with the five sync scripts. Sequencing tightening per BUILD-SEQUENCE section 6, not an ADR.
  - M1.5 added as a named milestone between M1 and M2 -- ships the four non-GitHub adapters (Jira, Linear, Confluence, Notion, Figma). Section 16 RESOLVED.
  - publish-delivery trigger model RESOLVED (section 18): polling at M1, post-commit hooks at M2, broadcast at M4. Cutover discipline + invariants documented in scripts/README.md.
  - BRD-OPEN-QUESTIONS hygiene sweep: 9 entries folded into spec (sections 4, 6, 10, 11, 12, 14, 16, 17, 18). Genuine open list now: section 3 (embedding model benchmark), section 7 (scale ceiling benchmark), section 8 (cost accounting -- OUT v1), section 9 (cross-repo -- DEFERRED v1.x).
  - Three composer-surface walks complete: analyst-week-1.md, dev-week-1.md, designer-week-1.md. Walk authoring discipline established: latent gaps surface concretely per step and fold into ARCH in the same commit.
  - ARCH expansion: dozens of new subsections across sections 5.4, 6.2.1, 6.2.1.5, 6.2.2, 6.2.2.1, 6.2.3, 6.2.4, 6.3, 6.3.1, 6.4.1, 6.4.2, 6.4.3, 6.5.1, 6.5.2, 6.6.1, 6.6.2, 6.7 + 6.7.1-5, 7.4.1, 7.4.1.1, 7.4.2, 7.8.1, 7.9, 9.5, 9.6, 9.7.
  - Convention: ASCII in commit messages and new doc content per feedback memory. Pre-existing decorated content not retroactively swept.
- **Stack locked:** GitHub + Supabase + Vercel + MCP, GCP-portability constrained (ADR-027/028/029).
- **Three-tier consumer model:** Specification / Reference Implementation / Reference Deployment, all first-class at v1 (ADR-031).
- **Open ADR-relevant decisions:** D24 (embedding model default -- needed at M5 entry).
- **Nothing blocks M1 design-wise.** Implementation can begin.

## What the next session should do first

1. Read `../../README.md` for tier-routing and the document map.
2. Skim the three walks under `../../docs/architecture/walks/` -- they are now the canonical illustrations of how each composer surface flows end-to-end through the protocol, and each walk's "latent gaps surfaced and folded" table indexes the relevant ARCH subsections.
3. Skim ARCH section 6 + 7 + 9 -- substantially expanded across the 2026-04-27 sessions.
4. If implementing M1: start with the four-table schema migration, then the internal write library, then the five sync scripts (publish-docs, publish-delivery, mirror-delivery, reconcile, triage), then the GitHub adapter against the interface. Round-trip integrity test gates M1 exit per scripts/README.md.
5. If authoring further walks (e.g., PM week-1, stakeholder week-1, multi-composer concurrent week-1): apply the latent-gaps discipline from the start. Use dev-week-1.md or designer-week-1.md as the template (they were authored with the discipline; analyst-week-1.md had it applied retroactively in section 7).

## Drift discipline

Do **not** copy ADR counts, decision counts, route counts, or other state-derived numbers into this file. Refer to canonical state; don't replicate. (See `../../docs/methodology/METHODOLOGY.md §6.1` for the no-parallel-summary rule and the worked example.)

If something feels wrong while reading the canonical docs, file a `../../docs/functional/BRD-OPEN-QUESTIONS.md` entry rather than silently fixing it.
