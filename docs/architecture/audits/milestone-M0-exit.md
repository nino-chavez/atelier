# Milestone M0 exit audit

**Audit run:** 2026-04-28 (retroactive: METHODOLOGY section 11 didn't exist when M0 closed on 2026-04-24)
**Auditor:** architect role (manual run; the validator script is M1 work)
**Milestone:** M0 -- Methodology
**Per:** METHODOLOGY section 11.3 milestone-exit drift sweep + scripts/README.md "Extended cross-doc consistency" check classes

---

## Summary

| Check class | Result | Findings |
|---|---|---|
| trace_id_resolution | **FAIL** | 3 issues |
| arch_section_resolution | OK | 30 of 30 walk-cited section refs resolve |
| adr_id_resolution | OK | All 32 ADR IDs cited in CLAUDE.md exist as files |
| contract_name_resolution | N/A pre-M2 | Schema dir is placeholder; check applies post-M2 |
| walk_fold_resolution | OK | All fold-into refs across 3 walks resolve |
| markdown_link_integrity | OK | All sampled relative paths resolve to real files/dirs |
| adr_reeval_trigger_check | OK | 6 ADRs have triggers; surfaced for awareness; no triggers fired in 4 days since M0 |
| open_questions_hygiene | OK | 4 OPEN entries remain (sections 3, 7, 8, 9); each is genuinely benchmark-required or strategically deferred -- none fail the hygiene test |
| traceability_coverage | **GAP** | 4 of 16 BRD epics (3, 11, 12, 14) have 0 ADR citations; some intentional, some warrant attention |
| frontmatter_validation | OK | All 32 ADRs have required fields (id, trace_id, category, session, composer, timestamp) |
| **Walk re-run** | OK | All 3 walks (analyst, dev, designer) re-validated against current ARCH; no drift |
| **Stale markers (TODO/FIXME/TBD)** | OK | Zero markers in canonical docs |

**Headline:** 1 critical drift (fictional NF-12 trace ID), 1 minor drift (US-99.1 example collides with the validator's own pattern), 4 epic-coverage gaps for review (some legitimate). Three fixes filed as PRs (see "Drift items requiring fix" below). All other checks clean.

---

## Drift items requiring fix

### D1 (CRITICAL) -- Fictional NF-12 trace ID cited in canonical content

**Where:**
- `docs/architecture/walks/designer-week-1.md:74,92` -- the designer walk uses `NF-12` as the contribution's trace ID for the Button component example.
- `docs/architecture/ARCHITECTURE.md:814` (section 6.5.2) -- the Figma triage metadata-comment example shows `"trace_ids": ["NF-12"]`.

**Why it matters:** Per the trace_id_resolution check, every cited trace ID must exist in `traceability.json` and resolve to a real BRD entry. `NF-12` does not exist; the BRD does not currently define any NFs at all. Worse, the example in ARCH 6.5.2 is part of the operational spec for designers using Atelier -- it teaches them to cite trace IDs that won't validate.

**Root cause:** Authored on 2026-04-27 during the designer-week-1 walk session. I introduced `NF-12` as a hypothetical "non-functional requirement about button accessibility" without checking whether NFs were defined. The annotation in the walk admits it is hypothetical, but the citation in ARCH 6.5.2 does not.

**Fix:** Replace `NF-12` everywhere with `US-3.4` (an existing BRD story in Epic 3 -- prototype web app, plausibly a button-component-related story) OR introduce `NF-1` properly into BRD if the team wants NF as a first-class trace category. Recommended: replace with an existing US since the BRD has not yet established the NF format and introducing it via an example sets a poor precedent. The walk's hypothetical note can stay (changed to "NF-X represents a hypothetical NF kind not yet defined in BRD") but the canonical example in ARCH 6.5.2 must use a real ID.

### D2 (MINOR) -- US-99.1 example collides with validator's own pattern

**Where:** `scripts/README.md:111` -- the trace_id_resolution check description uses `US-99.1` as an example of a non-resolving trace ID.

**Why it matters:** The validator scans all docs for trace ID patterns and resolves them against the registry. The example string itself matches the pattern and would be flagged as a real failure when the validator runs.

**Root cause:** Authored on 2026-04-28 during the validator-spec session. I picked a plausible-looking placeholder; the validator can't distinguish "example of a failure" from "actual failure citation."

**Fix:** Two options:
- (A) Reword the example using a non-matching placeholder: "A doc cites a trace ID like `US-XX.YY` that does not exist". The XX.YY format does not match `[0-9]+\.[0-9]+` and won't be picked up by the scanner.
- (B) Document an exemption mechanism in the validator: trace IDs inside fenced code blocks are skipped, OR specific files can opt out via a `<!-- trace-id-validator: skip -->` comment.
Recommended: (A). It avoids exemption complexity and the example reads just as clearly.

### D3 (REVIEW) -- Epic-coverage gaps

**Where:** Epics 3 (canonical artifact prototype), 11 (CLI tooling), 12 (observability), 14 (composer lifecycle) have 0 ADR citations across all per-ADR files in `docs/architecture/decisions/`.

**Why it matters:** The traceability_coverage check expects every BRD epic to have at least one resolution path (ADR, contribution, or implementation reference). Pre-M2 there are no contributions or implementation references, so ADR citations are the only signal. Zero citations may mean (a) the epic is genuinely implementation-only and never warranted an architectural decision (legitimate gap), or (b) decisions were made implicitly without recording them as ADRs (real drift).

**Per-epic assessment:**
- **Epic 3 (canonical artifact prototype web app):** Implementation-heavy. ADR-001 covers the prototype-as-canonical-artifact decision but uses trace `BRD:Epic-1` instead of `BRD:Epic-3`. Recommend updating ADR-001 frontmatter -- but ADR files are append-only, so the alternative is filing a meta-note here that ADR-001 implicitly covers Epic 3, or filing a new ADR explicitly tagged for Epic 3 if a fresh decision arises. **Action: tracked but not blocking.**
- **Epic 11 (CLI tooling):** Implementation-heavy. ADR-008 (5 sync substrate scripts) and several others touch CLI-adjacent concerns. Plus BUILD-SEQUENCE Epic 1 sequencing table covers CLI command timing. The genuinely-architectural CLI decisions (e.g., `atelier audit` and `atelier review` added today) may warrant an ADR if they're load-bearing. **Action: re-evaluate at M1 exit -- if `atelier audit` becomes a defining capability rather than a thin CLI wrapper, file an ADR.**
- **Epic 12 (observability):** Mostly architecture (ARCH section 8), implementation pending. No load-bearing decision yet -- the observability stack design follows directly from ARCH 8 + ADR-027 (Vercel + Supabase). **Action: file an ADR if and when an observability-specific decision arises; not now.**
- **Epic 14 (composer lifecycle):** Touches sessions and reaper logic. ADR-009 (remote-principal actor class) addresses composer surface but uses `BRD:Epic-16`. Same pattern as Epic 3 -- decision exists, trace tagging is on a different epic. **Action: file a meta-note acknowledging ADR-009 implicitly covers Epic 14.**

**Net:** Of the 4 gaps, none are spec-correctness failures. They are trace-tagging precision issues and one potential M1-emergent ADR opportunity. Recommend updating this audit's appendix with the per-epic assessment as the resolution; no PRs to file unless the user disagrees.

### D4 (FORMAT) -- Epic 11 stories not formally enumerated

**Where:** `docs/functional/BRD.md:548-553` -- Epic 11 is described as "US-11.1 through US-11.9 map 1:1 to the commands" without an enumerated story-by-story block.

**Why it matters:** The traceability_coverage check expects each US-X.Y to be a discrete BRD entry. The bulk-description format means US-11.1 through US-11.9 don't have independently-validatable acceptance criteria. The actual citation `US-11.9` (in BRD itself) refers to a story that exists by reference but not by enumeration.

**Fix:** Either (a) expand Epic 11 into 9 enumerated stories matching the rest of BRD's format, or (b) document the bulk-description pattern as an accepted variant in BRD.md's story format section (currently section 4). Recommended: (a) -- consistency across epics is worth the small expansion. Each story can be one-liner.

---

## Walk re-run results

Each composer-surface walk was re-validated against current ARCH:

- **analyst-week-1.md** -- All 7 steps' Status rows still hold against ARCH sections cited. Section 7 audit table accurately maps each step to the ARCH subsections that landed during the 2026-04-27 retroactive sweep. **No drift.**
- **dev-week-1.md** -- All 10 steps' Status rows hold. Section 4 "Latent gaps surfaced and folded" table accurately points at ARCH 6.7 (lens defaults), 6.2.1.5, 6.2.2.1, 6.2.3, 6.3.1, 7.4.1, 7.4.2 -- all exist. **No drift.**
- **designer-week-1.md** -- All 10 steps' Status rows hold against ARCH 7.4.1.1, 6.5.1, 6.5.2, 6.6.2 -- all exist. **However, the example in Step 4 cites `NF-12` (per D1 above) -- this is a content drift to fix, not a structural drift.**

---

## ADR re-evaluation triggers report

Six ADRs carry a `Re-evaluation triggers` section. Status as of 2026-04-28 (4 days post-M0):

| ADR | Trigger summary | Fired? |
|---|---|---|
| ADR-027 (reference impl stack) | Supabase pricing/RLS-policy ceiling change; Vercel runtime change; pgvector p95 degradation | No (pre-implementation) |
| ADR-028 (identity default Supabase Auth) | Supabase Auth deprecation or breaking JWT change; >50% of users override identity | No (no users) |
| ADR-029 (GCP-portability constraint) | GCP discontinues Cloud SQL or Identity Platform; zero migration interest in 12mo; Vercel/Supabase ships breaking-the-value-prop feature | No (pre-implementation) |
| ADR-030 (per-ADR file split) | Large reformat would benefit from re-evaluation | No (working as intended) |
| ADR-031 (three-tier consumer model) | One tier dominates user adoption such that the other two become carrying cost | No (pre-implementation) |
| ADR-032 (extended doc structure) | claude-docs-toolkit revises its model; cross-doc reference churn from moves persists | No (one-time migration completed) |

**No triggers fired.** Re-check at M1 exit.

---

## Open questions hygiene re-check

18 entries in `BRD-OPEN-QUESTIONS.md`. Status:

| Status | Count | Entries |
|---|---|---|
| RESOLVED | 14 | 1, 2, 4, 5, 6 (design level), 10, 11 (design level), 12 (design level), 13, 14, 15, 16, 17, 18 |
| OPEN -- benchmark required | 2 | 3 (embedding model), 7 (scale ceiling) |
| OUT v1 / DEFERRED | 2 | 8 (cost accounting OUT v1), 9 (cross-repo DEFERRED v1.x) |

**All 4 OPEN/DEFERRED entries pass the hygiene test.** None are spec gaps masquerading as questions. Sections 3 and 7 require real benchmark data; sections 8 and 9 are strategic scope decisions.

**No drift.**

---

## Sign-off

The architect role (manual audit by sole composer, this session) signs off on M0 exit subject to:

1. **D1 fix lands as a follow-up PR** (NF-12 -> US-3.4 + walk note clarifies hypothetical NF format)
2. **D2 fix lands as a follow-up PR** (US-99.1 -> US-XX.YY non-matching placeholder)
3. **D3 noted in this audit's appendix** as resolved by per-epic assessment; no further action unless user contests
4. **D4 fix optional**: enumerate Epic 11 stories in BRD format -- recommend doing it but does not block sign-off

D1 and D2 should land before any further work that exercises the validator. D3 stays as an audit-trail entry. D4 is hygiene that can land any time.

---

## Appendix: epic-coverage per-epic notes (resolves D3)

| Epic | Title | ADR coverage | Disposition |
|---|---|---|---|
| 1 | Project scaffolding & lifecycle | 13 ADR citations | Well covered |
| 2 | Agent interop endpoint | 2 ADR citations (013, 022) | Adequate; ADR-013 is the load-bearing one |
| 3 | Canonical artifact prototype | 0 direct citations; ADR-001 implicitly covers | Trace-tag precision issue; ADR-001 could carry Epic-3 trace too. Append-only convention prevents retro-edit. Acceptable. |
| 4 | Territory + contribution model | 4 ADR citations | Well covered |
| 5 | Decision durability | 1 (ADR-005) | Adequate; that's the load-bearing decision |
| 6 | Find_similar + eval harness | 1 (ADR-006) | Adequate |
| 7 | Locks + fencing | 2 (ADR-004, ADR-026) | Adequate |
| 8 | Territory contracts | 1 (ADR-014) | Adequate |
| 9 | Sync substrate | 2 (ADR-008, ADR-016) | Adequate |
| 10 | External integrations | 1 (ADR-019) | Adequate |
| 11 | CLI tooling | 0 direct citations | Mostly implementation; revisit at M1 exit if `atelier audit` becomes a defining capability |
| 12 | Observability | 0 direct citations | Mostly architecture (ARCH 8) following from ADR-027; no load-bearing decision warrants a dedicated ADR yet |
| 13 | Security model | 1 (ADR-007) | Adequate |
| 14 | Composer lifecycle | 0 direct citations; ADR-009 implicitly covers | Same as Epic 3 -- ADR-009's trace tag is BRD:Epic-16 (remote composer) but its scope touches Epic 14. Acceptable. |
| 15 | Role-aware lenses | 2 (ADR-017, ADR-025) | Well covered |
| 16 | Remote composer support | 2 (ADR-009, ADR-023) | Well covered |

**No epic is fully unaddressed in design.** The 0-citation epics are either implementation-heavy (3, 11, 12) or have implicit coverage by an ADR tagged to an adjacent epic (14 by ADR-009). The trace-tagging precision issue is real but not actionable retroactively due to the append-only convention. Future ADRs touching these epics should tag the appropriate trace_ids.

---

## Resolutions

| Drift | Status | Resolved by |
|---|---|---|
| D1 (CRITICAL) -- NF-12 fictional | RESOLVED 2026-04-28 | ARCH section 6.5.2 metadata example uses `US-3.3`; designer-week-1 walk Step 4 + Step 6 branch name updated to `US-3.3`; walk prose reframed to say `US-3.3` is illustrative and to note teams may introduce a dedicated NF category by adding stories to BRD if their workflow benefits |
| D2 (MINOR) -- US-99.1 example | RESOLVED 2026-04-28 | scripts/README.md trace_id_resolution example now reads `US-XX.YY` (placeholder format that does not match the validator's `[0-9]+\.[0-9]+` pattern) |
| D3 (REVIEW) -- Epic-coverage gaps | RESOLVED in audit appendix 2026-04-28 | Per-epic assessment in this report's appendix concludes none are spec-correctness failures; trace-tagging precision is not retroactively actionable due to ADR append-only convention |
| D4 (FORMAT) -- Epic 11 not enumerated | RESOLVED 2026-04-28 | BRD Epic 11 now enumerates US-11.1 through US-11.9 with the standard story format. **Follow-up surfaced:** BUILD-SEQUENCE Epic 1 sequencing has expanded since the original BRD Epic 11 to include `atelier audit` and `atelier review` (added 2026-04-28 per METHODOLOGY section 11), creating a BRD-vs-BUILD-SEQUENCE drift on the canonical CLI command list. Tracked as a follow-up to fold audit/review/upgrade into BRD Epic 11 (or to formally split CLI tooling into multiple epics). Not blocking M0 sign-off. |

**Architect sign-off on M0 exit: APPROVED 2026-04-28** subject to the BRD Epic 11 follow-up landing at the next opportunity (no specific deadline; not a blocker for M1 implementation start).
