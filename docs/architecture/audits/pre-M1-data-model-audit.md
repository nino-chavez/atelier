---
last_updated: 2026-04-28 (supplemental sweep added: G1-G7 covering projects/composers/sessions tables and ARCH 5.3 RLS rules; gaps from initial audit closed in same commit)
status: complete; all findings landed (ADR-033/034/035/036/037 + ARCH 5.1 + 5.3 edits + BRD-OPEN-QUESTIONS section 20 + supplemental G1-G7). This doc is now the forensic + worked-example record per METHODOLOGY 11.5.
audit_kind: data-model + contract
applies_to: ARCH section 5.1 (Datastore schema, all tables), 5.3 (Authorization), 5.4 (Vector index), 6.2.2 (Update operation), 6.6 (Contract flow), 7.4 (Fencing)
---

# Pre-M1 data-model and contract audit

**Audit run:** 2026-04-28
**Auditor:** architect role (manual; `atelier audit --milestone-entry` is M7 work)
**Milestone gate:** M1 entry
**Per:** METHODOLOGY 11.5 (the section was added in the same commit as this audit -- this is the worked-example referenced there)

---

## Why this audit existed

The walks (analyst, dev, designer) validated end-to-end flow correctness. They did not audit the schema for semantic-axis cleanliness, derivable-vs-stored coherence, or constraint-surface completeness. The `kind=proposal` semantic conflation surfaced via conversation on 2026-04-28 rather than from a prior audit -- exact evidence the audit pattern was missing. Codifying METHODOLOGY 11.5 makes the pattern routine instead of incidental.

The audit applies five checks to the v1 schema before M1 implementation encodes it:

1. **Field semantic atomicity** -- each column carries exactly one classification axis
2. **Derivable vs stored** -- denormalizations are intentional and documented
3. **Enum coherence** -- every enum's values share one classification axis; no "other" / "misc" smuggling
4. **Constraint surface** -- CHECK constraints, FKs, NOT NULL, transition rules are specified
5. **Lifecycle invariants** -- mutability per field, permitted state transitions, FK durability across row deletions

---

## Findings index

18 findings: 6 HIGH, 7 MEDIUM, 5 LOW. Each row points at the canonical resolution.

| # | Severity | Smell (one-line) | Landed at |
|---|---|---|---|
| F1 | HIGH | `contributions.kind` value `proposal` mixed provenance into a discipline enum | [ADR-033](../decisions/ADR-033-contribution-kind-scoped-to-output-discipline.md) |
| F2 | HIGH | `contributions.kind` value `decision` was unreachable (decisions flow via `log_decision`) | [ADR-033](../decisions/ADR-033-contribution-kind-scoped-to-output-discipline.md) |
| F3 | LOW | `vector_index.source_kind` shares the `_kind` suffix with `contributions.kind` and `territories.scope_kind` despite distinct namespaces | ARCH 5.1 / 5.4 documentation note (this commit) |
| F4 | HIGH | `contributions.state` mixed lifecycle position with the `blocked` status flag | [ADR-034](../decisions/ADR-034-contribution-state-separated-from-blocked-status-flag.md) |
| F5 | HIGH | `contracts.breaking_change` boolean missed the override + classifier-reasons surface specified in ARCH 6.6.1 | [ADR-035](../decisions/ADR-035-contract-metadata-covers-arch-661-classifier-surface.md) |
| F6 | MEDIUM | `decisions.category` included vestigial `convention` value with no specified semantics | [ADR-037](../decisions/ADR-037-decisions-table-cleanup-drop-convention-add-contribution-link.md) |
| F7 | MEDIUM | `decisions` had no link back to triggering contribution | [ADR-037](../decisions/ADR-037-decisions-table-cleanup-drop-convention-add-contribution-link.md) |
| F8 | LOW | `contributions.transcript_ref` shape unspecified (path? URL? both?) | ARCH 5.1 CHECK constraint + comment (this commit) |
| F9 | HIGH | `contributions.author_session_id` would dangle when session row deleted by reaper after 24h | [ADR-036](../decisions/ADR-036-immortal-author-identity-via-composer-id.md) |
| F10 | LOW | `locks.session_id` same dangling-FK shape (mitigated by reaper but undocumented) | [ADR-036](../decisions/ADR-036-immortal-author-identity-via-composer-id.md) |
| F11 | HIGH | Schema-spec drift: `repo_branch`, `commit_count`, `last_observed_commit_sha` referenced by ARCH 6.2.2.1 but absent from 5.1; `locks.contribution_id` similarly absent despite ARCH 7.4.1 | ARCH 5.1 schema fields added (this commit; not an ADR -- spec-drift correction) |
| F12 | MEDIUM-HIGH | `composers.default_role` enum mixed work-discipline with access-level | [BRD-OPEN-QUESTIONS section 20](../../functional/BRD-OPEN-QUESTIONS.md) (filed; needs strategic call; does not block M1) |
| F13 | informational | `kind=proposal` role check is the actual gate (covered by F1 rationale; no separate fix) | n/a |
| F14 | LOW | `vector_index.source_kind` `brd_section` vs `prd_section` granularity opacity | ARCH 5.4 documentation cross-ref (this commit) |
| F15 | HIGH (folded with F9) | `decisions.session_id` dangling FK after session deletion | [ADR-036](../decisions/ADR-036-immortal-author-identity-via-composer-id.md) |
| F16 | MEDIUM | `contributions.trace_ids` non-empty constraint enforced API-level only; direct SQL inserts could bypass | ARCH 5.1 CHECK constraint (this commit) |
| F17 | LOW | `locks.expires_at` lifecycle unclear (auto-enforced? hint?) | ARCH 7.4 documentation note (this commit) |
| F18 | HIGH (folded with F9) | `telemetry.session_id` dangling FK after session deletion | [ADR-036](../decisions/ADR-036-immortal-author-identity-via-composer-id.md) |

---

## Supplemental sweep (G1-G7, run same day)

The initial audit applied the five checks to the contribution-adjacent tables (contributions, decisions, locks, contracts, telemetry) plus the vector index. A supplemental sweep on the same day extended coverage to `projects`, `composers`, `sessions`, and ARCH 5.3 (Authorization) -- triggered by the user's "confirm hardened and complete" check, which surfaced that the initial audit's scope was narrower than `applies_to: 5.1` claimed.

| # | Severity | Smell (one-line) | Landed at |
|---|---|---|---|
| G1 | HIGH | ARCH 5.3 RLS rule referenced `author_session_id` for authorization despite ADR-036 making `author_composer_id` the immortal identity -- spec drift introduced by today's commit | ARCH 5.3 rewritten (this commit) |
| G2 | HIGH | `requires_owner_approval` flag (added by ADR-033) had no specified clearing mechanism -- no tool recorded approval in datastore per ARCH 7.5 | `update()` extended with `owner_approval` parameter; `contributions.approved_by_composer_id` + `approved_at` columns added; ARCH 6.2.2 specifies the recording operation (this commit) |
| G3 | MEDIUM | `composers.email` lacked UNIQUE(project_id, email) constraint -- two composers per project with same email was unspecified behavior | UNIQUE constraint added to ARCH 5.1 (this commit) |
| G4 | MEDIUM | `sessions.status` value `idle` -- transition rule undefined (only active->dead was spec'd via reaper) | ARCH 5.1 documented: active when heartbeat within `policy.session_active_window_seconds` (default 60s), idle when within `session_ttl_seconds` (default 90s) but past active window, dead past ttl (this commit) |
| G5 | LOW | `sessions.agent_client` free text without validation rule | ARCH 5.1 documented as opaque-by-design; endpoint records but does not validate (this commit) |
| G6 | LOW | `composers.token_hash` rotation history collapsed into single `token_rotated_at` timestamp; no replay-detection log | Deferred to v1.x (replay detection lives in identity service event log; documented in ARCH 5.1 inline note this commit) |
| G7 | LOW | `projects.template_version` schema unspecified | ARCH 5.1 documented as semver-shaped string validated by `atelier upgrade` per ARCH 9.7 (this commit) |

**Why the gaps existed.** The initial audit pass focused on tables it had touched recently (contributions, decisions, locks, contracts, telemetry) and treated projects/composers/sessions as "background infrastructure." That implicit scope-narrowing was not declared. Going forward, a data-model audit per METHODOLOGY 11.5 is REQUIRED to enumerate every table in scope at the start, or explicitly declare which are deferred and why.

**Process correction folded into METHODOLOGY 11.5:** the audit's first step is now an explicit "tables in scope" enumeration; deferrals require justification.

---

## What this audit did not cover

- **API surface audit** -- the 12 endpoint tools' signatures, error envelopes, idempotency keys, retry semantics. Some surfaced incidentally; a systematic API contract audit is a separate deliverable.
- **Migration safety audit** -- once M1 schema migrations exist, verify additive-preferred per ARCH 9.7.
- **Adapter contract audit** -- M1.5 ships five non-GitHub adapters (Jira, Linear, Confluence, Notion, Figma). Each adapter's contract surface needs the same five checks applied. METHODOLOGY 11.5 makes this the standing pattern for all schema-bearing milestones.

---

## How this audit pattern is invoked going forward

Per METHODOLOGY 11.5, every schema-bearing milestone gets a milestone-entry data-model audit before implementation begins:

- **M1.5** (per-adapter contracts)
- **M2** (endpoint surface + per-tool wire format)
- **M5** (vector index productionization)
- **M7** (upgrade-tooling schema)

Each future audit lands as `pre-<milestone-id>-data-model-audit.md` in this directory and follows this doc's shape: smell + diagnosis + landed-where per finding, with recommendations folded into ADRs (or filed as open questions for strategic calls). The audit doc itself stays as forensic record + worked-example for the next pass.
