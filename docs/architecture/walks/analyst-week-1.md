# Walk: Analyst week-1 research scenario

**Companion to:** `../../functional/BRD-OPEN-QUESTIONS.md §1`
**Status:** RESOLVED (2026-04-25). Walk complete; all 5 gaps landed as ADR-021, ADR-022, ADR-023, ADR-024, ADR-025. See [`../decisions/`](../decisions/).
**Owner:** Nino Chavez
**Last updated:** 2026-04-25
**Related:** `../../strategic/NORTH-STAR.md §4–§5`, `../ARCHITECTURE.md §5–§6`, `../../../.atelier/territories.yaml`

---

## 1. Purpose

Per `../../functional/BRD-OPEN-QUESTIONS.md §1`, the territory model must be validated against a concrete analyst-week-1 scenario before code is written. This document walks that scenario step by step, mapping each step to (a) the endpoint tool invoked, (b) the schema rows touched, (c) the prototype view that surfaces the result. Where any step requires a concept not yet in the design, the gap is named and a fix is proposed.

This is the prerequisite for M2 in `../../strategic/BUILD-SEQUENCE.md` — design gaps must close before the schema solidifies.

---

## 2. Scenario

An analyst composer begins week-1 competitive research touching `US-1.3` (and possibly other stories). They:

1. Connect a web-based agent client and register a session
2. Read current strategy context for `US-1.3`
3. Run find_similar to see whether prior research on this topic exists
4. Bring an open `research_artifact` contribution into existence and claim it
5. Author research content via their agent (no local IDE)
6. Log one or more decisions about findings (some cross-cutting)
7. Release the contribution for review

Pre-conditions assumed in place:
- `projects` row for atelier exists.
- `composers` row for this analyst exists with `default_role=analyst`, valid token.
- `territories.yaml` defines `strategy-research` with `scope_kind=research_artifact`, `scope_pattern=research/**/*` (confirmed in `../../../.atelier/territories.yaml`).
- The analyst has configured the Atelier endpoint URL (`ATELIER_ENDPOINT_URL`) in their web MCP client (e.g., claude.ai Connectors) and completed bearer-token setup per `../ARCHITECTURE.md §7.9` — either dynamic OAuth against the configured identity provider, or pasting a static API token issued via `atelier invite`. Token presentation: `Authorization: Bearer <jwt>` on every MCP request.

---

## 3. Step-by-step walk

### Step 1 — Register session

| Layer | Detail |
|---|---|
| **Tool** | `register(project_id, surface="web", composer_token, agent_client="claude.ai")` |
| **Schema** | INSERT `sessions` (project_id, composer_id, surface="web", agent_client, status="active", heartbeat_at=now). Returns `session_token`. |
| **Prototype** | `/atelier` analyst lens shows the session under "active participants." PM lens lists it under composer presence. |
| **Status** | Clean. No gap. |

### Step 2 — Read strategy context for US-1.3

| Layer | Detail |
|---|---|
| **Tool** | `get_context(trace_id="US-1.3", lens="analyst")` per `../ARCHITECTURE.md §6.7` |
| **Schema** | Project-scoped via session token. Reads charter file paths (excerpts opt-in), `decisions` in three adjacency bands (direct trace match, epic siblings, contribution-linked) per `§6.7.1`, `territories` partitioned into owned + consumed for the composer's role, contribution summary with `active` weighted per `lens`, `traceability_slice` for the trace + epic siblings. |
| **Prototype** | `/strategy` (the analyst can view the same context in the prototype web app). `/atelier` analyst lens shows recent decisions filtered to relevant trace IDs and contribution summary using the same per-band ranking. |
| **Status** | Clean (post-2026-04-27). Earlier "Clean. No gap." was unexamined — eight gaps were latent (signature, return shape, adjacency definition, token budget, last-N policy, auth scoping, freshness, cross-project scope). All folded into ARCH §6.7. |

### Step 3 -- Run find_similar for prior work

| Layer | Detail |
|---|---|
| **Tool** | `find_similar(description="competitive research on prototype deployment for US-1.3", trace_id="US-1.3")` per ARCH section 6.4 + 6.4.1 (thresholds and bands) + 6.4.2 (corpus and lifecycle) + 6.4.3 (scoping and isolation) |
| **Schema** | Project-scoped via session token; never crosses project boundaries (section 6.4.3). Reads `embedding` rows where `source_kind in (decision, contribution, brd_section, prd_section, research_artifact)` and trace_ids intersect the scope. Returns two bands (primary + weak) per section 6.4.1. |
| **Prototype** | `/atelier` analyst lens surfaces matches as a "before you start" panel using the two-band response shape. The find_similar tool itself is endpoint-only; the prototype is a consumer. |
| **Status** | Clean (post-2026-04-27). Earlier "Clean. Minor..." was unexamined -- six gaps were latent (description format and cap, corpus composition and embed cadence, removal semantics, the "trace_id subtree" term implying nonexistent hierarchy, model swappability mechanics, cross-project isolation as explicit non-feature). All folded into ARCH 6.4.2 + 6.4.3 with section 5.4 trimmed to data shape only. |

### Step 4 -- Create + claim a research_artifact contribution

| Layer | Detail |
|---|---|
| **Tool** | `claim(contribution_id=null, kind="research", trace_ids=["US-1.3"], territory_id=<strategy-research-id>, content_stub=<optional initial markdown>, idempotency_key=<uuid>)` per ADR-022 + ARCH section 6.2.1 |
| **Schema** | INSERT contributions (state=open, author_session_id=null, content_ref=null) + UPDATE to state=claimed + author_session_id in one transaction. If content_stub provided and surface=web, the per-project endpoint committer commits the stub to the repo as part of the same transaction (per ARCH section 7.8). Validation order: kind enum, trace_id_pattern, territory exists, role may author, content_stub size cap. |
| **Prototype** | /atelier analyst lens shows the new contribution under "claimed by me." Returned similar_warnings (from the implicit find_similar gate, see section 6.2.1) surface as a "potentially duplicate work" panel. |
| **Status** | **RESOLVED** -- ADR-022 closed Gap #1 at high level on 2026-04-24. ARCH section 6.2.1 (added 2026-04-27) closes the latent operational details: response shape with `similar_warnings`, validation order with specific BAD_REQUEST conditions, race handling (no implicit dedup), content_stub semantics, idempotency_key for retry safety, separation from lock acquisition. |

### Step 5 -- Author research content via the agent

| Layer | Detail |
|---|---|
| **Tool** | `update(contribution_id, state="in_progress", content_ref="research/US-1.3-deploy-research.md", payload=<markdown>, payload_format="full", fencing_token=<from prior acquire_lock>)` per ARCH section 6.2.2 |
| **Schema** | UPDATE contributions SET state, content_ref. Per-project endpoint committer creates branch `research/US-1.3-<short-id>` and commits the payload with the synthesized commit message convention. Multi-update iteration produces natural git history on that branch (section 6.2.2). Transcript sidecar (if `transcripts.capture: true`) accumulates in session state and persists on `state=review` / `release` / `deregister` per section 7.8.1. |
| **Prototype** | /atelier analyst lens shows in_progress contribution + commit count + transcript-pending indicator. /strategy (or research index) surfaces the new artifact once the branch is merged at section 6.2.3 review path. |
| **Status** | **RESOLVED** -- ADR-023 + ARCH section 7.8 closed Gap #2 on 2026-04-24. ARCH section 6.2.2 (added 2026-04-27) closes the latent operational details: payload formats (full vs patch), fencing requirement, branch strategy with naming convention, commit message convention, multi-update behavior, concurrency rules. Section 6.2.3 closes the merge-confirmation gap. |
| **Status (transcript)** | **RESOLVED** -- ADR-024 closed Gap #3 on 2026-04-24. ARCH section 7.8.1 (added 2026-04-27) closes the latent details: when sidecar is written (state=review / release / deregister / explicit flush), per-line jsonl schema, PII review modes (none / auto / manual; default manual when capture is on), size cap with rotation, reading transcripts via git not via the tool surface. |

### Step 6 — Log decisions about findings

| Layer | Detail |
|---|---|
| **Tool** | `log_decision(category="research", trace_id="US-1.3", summary, rationale)` per ARCH §6.3 |
| **Schema** | Four-step atomic write: append to `decisions.md`, mirror to `decisions` table, vector-index, broadcast. |
| **Prototype** | `/atelier` decisions panel updates; `/traceability` reflects new link. |
| **Status** | **GAP #4 — Multi-trace-ID support.** `decisions.trace_id` (and `contributions.trace_id`) is singular. BRD-OPEN-QUESTIONS §1 Q2 asks: research touches US-1.3 and reveals implications for US-1.5 — one decision with both, or two? The schema forces splintering. See §4. |

### Step 7 — Release the contribution for review

| Layer | Detail |
|---|---|
| **Tool** | `release(contribution_id)` |
| **Schema** | UPDATE `contributions` SET state="review", author_session_id=NULL. Pub/sub broadcast. |
| **Prototype** | The contribution should appear in *some* lens for review. NORTH-STAR §4 says "Analyst lens: proposals needing review" but doesn't specify which lens picks up `kind=research, state=review`. |
| **Status** | **GAP #5 — Lens routing for `state=review` is under-specified per kind.** BRD-OPEN-QUESTIONS §1 Q4 asks who sees the released research. See §4. |

---

## 4. Gaps surfaced and proposed fixes

### Gap #1 — Contribution creation path for ad-hoc work

**Symptom.** No `create_contribution` tool. ADR-013 fixes the surface at 12 tools. The schema assumes `state=open` exists prior to claim.

**Options.**
1. Overload `claim`: when called with `contribution_id=null` plus `kind`, `trace_id`, `territory_id`, claim creates-and-claims atomically. Keeps tool count at 12.
2. Overload `update`: same idea via `update`. Less semantically clean than (1).
3. Add `create_contribution` (13 tools). Requires reversing or amending ADR-013.
4. Repo-commit-only creation: composer's agent commits a stub `contributions/open/<id>.md`; sync substrate ingests; row appears; then claim works. Adds a round-trip for web-surface composers.

**Recommendation.** Option 1 — overload `claim`. Specify in `../../strategic/NORTH-STAR.md §5` and `../ARCHITECTURE.md §6.2` that `claim(null, kind, trace_id|trace_ids, territory_id, optional content_stub)` performs an atomic create-and-claim. Atomic-create path passes through the same datastore-first-then-mirror flow as updates. Keeps 12-tool ADR-013 intact.

**Land as.** New ADR ("claim atomic-creates open contributions") + edits to NORTH-STAR §5 and ARCHITECTURE §6.2.

---

### Gap #2 — Remote-surface repo commit path

**Symptom.** ARCH §6.2 says agents "write to artifact (file, doc region, etc.) passing fencing_token." For an IDE-surface composer this is `git commit`. For a web-surface analyst, the endpoint must commit on their behalf, but ARCH §7 doesn't specify identity, signing, failure handling, or sync timing.

**Options.**
1. Endpoint maintains a per-project synthetic git committer credential. Commits attribute as `composer-name <composer-id@project>` with `Co-Authored-By: <composer real identity>`. Push is synchronous with `update` call; failure rolls back the datastore change.
2. Async queue: endpoint writes to datastore immediately, queues the commit, syncs eventually. Simpler error path, but datastore and repo can diverge for a window — violates ADR-005's spirit (decisions write to repo first).
3. Browser pushes directly using the analyst's GitHub credentials. Requires the analyst to have a GitHub identity — collides with the goal of analysts who don't touch the repo.

**Recommendation.** Option 1 — synchronous commit by per-project endpoint committer. Add `../ARCHITECTURE.md §7.8 — Remote-surface write attribution` specifying:
- Endpoint holds a project-scoped deploy key (rotatable).
- Commits authored as `<composer.display_name> via Atelier <atelier-bot@project>` with `Co-Authored-By: <composer email>`.
- Update tool blocks until commit succeeds; on failure, datastore is not updated and tool returns retry-safe error.
- Audit log captures commit SHA + composer-id pair.

**Land as.** New ADR ("remote-surface commits use per-project endpoint committer with composer co-authorship") + new ARCH §7.8 + a row in the security architecture table.

---

### Gap #3 — Transcript storage

**Symptom.** Agent-session transcripts (the conversation that produced the artifact) are valuable for provenance, evaluation feedback, and auditability — but the schema has only `content_ref` (the distilled artifact). BRD-OPEN-QUESTIONS §1 Q3 raises this explicitly.

**Options.**
1. Sidecar file in repo: `research/US-1.3-deploy-research.transcript.jsonl`. Add `contributions.transcript_ref` (text, nullable). Gitignored by default; opt-in via `.atelier/config.yaml: capture_transcripts: true` to avoid large/PII commits.
2. External blob store: `transcript_ref` points to S3-equivalent URL. Adds infra dependency.
3. Don't capture: rely on agent client's own session history. Loses the cross-surface story.

**Recommendation.** Option 1 — sidecar in repo, gitignored by default, opt-in via config. Schema gains `contributions.transcript_ref text` (nullable). Default `capture_transcripts=false` in `.atelier/config.yaml`. Document size/PII implications in METHODOLOGY.

**Land as.** ADR ("transcripts stored as sidecar files, opt-in via config") + ARCH §5.1 schema add + `.atelier/config.yaml` template update.

---

### Gap #4 — Multi-trace-ID support

**Symptom.** `contributions.trace_id` and `decisions.trace_id` are singular `text`. Cross-cutting research (US-1.3 with implications for US-1.5) cannot be cleanly modeled.

**Options.**
1. Convert both to `text[]`. GIN index on the array. Splits trace-id queries from `WHERE trace_id='X'` into `WHERE 'X' = ANY(trace_ids)` (or `@>`).
2. Keep singular; force splitting into separate decisions/contributions per trace. Splinters rationale, fragments decision log.
3. Primary trace_id + many-to-many table: `contribution_traces`. Most flexible but adds a join.

**Recommendation.** Option 1 — `text[]` on both, GIN index. Singular case is a one-element array. ADR-005 is unaffected (still repo-first). Reversal cost is tiny if proven wrong (drop the array, keep first element).

**Land as.** ADR ("contributions and decisions support multiple trace IDs via text[]") + ARCH §5.1/§5.2 schema and index updates.

---

### Gap #5 — Lens routing for `state=review`

**Symptom.** When a contribution transitions to `review`, NORTH-STAR §4 lens definitions are partial about which lens surfaces it. For research artifacts specifically: PM? peer analyst? both?

**Options.**
1. Per-territory `review_role` field in `territories.yaml`. Default for `strategy-research` is `pm`; default for `protocol` is `dev` (peer review). Lens query reads territory metadata.
2. Per-kind global rules in `.atelier/config.yaml`: `research → pm`, `proposal → analyst`, etc.
3. Routing as a contract: territory publishes a `review_routing` contract that lenses subscribe to. Most general but heaviest.

**Recommendation.** Option 1 — `territories.review_role` field. Smallest change; reuses existing territory-as-config pattern; keeps lens query logic simple. Default mapping documented in METHODOLOGY.

**Land as.** ADR ("review routing keyed by territory.review_role") + `../../../.atelier/territories.yaml` schema doc update + lens config note in NORTH-STAR §4.

---

## 5. Open question status updates

After landing the five fixes above, BRD-OPEN-QUESTIONS §1 sub-questions resolve as:

| § | Sub-question | Resolution |
|---|---|---|
| §1 Q1 | Does `scope_kind=research_artifact` + `scope_pattern=research/**` cleanly support the flow? | **Yes**, confirmed against `../../../.atelier/territories.yaml`. Schema needs no rework. |
| §1 Q2 | Multi-trace research: one contribution or two? | **One contribution with `trace_ids text[]`** (Gap #4 fix). |
| §1 Q3 | Transcript storage? | **Sidecar in repo**, opt-in via config (Gap #3 fix). |
| §1 Q4 | Who sees the released research? | **Per `territories.review_role`**, default `pm` for `strategy-research` (Gap #5 fix). |

---

## 6. Recommended landing order

1. Land Gap #4 first (multi-trace-ID): smallest, lowest-risk, cascades into how Gap #1's `claim` overload accepts trace ids.
2. Land Gap #1 (claim atomic-create): unblocks the rest of the analyst path.
3. Land Gap #2 (remote-surface commit) and Gap #3 (transcripts) together: both touch the write path through the endpoint.
4. Land Gap #5 (review-lens routing): smallest, last.

Each lands as a new ADR in `../decisions` plus the named doc edits. After all five land, mark `../../functional/BRD-OPEN-QUESTIONS.md §1` as **RESOLVED** with a back-reference to this walk.
