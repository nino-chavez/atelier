# Solution Architecture: Atelier

**Companion to:** `../functional/PRD.md` v1.0, `../functional/BRD.md` v1.0, `../strategic/NORTH-STAR.md` v1.0
**Status:** Draft v1.0
**Owner:** Nino Chavez
**Last updated:** 2026-04-24
**Purpose:** Capability-level architecture describing components, data model, flows, and operational concerns. **Vendor-neutral by design** — specific technology choices are implementation decisions, not architecture decisions.

---

## Table of contents

1. [Solution context](#1-solution-context)
2. [Architectural principles](#2-architectural-principles)
3. [Capability map](#3-capability-map)
4. [Component topology](#4-component-topology)
5. [Data model](#5-data-model)
6. [Key flows](#6-key-flows)
7. [Security architecture](#7-security-architecture)
8. [Observability architecture](#8-observability-architecture)
9. [Deployment model](#9-deployment-model)
10. [Open architectural decisions](#10-open-architectural-decisions)

---

## 1. Solution context

From `../functional/PRD.md` and `../functional/BRD.md`, the system must:

- Scaffold projects with opinionated structure and conventions (`atelier init`)
- Expose an agent interop endpoint with 12 tools usable by IDE + web + terminal agent clients
- Serve a prototype web app as both canonical artifact and coordination dashboard
- Manage coordination state (sessions, contributions, decisions, locks, contracts) in a blackboard datastore with pub/sub broadcast
- Persist decisions to the repo first (repo-authoritative) and mirror to the datastore for query
- Provide find_similar with semantic search, a labeled eval set, and a CI precision gate
- Enforce fencing tokens on every lock to prevent data loss from GC pauses
- Synchronize repo state with external tools (delivery tracker, published-doc system, design tool) via 5 substrate scripts
- Triage external comments into proposal contributions that require human merge
- Scale to typical team sizes (2–20 composers, 1–5 projects per guild) with graceful degradation when dependencies fail

The architecture must remain vendor-neutral. Any stack that provides the required capabilities is a valid implementation.

---

## 2. Architectural principles

1. **Repo as canonical state.** The versioned file store is authoritative for discovery fields, decisions, strategic artifacts, and design components. The datastore mirrors and serves real-time coordination; it is not the system of record for content.
2. **Publish-pull asymmetry.** Publishes (repo → external) are deterministic and idempotent. Pulls (external → repo) are probabilistic and human-gated.
3. **Blackboard over hierarchy.** Composers coordinate through shared state, not through a lead or orchestrator. No single point of failure among composers.
4. **Authority by surface + scope.** Trust is assigned per field, per artifact, not per actor. Principals' harnesses are trusted because the principal is in the loop; pipelines are trusted because contracts are narrow; triage is never trusted to merge.
5. **Graceful degradation.** Every capability has a documented fallback when a dependency is unavailable. The per-ADR decision log under `decisions/` survives datastore outage. Keyword search survives vector-index outage. Repo PRs survive endpoint outage.
6. **Fencing tokens mandatory.** Every lock carries a monotonic token. Every write to locked artifact validates the token server-side. No silent data loss from GC pauses.
7. **Design-for-full, not feature-at-a-time.** Every capability in `../strategic/NORTH-STAR.md` is present at v1. Phasing is a delivery concern, not a design concern.
8. **Vendor-neutral.** No technology in the capability map is load-bearing. Implementations are swappable behind the capability interface.

---

## 3. Capability map

The system requires these capabilities from whatever stack implements it:

| Capability | Responsibilities | Substitutability |
|---|---|---|
| **Versioned file store** | Commit history, branches, webhooks, OAuth, diff API | High — git-protocol providers are fungible |
| **Relational datastore** | ACID writes, row-level authorization, structured schema, transactions | High — any Postgres-compatible engine |
| **Pub/sub broadcast** | Real-time push of row changes to connected clients | Medium — may require specific provider features |
| **Identity service** | Signed tokens (e.g., JWT), per-user scoping, role claims, token rotation | High — any OIDC-compatible provider |
| **Vector index** | Nearest-neighbor search on embeddings, refreshable, scalable to 10⁶ rows | Medium — capability is standard but embedding model choice matters |
| **Serverless runtime** | Stateless HTTP function execution, environment config, adequate cold-start behavior | High — any FaaS platform |
| **Static/edge hosting** | Deploy prototype web app with server-side rendering support | High — any CDN with SSR |
| **Agent interop protocol** | Standardized tool-call surface usable by IDE + web agent clients | Low — the ecosystem is consolidating on MCP; we adopt that consensus |
| **Cron / scheduled jobs** | Periodic execution for reapers, mirror sync, reconcile | High — any scheduler |
| **Observability sink** | Append telemetry events, query them with aggregation | High — any time-series or append-only store |
| **External adapters** | REST clients for delivery trackers, published-doc systems, design tools | Per-adapter, opinionated — each external tool requires bespoke logic |

---

## 4. Component topology

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         ATELIER PROJECT                                   │
│                                                                           │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │  VERSIONED FILE STORE (canonical state)                          │   │
│  │  ├── docs/strategic/, docs/functional/, docs/architecture/       │   │
│  │  ├── docs/architecture/decisions/ (per-ADR files, append-only)   │   │
│  │  ├── CLAUDE.md, AGENTS.md, .atelier/*.yaml                       │   │
│  │  ├── traceability.json                                            │   │
│  │  ├── research/<trace-id>-<slug>.md                               │   │
│  │  ├── prototype/ (the canonical artifact web app)                 │   │
│  │  └── scripts/ (traceability + sync substrate)                     │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                  ▲                                        │
│                                  │ commits, PRs, branches                 │
│                                  │                                        │
│  ┌────────────────────┬──────────┴──────────┬──────────────────────┐     │
│  │                    │                      │                      │     │
│  │  AGENT ENDPOINT    │   PROTOTYPE WEB APP  │   SYNC SCRIPTS       │     │
│  │  (serverless)      │   (static + SSR)     │   (scheduled/webhook)│     │
│  │                    │                      │                      │     │
│  │  12 tools:         │   Routes:            │   publish-docs       │     │
│  │  session×3         │   /                  │   publish-delivery   │     │
│  │  context×2         │   /strategy          │   mirror-delivery    │     │
│  │  contribution×3    │   /design            │   reconcile          │     │
│  │  lock×2            │   /slices/[id]       │   triage             │     │
│  │  decision×1        │   /atelier           │                      │     │
│  │  contract×1        │   /traceability      │                      │     │
│  └─────────┬──────────┴──────────┬───────────┴──────────┬───────────┘     │
│            │                     │                       │                │
│            └─────────────────────┼───────────────────────┘                │
│                                  │                                        │
│  ┌───────────────────────────────▼──────────────────────────────────┐   │
│  │  COORDINATION DATASTORE (blackboard)                              │   │
│  │  ├── Relational: projects, composers, sessions, contributions,    │   │
│  │  │                decisions (mirror), locks, contracts, telemetry │   │
│  │  ├── Pub/sub: row-change broadcast to connected clients           │   │
│  │  ├── Identity: signed composer tokens with role claims            │   │
│  │  └── Vector index: embeddings of decisions + contributions +      │   │
│  │                    BRD/PRD sections + research artifacts          │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
            ┌─────────────────────┼─────────────────────┐
            │                     │                      │
   ┌────────▼────────┐   ┌────────▼────────┐   ┌────────▼────────┐
   │  AGENT CLIENTS  │   │  EXTERNAL TOOLS │   │   HUMAN USERS   │
   │                 │   │                 │   │                 │
   │  IDE agents     │   │  Delivery       │   │  Browsers       │
   │  (Claude Code,  │   │  tracker        │   │  (prototype     │
   │   Cursor, ...)  │   │  (Jira, Linear) │   │   web app)      │
   │                 │   │                 │   │                 │
   │  Web agents     │   │  Published-doc  │   │  CLIs           │
   │  (claude.ai,    │   │  (Confluence,   │   │  (atelier ...)  │
   │   ChatGPT, ...) │   │   Notion)       │   │                 │
   │                 │   │                 │   │                 │
   │  Terminal       │   │  Design tool    │   │                 │
   │  agents         │   │  (Figma)        │   │                 │
   │                 │   │                 │   │                 │
   │                 │   │  Messaging      │   │                 │
   │                 │   │  (Slack, Teams) │   │                 │
   └─────────────────┘   └─────────────────┘   └─────────────────┘
```

Four components within the project:

1. **Agent endpoint** — serverless, stateless, implements the interop protocol with 12 tools. Validates tokens, enforces RLS, writes to datastore, reads from datastore + file store.
2. **Prototype web app** — static + SSR, renders canonical state from file store + live state from datastore pub/sub. Five routes including the coordination `/atelier` lens.
3. **Sync scripts** — scheduled or webhook-driven. publish-* writes external. mirror-* reads external. reconcile compares. triage routes comments.
4. **Coordination datastore** — blackboard state, pub/sub broadcast, identity service, vector index.

External to the project: agent clients (IDE/web/terminal), external tools (delivery/docs/design/messaging), humans (browsers, CLIs).

---

## 5. Data model

### 5.1 Entities

```
projects
  id (uuid, pk)
  name
  repo_url
  default_branch
  datastore_url
  deploy_url
  template_version
  created_at

composers
  id (uuid, pk)
  project_id (fk)
  email
  display_name
  default_role (analyst | dev | pm | designer | admin | stakeholder)
  token_hash
  token_issued_at
  token_rotated_at
  status (active | suspended | removed)

sessions
  id (uuid, pk)
  project_id (fk)
  composer_id (fk)
  surface (ide | web | terminal | passive)
  agent_client (free text — e.g., "claude-code", "claude.ai", "cursor")
  status (active | idle | dead)
  heartbeat_at
  created_at

territories
  id (uuid, pk)
  project_id (fk)
  name
  owner_role
  scope_kind (files | doc_region | research_artifact | design_component | slice_config)
  scope_pattern
  created_at

contributions
  id (uuid, pk)
  project_id (fk)
  author_session_id (fk, nullable when open)
  trace_ids (text[])                              -- ADR-021
  territory_id (fk)
  artifact_scope (text[], interpreted per territory.scope_kind)
  state (open | claimed | in_progress | review | merged | rejected | blocked)
  kind (implementation | decision | research | design | proposal)
  content_ref (path or URL)
  transcript_ref (text, nullable)                 -- ADR-024 (sidecar transcript path/URL)
  fencing_token (bigint, nullable)
  blocked_by (fk, nullable)
  created_at
  updated_at

decisions
  id (uuid, pk)
  project_id (fk)
  session_id (fk)
  trace_ids (text[])                              -- ADR-021
  category (architecture | product | design | research | convention)
  summary
  rationale
  reverses (fk, nullable)
  repo_commit_sha
  created_at
  -- append-only: no UPDATE, no DELETE

locks
  id (uuid, pk)
  project_id (fk)
  session_id (fk)
  artifact_scope (text[])
  fencing_token (bigint, monotonic per project)
  lock_type (exclusive | shared)
  acquired_at
  expires_at

contracts
  id (uuid, pk)
  project_id (fk)
  territory_id (fk)
  name
  schema (jsonb)
  version (integer)
  published_at
  breaking_change (bool)

telemetry
  id (uuid, pk)
  project_id (fk)
  session_id (fk, nullable)
  action
  outcome
  duration_ms
  metadata (jsonb)
  created_at
```

### 5.2 Key indexes

| Table | Index | Purpose |
|---|---|---|
| contributions | (project_id, state) | Claimable-contribution lookup |
| contributions | (territory_id, state) | Territory-scoped lookup |
| contributions | (author_session_id) WHERE state IN ('claimed', 'in_progress') | Reap owned contributions on session death |
| sessions | (project_id, status) | Active-participant list |
| sessions | (heartbeat_at) WHERE status='active' | Stale-session detection |
| locks | (project_id, artifact_scope[]) | Conflict check before acquire (GIN index on array) |
| decisions | (project_id, created_at DESC) | Recent-decisions feed |
| decisions | GIN (trace_ids) | Trace-scoped decision lookup (ADR-021) |
| contributions | GIN (trace_ids) | Trace-scoped contribution lookup (ADR-021) |
| telemetry | (project_id, action, created_at DESC) | Observability queries |

### 5.3 Authorization (row-level)

- All tables scoped to `project_id`; composer must belong to project.
- `sessions`: composer can only write their own session row.
- `contributions`: writes to `author_session_id` must match current session; reads are project-scoped.
- `decisions`: append-only (policy rejects UPDATE and DELETE).
- `locks`: writes restricted to holding session; reads are project-scoped.
- `contracts`: writes restricted to territory-owner role; reads are project-scoped.

### 5.4 Vector index

Logical store for semantic-search embeddings. Per-row shape:

- `id` (uuid)
- `project_id` (fk, RLS-scoped per section 5.3)
- `source_kind` (decision | contribution | brd_section | prd_section | research_artifact)
- `source_ref` (text -- repo path, or table+id reference)
- `trace_ids` (text[] -- denormalized from source for query-time filtering)
- `embedding` (vector)
- `embedding_model_version` (text -- enables model swappability per section 6.4.2)
- `created_at`, `updated_at`

Operational concerns -- what gets embedded when, removal semantics, model swappability mechanics, rebuild triggers -- are specified in section 6.4.2. Query semantics (thresholds, bands, scoping) are in section 6.4 + 6.4.1 + 6.4.3.

---

## 6. Key flows

### 6.1 Session lifecycle

```
Composer → Agent client → register(project_id, surface, composer_token)
   → Endpoint validates token, inserts session row, returns session_token + context
Composer → heartbeat(session_token) every 30s
   → Endpoint updates heartbeat_at
[time passes]
   Reaper cron: scans sessions with heartbeat_at < now() - 90s
      → marks status=dead
      → releases all locks held by dead sessions
      → releases (sets state=open) all contributions claimed by dead sessions
Composer → deregister(session_token)
   → Endpoint releases resources, deletes session row
```

### 6.2 Contribution lifecycle

```
Create paths (per ADR-022):
  (a) Pre-existing open row (e.g., from BRD ingestion):
      Agent → claim(contribution_id) → state=claimed, author_session_id set
  (b) Atomic create-and-claim (ad-hoc work, esp. analyst):
      Agent → claim(null, kind, trace_ids, territory_id, optional content_stub)
        Endpoint inserts (state=open) and transitions to claimed in one transaction
   In both paths the endpoint runs find_similar on the new claim → warns if match
Acquire lock: Agent → acquire_lock(artifact_scope) → returns fencing_token
Write: Agent writes to artifact (file, doc region, etc.) passing fencing_token
   For remote-surface composers, the endpoint commits on their behalf — see §7.8 (ADR-023)
   Endpoint validates token on every write-through
Update state: Agent → update(contribution_id, new_state)
   in_progress → review (when agent pushes branch / artifact is ready)
Release lock: Agent → release_lock(lock_id)
Review: routed by territory.review_role (ADR-025). Approver merges PR or accepts research artifact
   Triggers state=merged, contribution archived
```

#### 6.2.1 Atomic create-and-claim semantics

Per ADR-022, `claim(contribution_id=null, ...)` is the create-and-claim path. The high-level shape lives in the lifecycle above; this subsection specifies the operational details that ADR-022 deferred.

**Signature.**

```
claim(
  contribution_id:   uuid | null,
  kind:              "implementation" | "decision" | "research" | "design" | "proposal",   // required when contribution_id=null
  trace_ids:         string[],                   // required when contribution_id=null; non-empty
  territory_id:      uuid,                       // required when contribution_id=null
  content_stub:      string | null,              // optional
  idempotency_key:   string | null               // optional but strongly recommended for remote-surface composers
) -> ClaimResponse
```

**Response shape.**

```
{
  contribution_id: uuid,                         // the row's id (newly created or pre-existing)
  state: "claimed",                              // always claimed on success
  author_session_id: uuid,                       // the calling session
  created: boolean,                              // true if this call inserted; false if it claimed a pre-existing row
  similar_warnings: [                            // matches surfaced by the implicit find_similar gate (see below)
    { source_kind, source_ref, score, summary }, ...
  ],
  fencing_token_hint: null                       // claim does not return a fencing token; acquire_lock does (per section 7.4)
}
```

**Validation order on atomic-create.** Each check returns `BAD_REQUEST` with the specific failure on first match:

1. `kind` is in the enum.
2. `trace_ids` is non-empty and every entry matches the project's `trace_id_pattern` from `.atelier/config.yaml`. Trace IDs need not yet exist in `traceability.json` (the registry catches up via the M1 traceability sync); the pattern check prevents typos.
3. `territory_id` references a row in `territories` for this project.
4. The calling session's composer holds a role that may author into this territory. By default, only `territories.owner_role` may author; `.atelier/config.yaml: territories.allow_cross_role_authoring` can opt-in to broader authoring.
5. `content_stub`, if provided, fits within a configurable size cap (default 8 KiB).

**Implicit find_similar gate.** On atomic-create, the endpoint synchronously runs `find_similar(description=<derived>, trace_id=<first trace_id>)` where `<derived>` is `content_stub` if provided, otherwise a synthesized string from `kind + trace_ids + territory.name`. Results are returned in `similar_warnings` (primary band only; weak suggestions excluded to keep the response compact). The gate never blocks claim -- it warns. Composers can choose to release the new contribution immediately if a strong match exists.

**Race handling.** Two atomic-create calls for the same `kind + trace_ids + territory_id` succeed independently and produce two contribution rows. There is no implicit dedup -- duplicate work is a coordination concern, surfaced by the find_similar warning, not a uniqueness constraint. The two composers see each other's claim via `/atelier` presence (post-M4) and via the warning.

**`content_stub` semantics.** When provided, `content_stub` is written as the initial body of the contribution's `content_ref` artifact:

- For IDE-surface composers: the stub is returned in the response; the local agent writes it to disk under the appropriate path (`research/<trace>-<slug>.md`, `prototype/...`, etc.) using the territory's `scope_kind` to decide convention.
- For remote-surface composers: the per-project endpoint committer (per ADR-023, ARCH section 7.8) commits the stub to the repo as part of the create transaction. The commit author follows the section 7.8 attribution rules. Synchronous: claim does not return until the commit succeeds. On commit failure, the entire create-and-claim transaction rolls back.

If `content_stub` is null, no artifact is created; the contribution row carries `content_ref=null` until the first `update` call sets it.

**Idempotency.** Atomic-create accepts an optional `idempotency_key` (any unique string, typically a UUID generated by the agent client). The endpoint records `(session_id, idempotency_key)` in a per-session dedup table. A retry with the same key returns the original `ClaimResponse` rather than creating a duplicate. Keys are valid for 1 hour, then expire. Remote-surface composers should always send a key because their network path is longer.

**Lock acquisition is separate.** Claim does not acquire any lock. The agent must follow up with `acquire_lock(contribution_id, artifact_scope)` per the lifecycle above. If `acquire_lock` fails (e.g., the scope is already locked by another contribution), the contribution remains claimed but cannot be authored against. The agent's choices: wait, narrow the scope, or `release(contribution_id)` to give it back to `state=open`. There is no auto-release on lock failure -- an analyst may legitimately hold a contribution while waiting for a busy artifact.

#### 6.2.2 Update operation semantics

`update` is the tool that advances a contribution from `claimed` through `in_progress` to `review`, and is the write-path for artifact content. Latent details from ARCH 6.2's high-level lifecycle:

**Signature.**

```
update(
  contribution_id:   uuid,                                   // required
  state:             "claimed" | "in_progress" | "review" | "blocked" | null,   // optional; null means no state change
  content_ref:       string | null,                          // optional; sets the artifact path on first call
  payload:           string | null,                          // optional; the artifact body
  payload_format:    "full" | "patch",                       // optional; defaults to "full"
  fencing_token:     bigint,                                 // required when payload is provided
  blocked_by:        uuid | null,                            // optional; required when state="blocked"
  commit_message:    string | null                           // optional; remote-surface only; defaults to convention below
) -> UpdateResponse
```

**Payload semantics.**

- `payload_format="full"` (default): `payload` is the complete new body of the artifact. The endpoint replaces the file contents wholesale. Simple to reason about; preferred for research artifacts and short documents.
- `payload_format="patch"`: `payload` is a unified diff against the current artifact body. The endpoint applies the patch atomically. Preferred for incremental code edits where preserving line-precise context matters.

`payload` may be null when only `state` is changing (e.g., `claimed` to `in_progress` to signal start without content yet).

**Fencing token requirement.** Any call providing `payload` must include a valid `fencing_token` from a prior `acquire_lock` against the artifact's scope. The endpoint validates the token server-side per ARCH section 7.4. State-only updates (no `payload`) do not require a fencing token.

**Branch strategy for remote-surface composers.** The per-project endpoint committer (per ADR-023, ARCH section 7.8) commits each `update` call as a discrete commit on a per-contribution branch:

- Branch name: `<contribution_kind>/<first-trace-id>-<contribution_id_short>` (e.g., `research/US-1.3-a3f2e1b9`).
- Branch is created on the first `update` that produces a commit.
- The branch is merged to `main` when the contribution transitions to `merged` (via the review path; see section 6.2.3).
- IDE-surface composers commit to whatever branch their local git is on; the endpoint observes the branch via the contribution row's `repo_branch` field (added at M2 with the contributions table).

**Commit message convention.** When `commit_message` is null, the endpoint synthesizes:

```
<contribution_kind>: <first 60 chars of payload first line>

Trace IDs: <comma-separated>
Contribution: <contribution_id>
```

Example: `research: Competitive landscape for prototype deployment\n\nTrace IDs: US-1.3\nContribution: a3f2e1b9-...`

When `commit_message` is provided, the endpoint uses it verbatim (still appending the trace-IDs and contribution-id lines for searchability).

**Multi-update behavior.** Each `update` call that includes a `payload` produces one commit. Multi-call iteration produces a natural git history on the contribution branch. On merge to `main`, the merging admin chooses squash vs. merge-commit per repo convention (no enforcement at the protocol layer). State-only updates do not commit.

**Concurrency.** Only the contribution's `author_session_id` may call `update`. If the session is reaped and the contribution returns to `state=open`, a new session may claim and gain authority. The fencing token from the prior session is invalidated by the lock release on session death (per ARCH section 7.4) -- new payload writes must follow new acquire_lock.

#### 6.2.3 Review and merge transition

When `update(state="review")` succeeds, the contribution is routed to a reviewer per `territories.review_role` (ADR-025). What happens after review depends on the contribution's nature:

- **For repo-resident artifacts (most contributions):** the contribution branch carries an open PR (created by the endpoint committer at the moment of the `state=review` transition). The reviewer approves and merges the PR via the versioned-file-store UI or CLI. The merge webhook fires; the endpoint observes the merge via commit on `main` and transitions the contribution to `state=merged`.
- **For research artifacts (no PR pattern):** the reviewer calls `update(contribution_id, state="merged")` directly via the endpoint; no PR is involved because the artifact already lives on the branch and no code review applies.
- **For decisions:** decisions log via `log_decision` (see section 6.3), not via update. They have no `review` state.

**Authoritative merge confirmation.** A contribution is `state=merged` if and only if either (a) the corresponding PR is merged on `main`, observed via webhook, or (b) for non-PR artifacts, an authorized reviewer called `update(state="merged")`. The datastore state alone does not constitute merge -- the repo is canonical per ADR-005.

**Reviewer not available.** If `territories.review_role` for the contribution's territory has no active composer, the contribution stays in `state=review` indefinitely. The `/atelier` admin lens surfaces "review-stuck" contributions via section 8.2 observability. There is no auto-promotion of stuck reviews; coordination is the team's responsibility.

**Cross-territory contributions.** Per ADR-021, contributions may carry multiple `trace_ids`. If those trace IDs span multiple territories, the contribution's primary territory (the one passed to `claim`) drives review routing. Cross-territory consumers may comment but only the primary territory's `review_role` may merge.

### 6.3 Decision log write (the four-step atomic operation)

```
Agent → log_decision(category, summary, rationale, trace_id)
  Endpoint:
    1. Creates new file at decisions/ADR-NNN-<slug>.md in repo (commit) per ADR-030
    2. Inserts row in decisions table with repo_commit_sha
    3. Generates embedding + upserts into vector index
    4. Broadcasts via pub/sub
  If step 2 fails: repo write is authoritative; next call retries mirror
  If step 3 fails: keyword-fallback for find_similar; banner in UI
  If step 4 fails: sessions receive next update on reconnect
  Step 1 succeeding is the single success criterion for log_decision
```

### 6.4 Find_similar execution

```
Agent → find_similar(description, optional trace_id)
  Endpoint:
    1. Generate embedding for description
    2. kNN search against vector index
       (scoped to project_id, optionally to a trace_id scope per section 6.4.3)
    3. Partition matches into bands per §6.4.1
    4. Enrich with source metadata (decision/contribution/BRD section/research)
    5. Return top-k of each band with scores
  If vector index unavailable:
    Fall back to keyword search; response carries degraded=true
    UI renders explicit banner
```

#### 6.4.1 Threshold semantics and two-band response

Thresholds are read from `.atelier/config.yaml` at query time; both are per-project configurable:

- `default_threshold` (default `0.80`) — matches at or above this score are **primary matches**, surfaced prominently in the agent response and in any UI.
- `weak_suggestion_threshold` (default `0.65`) — matches in the half-open interval `[weak_suggestion_threshold, default_threshold)` are **weak suggestions**, returned alongside primary matches but flagged so callers can render them collapsed/secondary. Matches below `weak_suggestion_threshold` are dropped.

**Response shape:**

```
{
  primary_matches: [ { source, score, content_ref, ... }, ... ],     // score ≥ default_threshold
  weak_suggestions: [ { source, score, content_ref, ... }, ... ],    // weak ≤ score < default
  degraded: false,                                                   // true if vector index unavailable
  thresholds_used: { default: 0.80, weak: 0.65 }                     // echoed for caller awareness
}
```

**top-k.** Each band returns up to `find_similar.top_k_per_band` matches (default `5`, configurable). A query that produces 50 matches above default is returned as the top 5 primary; the remaining 45 are not surfaced (callers wanting more issue a follow-up call with a tighter `trace_id` scope or descriptive query).

**Default-threshold tuning.** The chosen default value (`0.80` at present) is a starting point. The actually-correct value is data-dependent and is tuned against the labeled seed eval set when M5 ships, against the precision/recall gates in `ADR-006`. See `BRD-OPEN-QUESTIONS §12`.

**UI rule.** Prototype web app and any client UI render `primary_matches` prominently and `weak_suggestions` in a collapsible "weak matches (N)" section by default. Agents may render both inline; the band assignment is the contract, the visual treatment is the consumer's choice.

#### 6.4.2 Corpus composition and embedding lifecycle

**Description input format.** The `description` parameter is free-form text. Markdown is allowed but not interpreted -- it is passed to the embedding model as plain text. Hard cap: 8000 characters (provides headroom under typical embedding model token limits). Empty or whitespace-only input returns `BAD_REQUEST`; there is no implicit "match everything" mode.

**What gets embedded, at what granularity.**

| source_kind | Granularity | One row represents |
|---|---|---|
| `decision` | One row per ADR file under `docs/architecture/decisions/` | The full ADR body + frontmatter |
| `contribution` | One row per contribution that reaches `state=merged` | The contribution's resolved content (content_ref body) |
| `brd_section` | One row per BRD story (US-X.Y block) | The story heading + acceptance + NFR |
| `prd_section` | One row per top-level PRD section | The full section text |
| `research_artifact` | One row per file under `research/` | The full artifact body |

**Embed cadence.**

- **Decisions.** A versioned-file-store webhook fires on commits to `main` touching `docs/architecture/decisions/ADR-NNN-*.md`. The endpoint enqueues an embed job; the job runs asynchronously and populates the vector index row within seconds. New ADRs always insert; existing ADRs are append-only and never re-embedded.
- **Contributions.** When a contribution transitions to `state=merged`, the endpoint embeds inline (synchronous with the merge transaction). Failure to embed degrades to keyword search for that row but does not roll back the merge.
- **BRD/PRD sections.** Same webhook trigger as decisions, scoped to `docs/functional/BRD.md` and `docs/functional/PRD.md`. Section parser splits on heading boundaries; sections that changed are re-embedded; unchanged sections are skipped via content hash.
- **Research artifacts.** Webhook fires on commits touching `research/**`. New files insert; modified files re-embed; deleted files (git rm) trigger removal from the index.

**Removal semantics.**

| Event | Index action |
|---|---|
| ADR reversed by a new ADR | Both rows remain. The reversal ADR carries `reverses` frontmatter; query results surface both with the reversal flagged in result metadata so callers can weigh accordingly. Reversed ADRs are not silently dropped -- the historical decision matters. |
| Contribution rejected (state transitions to rejected) | Row removed |
| Research artifact deleted | Row removed |
| BRD/PRD section deleted | Row removed |
| Project archived | All project_id rows soft-deleted (retained for audit) |

**Embedding model swappability.** The `embedding_model_version` column on each row records which model produced the embedding. Switching models follows a documented procedure:

1. Update `find_similar.embedding_model` in `.atelier/config.yaml`.
2. Run `atelier eval find_similar --rebuild-index`. The CLI re-embeds the entire corpus into new rows tagged with the new `embedding_model_version`.
3. During the rebuild, queries continue against the old version. On rebuild completion, the default-model pointer flips atomically to the new version.
4. Old-version rows are retained for one config-defined grace period (default: 30 days) to enable rollback. After the grace window, a cleanup job removes them.

Concurrent model versions are queryable but only the default version answers `find_similar` calls. There is no per-query model selection at v1.

**Index rebuild.** `atelier eval find_similar --rebuild-index` is the one administrative operation that rebuilds. Triggers:

- Embedding model change (per above procedure).
- Suspected corpus drift after a bulk operation (e.g., a template upgrade that renamed many files).
- Eval-set evolution that requires re-scoring.

The index is otherwise incrementally maintained via the embed pipeline above. There is no scheduled rebuild -- if the incremental pipeline is healthy, rebuilds are administrative not operational.

#### 6.4.3 Trace scoping and cross-project isolation

**Trace scoping.** The optional `trace_id` parameter on `find_similar` (and the related `trace_ids` filter on the underlying index) defines a `trace_id scope`. The scope contains:

1. The trace_id itself (e.g., `US-1.3`).
2. Its epic siblings -- other stories sharing the same epic prefix (e.g., `US-1.3` and `US-1.5` both belong to `BRD:Epic-1`). Epic prefix is parsed from the `US-<epic>.<story>` format.
3. Trace IDs of contributions whose `trace_ids` array intersects the scope.

This matches the adjacency definition in section 6.7.1 for `get_context.recent_decisions`. Earlier prose in section 6.4 used the term "trace_id subtree", which implied a hierarchy that does not exist in the flat US-X.Y format. "Trace scope" replaces it with the explicit definition above.

When `trace_id` is omitted, the query runs against the full project corpus (subject to project_id RLS).

**Cross-project isolation.** Every `find_similar` query is project-scoped via the session token's `project_id`. The vector index is partitioned by `project_id` (via RLS on the `embedding` table per section 5.3). A composer who holds active sessions in multiple projects (per ADR-015) sees only the queried session's project results.

**Intentional non-feature at v1:** there is no cross-project or guild-wide search. A composer who wants to compare prior work across projects must query each project's session independently and aggregate client-side. Cross-project search is a v1.x scope item (see `BRD-OPEN-QUESTIONS section 9` for cross-repo project handling, which is the related v1.x concern).

### 6.5 Sync substrate flows

**publish-docs** (repo → published-doc):
```
Trigger: commit touching BRD.md, PRD.md, or strategy content
  Script:
    1. Extract sections with trace IDs
    2. Render to target format (HTML/Confluence/Notion API format)
    3. Prepend "edits here will be overwritten" banner
    4. PUT to external page (full overwrite)
    5. Update registry with external URL
```

**publish-delivery** (repo → delivery tracker):
```
Trigger: contribution transitions to claimed or later
  Script:
    1. Lookup delivery adapter for project's configured tracker
    2. Upsert issue (create if new, update status/assignee/sprint if existing)
    3. Update registry with external issue URL + last_synced_at
```

**mirror-delivery** (delivery tracker → registry):
```
Trigger: nightly cron
  Script:
    1. For each contribution with external issue URL:
       Pull current delivery-authoritative fields (status, sprint, points, assignee)
       Upsert into registry's mirror table
    2. Emit telemetry with sync duration + count
```

**reconcile** (bidirectional drift detector):
```
Trigger: nightly cron (after mirror-delivery)
  Script:
    1. Compare registry fields vs canonical repo fields
    2. Report divergences (repo X, external Y, last-synced-at Z)
    3. Never auto-write
    4. Output to /atelier/observability + optional messaging alert
```

**triage** (external comments → proposal contributions):
```
Trigger: webhook from published-doc or delivery tracker or design tool
  Pipeline:
    1. Classifier: category (scope | typo | question | pushback | off-topic), confidence
    2. If confidence > threshold:
       Drafter: generates proposed change as patch/diff
       Creates contribution with kind=proposal, citing origin
    3. If confidence < threshold:
       Routes to human-only queue for manual classification
    4. Never auto-merges
```

### 6.6 Territory contract flow

```
Territory owner → publish_contract(name, schema)
  Endpoint:
    1. Classify as breaking or additive per §6.6.1
    2. If additive:
       Insert contract version N+1 (minor bump), broadcast to consumers
    3. If breaking:
       Create a proposal contribution requiring cross-territory approval
       After approval window with no objections (or explicit approval):
         Insert contract version N+1 (major bump), broadcast
       Otherwise: proposal expires, contract unchanged
```

#### 6.6.1 Breaking-change classifier

A contract change is **breaking** if any of the following hold (conservative defaults):

| Change | Class | Reason |
|---|---|---|
| Field removed | breaking | Consumers reading the field receive `undefined` |
| Field renamed | breaking | Equivalent to remove + add |
| Field type narrowed (e.g., `string` → `enum`, widened range → narrower range) | breaking | Existing producers may emit values the new type rejects |
| Field type widened (e.g., `enum` → `string`, narrower → broader) | additive | Existing consumers still parse all prior values |
| Required field added | breaking | Existing producers don't emit it |
| Optional field added | additive | Strict-validator consumers may break, but the contract permits omission |
| Default value changed | breaking | Consumers depending on a specific default observe behavior change |
| Field reordered (positional contracts only) | breaking | N/A for JSON-shaped contracts; relevant for tabular or array-positional shapes |

**Publisher override.** A territory owner may classify an otherwise-breaking change as additive by passing `override_classification="additive"` plus a required `override_justification` string. The override is recorded on the `contracts` row and surfaced in `/atelier/observability` for audit. Overrides are reversible by any consumer territory by escalating to a proposal contribution.

**Versioning.** Semver-style. Additive changes bump minor (`1.4 → 1.5`); breaking changes bump major (`1.5 → 2.0`). `contracts.version` is an integer pair stored as `major*1000+minor` to preserve sort order; the human-facing string is rendered on read. Consumers pin to a major version; minor upgrades are automatic.

### 6.7 Get_context execution

`get_context` is the post-M2 replacement for `.atelier/checkpoints/SESSION.md` (per `../methodology/METHODOLOGY.md §6.1`). It answers, in one call: what is the current state, where did the last session leave off, what decisions affect my work, what is open in my territory.

**Project scope.** The session token already carries `project_id`. `get_context` is implicitly project-scoped — there is no `project_id` parameter. A composer in multiple projects (per ADR-015) holds multiple sessions, one per project, and queries each independently.

**Signature.**

```
get_context(
  trace_id?:        string | string[],   // optional; scopes recent_decisions, contributions, traceability
  since_session_id?: string,             // optional; return only what changed since that session
  lens?:            string,              // optional; analyst | dev | pm | designer | stakeholder
  kind_filter?:     string[],            // optional; filter contributions by kind (implementation | research | ...)
  charter_excerpts?: boolean             // optional, default false; include excerpts vs paths only
) → ContextResponse
```

`lens` does not filter access — every project member sees every project-scoped row. It tunes per-section depth defaults. For example, `lens="dev"` weights more contribution detail and fewer charter excerpts; `lens="analyst"` weights more research-kind contributions and recent decisions. Defaults documented in `.atelier/config.yaml: get_context.lens_defaults`.

**Return shape (ContextResponse).**

```
{
  charter: {
    paths: ["CLAUDE.md", "AGENTS.md", "docs/methodology/METHODOLOGY.md", ".atelier/territories.yaml", ".atelier/config.yaml"],
    excerpts: { "<path>": "<first N lines>" } | null   // populated only if charter_excerpts=true
  },
  recent_decisions: {
    direct: [ { id, summary, trace_ids, timestamp, repo_path }, ... ],         // trace_id matches exactly
    epic_siblings: [ ... ],                                                     // shares an epic prefix with the queried trace
    contribution_linked: [ ... ],                                               // touches a contribution that carries the trace
    truncated: { direct: false, epic_siblings: false, contribution_linked: false }
  },
  territories: {
    owned: [ { name, scope_kind, scope_pattern, contracts_published }, ... ],   // composer's role owns
    consumed: [ { name, contracts_consumed }, ... ]                              // composer's role reads contracts from
  },
  contributions_summary: {
    by_state: { open: N, claimed: N, in_progress: N, review: N, blocked: N },
    active: [ { id, kind, state, trace_ids, territory, content_ref }, ... ],   // top contributions weighted per lens
    truncated: false
  },
  traceability_slice: {
    entries: [ { trace_id, label, kind, doc_path, doc_url, prototype_pages }, ... ],   // entries touched by trace_id + epic siblings
    counts: { brd_epics, brd_stories, decisions, adrs }                                  // project-wide counts for orientation
  },
  stale_as_of: "2026-04-27T18:32:00Z",
  cache_validity_ms: { charter: 3600000, recent_decisions: 60000, contributions_summary: 5000 }
}
```

#### 6.7.1 Adjacency definition for `recent_decisions`

A decision is **adjacent** to a queried `trace_id` if any of the following hold (returned in three ranked bands):

1. **Direct.** The decision's `decisions.trace_ids` array contains the queried trace_id.
2. **Epic-sibling.** The decision's `trace_ids` contain a story from the same epic (e.g., querying `US-1.3` matches a decision tagged `US-1.5` because both belong to `BRD:Epic-1`). Epic prefix is parsed from the `US-<epic>.<story>` format.
3. **Contribution-linked.** The decision touches a contribution (via `contribution_id` linkage on the decision row, or shared `trace_ids`) that itself carries the queried trace_id.

Each band returns up to `get_context.recent_decisions.per_band_limit` matches (default `10`), ordered by `created_at DESC`. Truncation is reported per-band so callers know to issue a follow-up with a tighter scope if they need more.

If no `trace_id` is provided, `recent_decisions` returns the project-wide last `per_band_limit` decisions in the `direct` band; `epic_siblings` and `contribution_linked` are empty.

#### 6.7.2 Token-budget strategy

A complete context for a mid-sized project (a hundred stories, dozens of ADRs, hundreds of contributions) blows past any LLM context window. Strategy:

- **Default to summaries, not bodies.** Charter returns paths only unless `charter_excerpts=true`; decisions return `summary` not full body; contributions return `content_ref` not content.
- **Per-section caps from `.atelier/config.yaml: get_context.section_limits`.** Defaults: `recent_decisions.per_band_limit: 10`, `contributions_summary.active_limit: 20`, `traceability_slice.entries_limit: 50`. All overridable per-project.
- **Truncation flagged in response.** Each section that hit its cap emits `truncated: true` (or per-band truncation flags) so the caller knows there's more.
- **Caller pattern for more depth.** Issue a second call with a tighter `trace_id` or `kind_filter`, or use the appropriate dedicated tool — `find_similar` for semantic match, direct `claim`/`update` for contribution detail.

The contract: `get_context` should fit comfortably within ~8K tokens for the default response. Excerpts and full traceability slices may push higher; that's a caller-opt-in cost.

#### 6.7.3 Authorization

`get_context` enforces project membership via the session token. No additional role gating beyond what `ARCH §5.3` defines for the underlying tables — every project member sees every project-scoped row. The `lens` parameter shapes depth, not access.

`territories.owned` and `territories.consumed` are computed from `composers.default_role` joined against `territories.owner_role` / `territories.contracts_consumed`. A composer with secondary roles (per `.atelier/config.yaml`) sees the union.

#### 6.7.4 Freshness and caching

The response carries `stale_as_of` (server timestamp at query time) and `cache_validity_ms` per section so callers can implement client-side caching with appropriate cadence:

- **charter:** `3_600_000` ms (1 hour). Charter files change via PR, infrequently; an hour-stale snapshot is acceptable.
- **recent_decisions:** `60_000` ms (1 minute). Decisions append; new ones matter quickly but the rate is low.
- **territories:** `300_000` ms (5 minutes). Territory changes are PR-merged + datastore-reloaded; minute-scale staleness is fine.
- **contributions_summary:** `5_000` ms (5 seconds). Contributions churn during active work; near-real-time matters.
- **traceability_slice:** `300_000` ms (5 minutes). The registry rebuilds on commits; minute-scale is fine.

Clients that need stricter freshness for `contributions_summary` should subscribe to the broadcast substrate (lit up at M4) instead of polling `get_context`.

#### 6.7.5 `since_session_id` continuity mode

When `since_session_id` is provided, the response is a delta — each section returns only entries created or modified after `sessions.created_at` of the referenced session:

- `recent_decisions.*` — only decisions with `created_at > since_session.created_at`
- `contributions_summary.active` — only contributions with `updated_at > since_session.created_at`
- `charter.excerpts` — empty unless any charter file's `git log` shows a commit after `since_session.created_at`
- `territories` — full (territories change rarely; deltas aren't useful)
- `traceability_slice` — full (registry is small and the diff isn't worth computing)

This is the explicit "what changed since I was last here" mode — the protocol primitive that finally retires `.atelier/checkpoints/SESSION.md`.

---

## 7. Security architecture

### 7.1 Authentication

- **Per-composer signed tokens** issued by the identity service at invite acceptance.
- Tokens carry: composer_id, project_id, role claims, issued_at, expires_at.
- Endpoint validates every call; invalid/expired tokens rejected with 401.
- **Session tokens** are derived at `register` time, scope narrower than composer token.

### 7.2 Authorization

- Row-level policies enforce composer membership in project for all reads.
- Writes constrained to session ownership (contributions, locks).
- Decision writes are append-only (no UPDATE, no DELETE allowed by policy).
- Territory-ownership checks gate `publish_contract`.

### 7.3 Credential isolation

- Datastore admin/service-role credentials live server-side only (serverless runtime environment).
- Clients (agent, prototype, CLI) only ever hold per-composer tokens.
- Secret rotation supported via `atelier invite <email> --role <r> --rotate`.

### 7.4 Fencing & concurrency

- Every lock carries a monotonic fencing_token per project.
- Every write to a locked artifact validates the token server-side.
- Stale tokens (from sessions whose locks have been reaped and reassigned) are rejected unconditionally.

### 7.5 Triage sandboxing

- External comments classified + drafted into proposal contributions.
- Proposal contributions cannot transition to `merged` without explicit human approval recorded in datastore.
- CI check on repo mirrors this constraint (catches attempts to merge proposal PRs without approval record).

### 7.6 Append-only decisions

- Datastore policy: only INSERT on decisions table.
- CI check on repo: changes under `decisions/` must be new files only (no edits to existing ADR files; reversals are new files with `reverses:` frontmatter).
- Reversal is a new decision with `reverses: <prior-id>` in frontmatter.

### 7.7 Rate limiting

- Per-composer rate limits on endpoint (configurable; sensible defaults).
- Per-project global rate limits on expensive operations (find_similar, publish-docs).

### 7.8 Remote-surface write attribution (ADR-023)

For composers whose surface is `web` (or `terminal` without local repo access), agent writes to repo-resident artifacts route through a per-project endpoint git committer:

- **Identity.** The endpoint holds a project-scoped deploy key (rotatable via `atelier rotate-committer-key`). Commits authored as `<composer.display_name> via Atelier <atelier-bot@<project>>` with `Co-Authored-By: <composer email>` so attribution survives in `git log`.
- **Synchronicity.** `update` (and `claim`-with-content_stub) blocks until the commit succeeds. On commit failure, the datastore mirror is **not** written and the tool returns a retry-safe error (`retryable=true`, idempotency key carries forward).
- **Audit.** Every committer write logs `(commit_sha, composer_id, session_id, action, artifact_scope)` to telemetry. Queryable in `/atelier/observability` (§8.2).
- **Rotation.** Deploy-key rotation is a CLI operation; in-flight contributions are unaffected because the rotation only affects subsequent commits. Old key is revoked at the git provider on rotation success.
- **Failure boundaries.** Loss of the deploy-key credential blocks remote-surface writes with a clear error; IDE-surface composers are unaffected. Rotation runbook in `../methodology/METHODOLOGY.md`.

This satisfies ADR-005 (repo-first) for remote-surface composers — the commit is the success criterion, not the datastore write.

#### 7.8.1 Transcript capture details

ADR-024 establishes that agent-session transcripts are repo-sidecar files, opt-in via `.atelier/config.yaml: transcripts.capture: true`. Operational details:

**When the sidecar is written.** Transcripts accumulate over a session. The endpoint persists the transcript on each of: `update(state="review")` (the natural "I'm done" signal), `release(contribution_id)`, `deregister(session_token)`, and any explicit `flush_transcript` call. Between persistence events the transcript is buffered in datastore-backed session state so a session crash does not lose more than the most recent buffered turns.

**Sidecar path.** `<content_ref>.transcript<sidecar_suffix>` where `<sidecar_suffix>` defaults to `.jsonl`. Example: `research/US-1.3-deploy-research.md.transcript.jsonl`. The endpoint commits the sidecar through the same per-project committer that handles content (per section 7.8) so attribution is consistent.

**Per-line schema (jsonl).**

```
{
  ts: "2026-04-27T18:32:00Z",
  role: "user" | "assistant" | "tool",
  agent_client: "claude.ai",
  content: "<text>",                           // user/assistant turns
  tool_call: { name, args } | null,            // present on tool role lines
  tool_result: { name, outcome, content } | null,
  trace_ids_at_time: ["US-1.3"],               // contribution's trace_ids when this turn occurred
  redacted: false                              // true if a redaction pass touched this line
}
```

**PII review.** When `transcripts.capture: true`, the project must also configure `transcripts.pii_review` in `.atelier/config.yaml`:

- `pii_review: "none"` -- raw transcripts committed; team accepts the risk.
- `pii_review: "auto"` -- a redaction pass runs before commit using a configured pattern set (emails, phone numbers, named-entity heuristics). Lines touched by redaction carry `redacted: true`.
- `pii_review: "manual"` -- the endpoint stages transcripts to a queue; an admin must approve via the `/atelier` PII queue before the sidecar is committed. Until approved, the sidecar lives only in datastore session state.

The default when `transcripts.capture: true` is set without specifying `pii_review` is `manual` (most conservative).

**Size cap and overflow.** A configurable per-session cap (`transcripts.max_session_bytes`, default 5 MiB) bounds sidecar size. On overflow, the endpoint rotates: the existing sidecar is renamed `<base>.transcript.<n>.jsonl` and a fresh sidecar is started. Multi-file transcripts are walked in numeric order.

**Reading transcripts.** Transcripts are not exposed via the 12-tool surface. Reading them is a repo operation -- composers (or auditors) read the sidecar files directly via git. The prototype `/atelier/observability` route surfaces transcript existence and metadata but not content (to avoid duplicating PII exposure in the UI).

### 7.9 Web-surface auth flow

The agent endpoint is an MCP server speaking Streamable HTTP (per ADR-013 + `.atelier/config.yaml: agent_protocol`). It is OAuth-2.1-protected per the MCP authorization specification. The authorization server is the configured identity provider — Supabase Auth by default per ADR-028, BYO OIDC otherwise.

**Discovery.** The endpoint exposes `/.well-known/oauth-authorization-server` (RFC 8414) pointing at the configured identity provider's issuer. MCP clients that support OAuth-protected servers discover the AS automatically and initiate the flow.

**Token presentation.** Every MCP HTTP request carries `Authorization: Bearer <jwt>`. The endpoint validates signature and standard claims (`iss`, `aud`, `exp`) against the identity provider's JWKS. The JWT `sub` claim resolves to `composers.id` via a join on `composers.identity_subject` (added at M2 with the `composers` table).

**Two paths, one scheme.** Atelier accepts bearer tokens regardless of how the client obtained them:
- **Dynamic OAuth.** Clients that support OAuth-protected MCP servers (e.g., claude.ai Connectors, ChatGPT Connectors) complete the auth-code flow; refresh handled by the client.
- **Static API token.** Clients without OAuth support paste a long-lived bearer token issued by the identity provider as a personal API token. Same JWT validation path; only the issuance and rotation cadence differ.

The choice is a client capability, not an Atelier-side branch. No client allow-list — any MCP-over-HTTP client that can present a valid bearer token works.

**Token issuance.** `atelier invite <email> --role <r>` triggers an identity-provider invitation. The invite response surfaces both a clickable OAuth setup link (for dynamic-OAuth clients) and a paste-able static API token (for fallback clients). Rotation: dynamic via OAuth refresh; static via `atelier invite ... --rotate`.

**Failure boundaries.** Invalid or expired tokens are rejected with 401 and a `WWW-Authenticate: Bearer` header signalling the AS for reauth. Misconfigured AS metadata blocks all web-surface access with a clear error in `/atelier/observability`; IDE-surface composers using locally-configured tokens are unaffected if their tokens are still valid.

This subsection operationalizes ADR-009's "browser-safe token delivery" against the MCP spec; no separate ADR is warranted because the choice is fully determined by ADR-013 (MCP) + ADR-028 (Supabase Auth) + the MCP authorization spec.

---

## 8. Observability architecture

### 8.1 Telemetry events

Every endpoint call, every state transition, every sync run emits a telemetry event:
- `action` — e.g., "contribution.claim", "lock.acquire", "decision.log", "sync.publish-delivery"
- `outcome` — "success", "failure", "degraded"
- `duration_ms`
- `metadata` — action-specific payload (e.g., for find_similar: query, match_count, top_similarity)

### 8.2 Admin observability route

`/atelier/observability` (admin-gated):
- **Sessions** — heartbeat health timeline, reaper activity, surface breakdown
- **Contributions** — state-transition audit log, throughput per territory
- **Locks** — acquisition/release ledger with fencing tokens, conflict rate
- **Decisions** — find_similar match-rate trend, precision/recall history
- **Triage** — classifier confidence distribution, human accept/reject rate
- **Sync** — per-script lag p95, error rate, last successful run
- **Vector index** — row count, index health, query p95

### 8.3 Alerting

Messaging adapter publishes alerts for:
- Sync lag > NFR thresholds
- Find_similar precision regression > 5%
- Reaper rate spike (possible platform issue)
- Authentication failure spike (possible attack)

---

## 9. Deployment model

### 9.1 Self-hosted default

Atelier ships as a template. Teams run `atelier init`, then:
- Commit to their own git provider
- Provision their own coordination datastore (`atelier datastore init`)
- Deploy their own serverless runtime + static hosting (`atelier deploy`)

No Atelier service, no tenant database, no central auth.

### 9.2 One guild, many projects

A "guild" is a team and the shared Atelier instance they coordinate through (one datastore + one endpoint, plus deployed prototype(s) — see §9.3 for prototype topology). A guild hosts multiple projects, each with its own `project_id`, repo, and configuration.

Schema supports plural projects from v1 (see §5.1). No retrofit later.

### 9.3 Infrastructure requirements

Per guild:
- 1 coordination datastore (relational + pub/sub + identity + vector index)
- 1 serverless runtime deployment (agent endpoint)
- 1 static/edge hosting deployment per project (prototype web app)
- 1 scheduler instance for cron-based sync + reaper

### 9.4 Local development

`atelier init --local-only` scaffolds a project with:
- File-based datastore (SQLite + in-process pub/sub + local file vector store)
- Local agent endpoint on localhost
- Local prototype dev server

Upgrade path: `atelier datastore init` promotes local to production datastore with migration (see §9.5).

### 9.5 Local → guild promotion

A solo composer who started with `atelier init --local-only` can promote to a guild-shared deployment without losing history. Design intent (the runbook lands at M7 alongside `atelier upgrade`):

- **Migration is additive-preferred.** No destructive schema changes during promotion. Conflicts between local state and new guild defaults are reported, never auto-resolved.
- **Decision-log transfer is full.** Every per-ADR file under `docs/architecture/decisions/` is preserved verbatim with its original commit history. `decisions.repo_commit_sha` rewrites to the new repo's SHAs only if the repo itself is being moved; otherwise unchanged.
- **Fencing counter resets.** The new guild datastore starts a fresh per-project monotonic counter at 1. The transition itself is recorded as a new ADR (`ADR-NNN-promote-<project>-to-guild.md`) with `promoted_from_local: true` in frontmatter so future audits can correlate pre/post fencing tokens.
- **In-flight contributions migrate as-is.** State, trace_ids, content_ref preserved. Locks are dropped (no in-flight locks during the promotion window); composers re-acquire after promotion completes.
- **Transcripts (per ADR-024) migrate only if `transcripts.capture: true` was set locally.** Otherwise the local-only sessions had no transcript sidecar to transfer.

Projects within a guild upgrade independently — no lockstep requirement (see also `BRD-OPEN-QUESTIONS §6` for upgrade path semantics generally).

### 9.6 Offline / disconnected behavior

A composer's connection to the coordination datastore can drop (network partition, datastore outage, intentional offline work). The capability matrix:

| Capability | Offline | Online-required |
|---|---|---|
| Read canonical state (charter files, BRD/PRD, ADRs, traceability registry) | yes — files are on disk for IDE-surface composers | n/a |
| Edit files in the repo | yes | n/a |
| Commit + push to versioned file store | yes (commit); push deferred until reconnect | n/a |
| `claim` / `update` / `release` contributions | no — requires datastore | yes |
| `acquire_lock` / `release_lock` | no — fencing tokens require server-side allocation | yes |
| `log_decision` (full four-step) | partial — repo write succeeds offline (per ADR-005); datastore mirror, embedding, broadcast deferred until reconnect | yes for full path |
| `find_similar` | no — vector index is server-side; falls back to keyword search if degraded online, but no offline fallback | yes |
| `get_context` | partial — IDE-surface composers can read charter + decisions from disk; recent-contribution snapshot requires datastore | yes for full snapshot |

**Web-surface composers are offline-incapable** by definition: they have no local repo and no client-side datastore. Loss of connectivity blocks all operations until the connection returns.

**On reconnect.** The session re-registers (fresh `session_token`); held locks were already released by the reaper after `session_ttl_seconds`; any contributions claimed by the dead session were released to `state=open`. Conflicts between offline-edited files and the current canonical state surface as merge conflicts at push time, not as silent overwrites. Decisions logged to repo while offline are mirrored to the datastore on the next `log_decision` call (idempotent on `repo_commit_sha`).

### 9.7 Template version upgrades

A team running Atelier template `vN.M` can adopt `vN.(M+1)` (or `v(N+1).0`) via `atelier upgrade` without re-scaffolding. Design intent (operational runbook lands at M7 alongside the polished `atelier upgrade` CLI):

- **Additive-preferred migrations.** Schema changes prefer additive shapes (new columns nullable, new tables, new indexes). Destructive changes (column drops, type narrowings, table removals) require a major version bump and a co-shipped reversal ADR explaining the alternatives weighed.
- **Idempotent.** Re-running `atelier upgrade` after a successful upgrade is a no-op. Each migration carries a unique ID and is recorded in a `schema_migrations` table on apply.
- **Not auto-reversible.** No automatic rollback script is generated. Reverting a migration is an explicit destructive operation gated behind `atelier upgrade --revert <migration-id>` plus an ADR in the consuming project documenting the revert decision.
- **Conflicts reported, not auto-resolved.** When `atelier upgrade` finds authored content that contradicts new defaults (e.g., a territory using a renamed `scope_kind` value, a config key that moved), the upgrade halts with a report listing each conflict and the recommended manual resolution. The team resolves and re-runs.
- **Schema N / N−1 co-existence.** During an upgrade window, the agent endpoint accepts requests valid against either schema version. The grace-window length is data-dependent and tuned post-M7 (see `BRD-OPEN-QUESTIONS §6`). The default starting point is "until all projects in the guild have upgraded, capped at one minor-version cycle."
- **Independent per-project upgrades within a guild.** Projects do not have to upgrade in lockstep. Each project's `template_version` in `.atelier/config.yaml` is independent. A guild may legitimately host projects on `v1.0` and `v1.1` simultaneously during the grace window.
- **Decision-log preservation.** No ADR file is rewritten by an upgrade. New canonical conventions introduced by the new template version are documented as fresh ADRs (committed by the upgrade tool with the team's review) rather than retroactive edits.

---

## 10. Open architectural decisions

See `../functional/PRD-COMPANION.md` for decisions already made. Open items:

| ID | Decision | Impact | Notes |
|---|---|---|---|
| ARCH-01 | Vector index backend default (pgvector vs. external service) | Medium — affects self-host complexity | pgvector likely default; external-service fallback for scale |
| ARCH-02 | Identity service default (self-hosted OIDC, external provider, BYO) | Medium — affects team adoption friction | Lean toward BYO with a sensible default |
| ARCH-03 | Embedding model default + swappability | Medium — find_similar performance hinges on choice | Config-driven; benchmark at least 3 options |
| ARCH-04 | Lock fencing token storage (in locks table vs. separate counter table) | Low — implementation detail | Monotonic counter in a dedicated table; isolation via advisory locks |
| ARCH-05 | Transcript storage for web-composer sessions (inline vs. external blob) | Medium — impacts repo size | Sidecar files in `research/` with size cap; overflow to external blob |
| ARCH-06 | Triage classifier implementation (rules vs. small LLM vs. embedding-based) | Medium — affects accuracy and cost | Embedding-based similarity to prior proposals likely cheapest + adequate |
| ARCH-07 | Breaking-change heuristics for contracts | Low — encoded in library code | Removed fields, narrowed types, renamed fields = breaking; conservative defaults |
| ARCH-08 | Switchman as dependency for file-level locks vs. own-implementation | RESOLVED (2026-04-25) | Own-implementation. Switchman lacks fencing-token API. See ADR-026. |
