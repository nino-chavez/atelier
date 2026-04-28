# Walk: Dev week-1 implementation scenario

**Companion to:** `../../functional/BRD-OPEN-QUESTIONS.md` (no specific entry; see `../../../.atelier/checkpoints/SESSION.md` "What the next session should do first" for walk authorship guidance)
**Status:** Authored 2026-04-27 with the latent-gaps re-examination discipline applied from the start (per the analyst-week-1 walk section 7 audit).
**Owner:** Nino Chavez
**Last updated:** 2026-04-27
**Related:** `analyst-week-1.md`, `../../strategic/NORTH-STAR.md`, `../ARCHITECTURE.md`, `../../../.atelier/territories.yaml`

---

## 1. Purpose

The analyst walk validated the territory model and surfaced gaps for web-surface composers authoring research artifacts. This walk validates the dev path -- IDE-surface composer implementing a BRD-ingested user story against the codebase. Different surface, different territory (`protocol` or `prototype-app`), different scope_kind (`files`), different review pattern (PR-merge), different commit ownership (local git, no per-project committer). Ground rules from the analyst walk apply: gaps surface concretely, fold into ARCH in the same commit, no after-the-fact sweeps.

---

## 2. Scenario

A dev composer (Sam) joins the project to implement `US-2.9` (Acquire lock, per BRD Epic 2). Sam uses Claude Code as their agent client. They:

1. Connect Claude Code to the project's MCP endpoint, register an IDE-surface session
2. Read context for `US-2.9` (the user story, related decisions, current locks-related code state)
3. Run `find_similar` for prior locks-related work
4. Claim the pre-existing `US-2.9` contribution row (BRD-ingested into `state=open`)
5. Acquire locks on the files they will edit
6. Author code via Claude Code (multiple `update` + commit iterations on a feature branch)
7. Log decisions about implementation choices
8. Open a PR (transition to `state=review`)
9. Address review feedback
10. PR merges to main; contribution transitions to `state=merged`

Pre-conditions assumed in place:
- `projects` row for atelier exists.
- `composers` row for Sam exists with `default_role=dev`, valid token issued via `atelier invite`.
- `territories.yaml` defines `protocol` with `scope_kind=files`, `scope_pattern: ["prototype/src/lib/protocol/**", "scripts/sync/**"]` (confirmed in `../../../.atelier/territories.yaml`).
- BRD Epic 2 stories were ingested into `contributions` as `state=open` rows during M1's traceability sync, each carrying `kind=implementation`, `trace_ids=["US-2.X"]`, `territory_id=<protocol-id>`, no `author_session_id`.
- Sam has the endpoint URL (`ATELIER_ENDPOINT_URL`) and bearer token configured in their Claude Code client per ARCH section 7.9.

---

## 3. Step-by-step walk

### Step 1 -- Register IDE-surface session

| Layer | Detail |
|---|---|
| **Tool** | `register(project_id, surface="ide", composer_token, agent_client="claude-code")` |
| **Schema** | INSERT `sessions` (project_id, composer_id, surface="ide", agent_client="claude-code", status="active", heartbeat_at=now). Returns `session_token` scoped narrower than the composer token. |
| **Prototype** | `/atelier` dev lens shows Sam under "active participants" with surface badge. |
| **Status** | Clean. ARCH section 7.9 covers IDE-surface auth: same OAuth-2.1-or-static-bearer scheme as web; Claude Code holds the token in its MCP server config (typically a workspace-scoped settings file). No additional spec needed. |

### Step 2 -- Read context for US-2.9

| Layer | Detail |
|---|---|
| **Tool** | `get_context(trace_id="US-2.9", lens="dev")` per ARCH section 6.7 |
| **Schema** | Per ARCH section 6.7 implicit project scope. Returns charter file paths, `recent_decisions` in three adjacency bands (direct US-2.9 matches, epic siblings sharing `BRD:Epic-2`, contribution-linked), territories partitioned (protocol owned, capability_interfaces consumed), contributions_summary weighted per `lens="dev"` defaults, traceability_slice for US-2.9. |
| **Prototype** | `/strategy` and `/atelier` dev lens render the same context. Dev lens shows file-level claims and locks prominently; analyst lens by contrast weights research more heavily. |
| **Status** | **Latent gap.** ARCH section 6.7 says "lens shapes per-section depth defaults. Defaults documented in `.atelier/config.yaml: get_context.lens_defaults`" -- but those defaults were never actually defined. Folded into config.yaml + ARCH section 6.7 in this commit. |

### Step 3 -- Run find_similar for prior locks work

| Layer | Detail |
|---|---|
| **Tool** | `find_similar(description="acquire_lock implementation with fencing token allocation", trace_id="US-2.9")` per ARCH section 6.4 |
| **Schema** | Project-scoped per ARCH section 6.4.3. Returns two-band response (primary + weak) per section 6.4.1. Sam reviews matches; finds ADR-004 (fencing tokens mandatory) and ADR-026 (own-implementation, not Switchman) as primary direct matches; ADR-022 (claim atomic-creates) as epic-sibling. |
| **Prototype** | `/atelier` dev lens "before you start" panel shows the matches. |
| **Status** | Clean. Already specified in ARCH 6.4.x. |

### Step 4 -- Claim the pre-existing US-2.9 contribution

| Layer | Detail |
|---|---|
| **Tool** | `claim(contribution_id=<US-2.9-row-id>)` -- the pre-existing path, NOT atomic-create. |
| **Schema** | UPDATE contributions SET state="claimed", author_session_id=<sam's session>, updated_at=now WHERE id=<...> AND state="open". The conditional WHERE prevents claiming an already-claimed row (returns CONFLICT). Implicit `find_similar` gate runs (per section 6.2.1) and returns warnings even on pre-existing claim. |
| **Prototype** | `/atelier` dev lens moves the contribution from "open work" to "Sam's claimed work." PM lens sees the same transition for capacity tracking. |
| **Status** | **Latent gap.** ARCH section 6.2.1 covered the atomic-create path. The pre-existing path was mentioned in section 6.2 high-level but not formalized: response shape, race handling, find_similar gate behavior on pre-existing rows, idempotency. Folded into ARCH section 6.2.1.5 in this commit. |

### Step 5 -- Acquire locks on the files to edit

| Layer | Detail |
|---|---|
| **Tool** | `acquire_lock(contribution_id, artifact_scope=["prototype/src/lib/protocol/tools/acquire_lock.ts", "prototype/src/lib/protocol/lib/fencing.ts", "prototype/eval/locks/acquire_lock.test.ts"])`. May be called multiple times if Sam discovers more files needed during work. |
| **Schema** | INSERT `locks` row per ARCH section 5.1. Allocate fencing_token from per-project monotonic counter. Conflict check: GIN-indexed scope-overlap query against existing `locks` rows for the project. If overlap with another active lock, return CONFLICT with the conflicting lock's id. |
| **Prototype** | `/atelier` dev lens "active locks" panel shows Sam's lock with the artifact scope and fencing token. |
| **Status** | **Multiple latent gaps.** Lock spec to date covers schema (section 5.1) and high-level fencing (section 7.4). Operational details missing: (a) glob semantics for artifact_scope -- exact match, prefix, glob? (b) multi-lock per contribution -- one acquire_lock call or multiple? (c) overlap detection algorithm. (d) acquire_lock failure modes for IDE composers (no endpoint write-mediation). All folded into new ARCH section 7.4.1 in this commit. |

### Step 6 -- Author code via Claude Code

| Layer | Detail |
|---|---|
| **Tool** | `update(contribution_id, state="in_progress", payload=<initial commit message>, fencing_token=<from acquire_lock>)`. Note: for IDE-surface composers, `update` does NOT write to the artifact -- the agent writes locally. The `update` call signals "I am working" and may carry a commit message hint that the agent uses for its own commit. |
| **Schema** | UPDATE contributions SET state="in_progress" + a new `repo_branch` field (set on first update; default `<kind>/<first-trace-id>-<short-id>`). The endpoint does not validate file content; it trusts the IDE to write per the lock. |
| **Prototype** | `/atelier` dev lens shows "in_progress" badge + the configured branch name + the count of commits observed on that branch (post webhook integration, see Status). |
| **Status** | **Latent gaps -- two.** (a) The endpoint's observation of IDE commits was hand-waved. ARCH 6.2.2 says "the endpoint observes the branch via the contribution row's repo_branch field" but never said HOW. Folded into ARCH section 6.2.2 with a new subsection on commit observation via webhook. (b) Fencing semantics for IDE composers were ambiguous -- ARCH 7.4 implies server-side validation on every write, but IDE writes never reach the server. Folded into ARCH section 7.4.2 clarifying fencing as soft-coordination for IDE composers, hard-validated at PR-open time via the webhook. |

### Step 7 -- Log decisions about implementation choices

| Layer | Detail |
|---|---|
| **Tool** | `log_decision(category="architecture", trace_ids=["US-2.9"], summary="acquire_lock returns fencing_token in body not header", rationale=<...>)` per ARCH section 6.3 + 6.3.1 |
| **Schema** | Four-step atomic operation per section 6.3. The decision file `docs/architecture/decisions/ADR-NNN-acquire-lock-returns-fencing-token-in-body-not-header.md` is created via the per-project endpoint committer (decisions ALWAYS go through the endpoint, even for IDE composers, because they require ADR-NNN allocation and the append-only invariant per ADR-005). |
| **Prototype** | `/atelier` dev lens decisions panel updates on broadcast (post-M4). |
| **Status** | **Latent gap.** ARCH section 6.3 + 6.3.1 cover the four-step atomic operation but did not distinguish: for IDE composers, who commits the ADR file? IDE composers don't use the per-project committer for code edits. But they MUST use it for ADRs (centralized NNN allocation). Folded into ARCH section 6.3.1 in this commit clarifying that decision commits always route through the endpoint committer regardless of surface. |

### Step 8 -- Open a PR (transition to review)

| Layer | Detail |
|---|---|
| **Tool** | `update(contribution_id, state="review")`. Sam must have already pushed commits to the branch via local git. |
| **Schema** | UPDATE contributions SET state="review". The endpoint observes the branch (per the webhook integration added in Step 6) and verifies commits exist. The endpoint then opens a PR via the versioned-file-store API, attributed to Sam's bot identity (or directly via Sam's identity if `git_provider.use_composer_identity_for_pr_open: true` in config). |
| **Prototype** | `/atelier` PM/architect lens (per `territories.review_role`) shows the new PR for review. |
| **Status** | **Latent gap.** ARCH section 6.2.3 said "for repo-resident artifacts, the contribution branch carries an open PR (created by the endpoint committer at the moment of the state=review transition)." For remote-surface composers, the per-project committer opens the PR. For IDE composers, who opens it? Folded into ARCH section 6.2.3 with explicit IDE-surface PR-open semantics. |

### Step 9 -- Address review feedback

| Layer | Detail |
|---|---|
| **Tool** | None directly. Reviewer leaves PR comments via the versioned-file-store UI. Sam reads comments locally, edits code, pushes more commits to the same branch. |
| **Schema** | Locks remain held by Sam's session. The contribution stays in `state=review` while iterations happen. No additional Atelier state changes per iteration. |
| **Prototype** | `/atelier` dev lens shows commit count incrementing on the branch; reviewer lens shows PR activity via the underlying provider. |
| **Status** | Clean. Atelier intentionally does not mediate PR review -- it trusts the underlying provider's review tooling. The `triage` script handles inbound PR comments only when they cross trace-ID boundaries (per Epic 9). |

### Step 10 -- PR merges to main

| Layer | Detail |
|---|---|
| **Tool** | None directly. Reviewer merges the PR via provider UI. |
| **Schema** | Merge webhook fires; endpoint observes the merge to `main` carrying the contribution's branch's commits. UPDATE contributions SET state="merged". DELETE locks WHERE contribution_id=<...>. |
| **Prototype** | `/atelier` shows the contribution archived; recent-merges feed updates; traceability registry resolves US-2.9 to the merge commit on next traceability sync. |
| **Status** | Clean. Specified in ARCH section 6.2.3 (PR merge observed via webhook = authoritative state transition). |

---

## 4. Latent gaps surfaced and folded in this commit

| Gap | ARCH section folded into |
|---|---|
| Lens defaults for `get_context` (Step 2) -- mentioned in section 6.7 but never defined | section 6.7 + `.atelier/config.yaml: get_context.lens_defaults` |
| Pre-existing claim path operational details (Step 4) -- atomic-create was specified in section 6.2.1; pre-existing was high-level only | section 6.2.1.5 (added) |
| Lock granularity + multi-lock + glob semantics + IDE-surface failure modes (Step 5) | section 7.4.1 (added) |
| Endpoint observation of IDE-side commits via webhook (Step 6) | section 6.2.2 extended |
| Fencing semantics for IDE composers -- soft-coordination + hard-validated at PR-open (Step 6) | section 7.4.2 (added) |
| Decision commits always route through endpoint committer regardless of surface (Step 7) | section 6.3.1 extended |
| PR-open responsibility for IDE-surface composers (Step 8) | section 6.2.3 extended |

---

## 5. Cross-references

- analyst-week-1.md -- the prior walk; section 7 documents the after-the-fact sweep that motivated this walk's discipline.
- ARCH section 6.2.x -- contribution lifecycle (claim, update, release, review-and-merge)
- ARCH section 6.3.x -- log_decision (four-step atomic operation, ADR allocation, decision-commit routing)
- ARCH section 6.4.x -- find_similar (thresholds, corpus, scoping)
- ARCH section 6.7.x -- get_context (signature, adjacency, token budget, lens defaults)
- ARCH section 7.4.x -- lock + fencing (acquire/release, glob semantics, IDE soft-coordination)
- ARCH section 7.8.x -- remote-surface committer + transcript capture
- ARCH section 7.9 -- web-surface auth (also covers IDE auth via the same scheme)
