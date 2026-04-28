---
last_updated: 2026-04-28
status: M1 implementation active, design phase complete
sunset_at: M2 (replaced by `get_context` per US-2.4)
---

# Session checkpoint

Ephemeral session-to-session state. Not canonical — see `../../docs/methodology/METHODOLOGY.md §6.1` for doc organization.

This file is a **pre-M2 stand-in for `get_context`**. Once the 12-tool endpoint ships at M2, this file is retired and session continuity becomes a protocol primitive.

---

## Where we are

- **Phase:** Design complete. M1/M1.5/M2 scoped. **M1 implementation active as of 2026-04-28.** All design-side gates (data-model audit, supplemental sweep, CLI reconciliation, expert-review pass, AI-speed pivot, second-pass red-team audit) are closed. Implementation-grade ARCH spec landed across all three composer surfaces (analyst/dev/designer).
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
  - Expert-review pass landed (2026-04-28 evening): ADR-038 composer role split (resolves §20 same-day; adds architect as first-class discipline closing territories.yaml drift); ARCH 6.8 broadcast ordering guarantees pinned (per-channel FIFO + at-least-once + sequence-based gap detection); scripts/README.md publish-delivery trigger model gains internal-event-bus pattern note; traceability.json schema documented as graph-ready (entries + edges) for v1.x graph-aware find_similar; BUILD-SEQUENCE §9 atelier doctor raw form moved M7 -> M2; BRD-OPEN-QUESTIONS §3 gains hybrid keyword+semantic fallback note for find_similar precision risk.
  - Open list now 3 entries (sections 3, 7, 19). traceability.json: adrs 37 -> 38, decisions 40 -> 41.
  - AI-speed red-team pivot + GitHub ACE intel pass landed (2026-04-28 evening): new strategy addendum `addenda/2026-04-28-ai-speed-coordination-and-ace.md` documents the pivot. Spec changes folded: BRD US-1.8 added (atelier init as guided handshake protocol); BUILD-SEQUENCE §9 atelier init raw form expanded M0 + M2; scripts/README.md gained throwaway-branches convention for per-contribution branch lifecycle; METHODOLOGY 11.10 added executor-model tagging (human / AI / AI-with-human-triage) for each review surface. Three strategic open questions filed: §21 (AI auto-reviewers as review_role type), §22 (semantic contradiction check in validator), §23 (lightweight comment_on_contribution annotations).
  - Open list 6 entries (3, 7, 19, 21, 22, 23). traceability.json: brd-stories 98 -> 99, open-questions 20 -> 23.
  - Second-pass red-team audit + chatbot pattern landed (2026-04-28, post-compact). Audit was applied per-item with the existing-primitives + discipline-tax checks; 4 items stale (resolved by ADR-038 / earlier expert-review pass / existing §7), 2 duplicates of existing open questions (§21, §23), 1 partial-coverage tightening (transcript -> ADR convention captured in chatbot-pattern.md), 1 net-new open question filed: §24 branch reaping via `reconcile.mjs` extension (no new script, no new ADR). Chatbot pattern landed at lighter scope than originally proposed: no new `chat` surface enum value, no new ARCH 7.9 OAuth subsection -- pattern is captured in `docs/user/connectors/chatbot-pattern.md` + matrix row + BUILD-SEQUENCE M6 reference-bot deferral. §23 status updated to note the chatbot pattern subsumes much of its motivation; the strategic call narrows to non-chat annotation use cases. scripts/README.md throwaway-branches section gained reaping-of-rejected/orphaned-branches paragraph pointing at §24.
  - Open list now 7 entries (3, 7, 19, 21, 22, 23, 24). traceability.json: open-questions 23 -> 24.
  - Earlier sessions (2026-04-27, multi-sub-session): M1/M2 schema redistribution, M1.5 added, publish-delivery trigger cutover plan, BRD-OPEN-QUESTIONS sweep, three composer-surface walks, ARCH expansion across sections 5.4/6.2.x/6.3.x/6.4.x/6.5.x/6.6.x/6.7.x/7.4.x/7.8.1/7.9/9.5-9.7, ASCII convention.
- **Stack locked:** GitHub + Supabase + Vercel + MCP, GCP-portability constrained (ADR-027/028/029).
- **Three-tier consumer model:** Specification / Reference Implementation / Reference Deployment, all first-class at v1 (ADR-031).
- **Open ADR-relevant decisions:** D24 (embedding model default -- needed at M5 entry); plan_review checkpoint per BRD-OPEN-QUESTIONS section 19 (wants resolution before M2 contribution-lifecycle endpoint work; surfaced by 2026-04-28 strategy addendum on multi-agent coordination landscape); composer-role enum split per BRD-OPEN-QUESTIONS section 20 (surfaced by pre-M1 data-model audit F12; wants resolution before deployment exposes the conflation).
- **Strategy addenda pattern established** at `../../docs/strategic/addenda/`. First addendum: 2026-04-28-multi-agent-coordination-landscape.md (Maggie Appleton talk + GitHub Next survey).
- **Nothing blocks M1 design-wise.** Implementation can begin.

## What the next session should do first

**M1 implementation is active.** The fresh session is implementing, not auditing. Per the discipline-tax meta-finding, the cost-benefit has inverted at M1+: less spec accretion, more ergonomic hardening against running code.

1. Read `../../CLAUDE.md` (the agent charter) and `../../README.md` (tier-routing + document map).
2. Skim ARCH section 5 (data model) -- this is the schema you are migrating in step 4 below.
3. Skim ARCH section 6 (write paths + lifecycle) -- the internal write library implements these contracts.
4. **Implement M1 in this order:**
   1. Four-table schema migration (contributions, decisions, contracts, locks per ARCH 5.1, with ADR-033/034/035/036/037/038 shapes already folded). Plus the supporting tables: composers, sessions, projects, telemetry. Lands as a Supabase migration under `supabase/migrations/`.
   2. Internal write library (`scripts/sync/lib/write.ts` per `../../scripts/README.md`) -- the ARCH 6.x mutation contracts (claim, update, release, log_decision, etc.) implemented against the schema, NOT yet exposed via MCP. M1 wires these for the sync scripts to consume directly.
   3. Five sync scripts (`publish-docs`, `publish-delivery`, `mirror-delivery`, `reconcile`, `triage`) per `../../scripts/README.md`. Per ADR-008, all five ship together. The internal event bus pattern (`scripts/sync/lib/event-bus.ts`) lands here so `publish-delivery` source-of-events can swap M1 -> M2 -> M4 in one line.
   4. GitHub adapter against the adapter interface (per ARCH 6.6 / scripts/README.md).
   5. Round-trip integrity test -- gates M1 exit per scripts/README.md "Round-trip integrity contract."
5. **Open questions to resolve as their moment arrives within M1:**
   - **§24 (branch reaping):** before authoring `reconcile.mjs`, decide whether to ship the branch-reaping pass present-but-default-off (recommendation) or defer to v1.x. The recommendation is concrete; this is a confirm-or-defer call, not a research item.
   - **§19 (plan_review):** wants resolution before M2 contribution-lifecycle endpoint work, not blocking M1.
6. If a gap surfaces during implementation that wasn't caught by the audits, file a BRD-OPEN-QUESTIONS entry with a recommendation, do not silently fix the spec. Per CLAUDE.md "How to propose changes."

**Do NOT:**
- Re-audit the spec. Five audit passes already landed; further audits are spec-accretion against the discipline-tax constraint.
- Propose new ADRs unless implementation surfaces a genuinely new architectural decision the existing 38 do not cover. Apply the existing-primitives check first per the methodology.
- Add new MCP tools, schema fields, or methodology subsections without an explicit user-approved gap. The 12-tool surface is locked at v1 per ADR-013.

## Drift discipline

Do **not** copy ADR counts, decision counts, route counts, or other state-derived numbers into this file. Refer to canonical state; don't replicate. (See `../../docs/methodology/METHODOLOGY.md §6.1` for the no-parallel-summary rule and the worked example.)

If something feels wrong while reading the canonical docs, file a `../../docs/functional/BRD-OPEN-QUESTIONS.md` entry rather than silently fixing it.
