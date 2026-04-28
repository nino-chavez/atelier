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
- **Most recent work (2026-04-28 session: pre-M1 data-model + contract audit):**
  - Pre-M1 data-model + contract audit run (`docs/architecture/audits/pre-M1-data-model-audit.md`). 18 findings: 6 HIGH, 7 MEDIUM, 5 LOW. Five HIGH-finding ADRs landed (ADR-033 through ADR-037); one strategic-call finding filed as BRD-OPEN-QUESTIONS section 20.
  - ADR-033: contribution.kind reduced from 5 -> 3 values (drop proposal + decision; cross-role authoring surfaces via requires_owner_approval flag).
  - ADR-034: contribution.state reduced from 7 -> 6 values (drop blocked; blocked is now blocked_by IS NOT NULL orthogonal to lifecycle position).
  - ADR-035: contracts.breaking_change bool replaced with classifier_decision + classifier_reasons + override_decision + override_justification + generated effective_decision.
  - ADR-036: tables recording authorship gain *_composer_id (immortal) alongside *_session_id (operational, ON DELETE SET NULL). Resolves dangling-FK risk at session reaping.
  - ADR-037: decisions.category drops vestigial 'convention' value; new triggered_by_contribution_id link.
  - METHODOLOGY 11.5 added (data-model + contract audit at milestone-entry); subsequent subsections renumbered to 11.6/11.7/11.8/11.9. Section 11.1 review-surfaces table grew from 4 to 5 cadences.
  - ARCH 5.1 schema rewritten across contributions, decisions, locks, contracts, telemetry tables. Spec-drift fixes also folded in: repo_branch, commit_count, last_observed_commit_sha added to contributions; locks.contribution_id added; CHECK constraints on transcript_ref + trace_ids cardinality. ARCH 6.2.1 / 6.2.2 / 6.3.1 / 6.5 / 6.7 lens defaults updated for new enums.
  - BRD acceptance criteria updated where they referenced dropped enum values (US-4.2, US-4.3, US-4.5, US-9.6, US-13.5). NORTH-STAR section 3 updated. designer-week-1.md Step 8 updated.
  - traceability.json bumped: adrs 32 -> 37, decisions 35 -> 40, open-questions 19 -> 20, brd-stories 95 -> 98 (US-11.10/11/12).
  - Supplemental sweep G1-G7 same day: ARCH 5.3 RLS rule drift fixed (G1), update() extended with owner_approval parameter + contributions.approved_by_composer_id/approved_at columns added (G2), composers UNIQUE(project_id, email) (G3), sessions.status idle transition specified (G4), sessions.agent_client / composers token rotation / projects.template_version documented (G5/G6/G7). METHODOLOGY 11.5 gained explicit "tables in scope" first-step rule.
  - CLI command-list drift reconciled: NORTH-STAR §10 + BRD Epic 11 + BUILD-SEQUENCE §9 now consistently list 12 v1 commands (lifecycle 7, sync substrate 3, process 2). Added US-11.10 (atelier upgrade CLI), US-11.11 (atelier audit), US-11.12 (atelier review).
  - Walks re-walk: analyst + dev clean (no stale enum refs); designer Step 8 already updated. BRD epic coverage re-checked: still 0 ADRs across Epics 3/11/12/14, but per M0 exit audit appendix this is acknowledged-acceptable (legitimate per-epic analysis); no action required.
  - Earlier sessions (2026-04-27, multi-sub-session): M1/M2 schema redistribution, M1.5 added, publish-delivery trigger cutover plan, BRD-OPEN-QUESTIONS sweep, three composer-surface walks, ARCH expansion across sections 5.4/6.2.x/6.3.x/6.4.x/6.5.x/6.6.x/6.7.x/7.4.x/7.8.1/7.9/9.5-9.7, ASCII convention.
- **Stack locked:** GitHub + Supabase + Vercel + MCP, GCP-portability constrained (ADR-027/028/029).
- **Three-tier consumer model:** Specification / Reference Implementation / Reference Deployment, all first-class at v1 (ADR-031).
- **Open ADR-relevant decisions:** D24 (embedding model default -- needed at M5 entry); plan_review checkpoint per BRD-OPEN-QUESTIONS section 19 (wants resolution before M2 contribution-lifecycle endpoint work; surfaced by 2026-04-28 strategy addendum on multi-agent coordination landscape); composer-role enum split per BRD-OPEN-QUESTIONS section 20 (surfaced by pre-M1 data-model audit F12; wants resolution before deployment exposes the conflation).
- **Strategy addenda pattern established** at `../../docs/strategic/addenda/`. First addendum: 2026-04-28-multi-agent-coordination-landscape.md (Maggie Appleton talk + GitHub Next survey).
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
