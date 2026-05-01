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
  template_version (text)                                              -- semver-shaped string (e.g., "1.0", "1.0.2") per audit G7; validated by `atelier upgrade` against compatibility rules in ARCH 9.7 (additive-preferred + N/N-1 co-existence)
  created_at

composers
  id (uuid, pk)
  project_id (fk)
  email                                                                -- UNIQUE(project_id, email) per audit G3
  display_name
  discipline (analyst | dev | pm | designer | architect | null)        -- ADR-038: work-discipline axis; null when composer is access-level-only (e.g., platform admin without a work role)
  access_level (member | admin | stakeholder)                          -- ADR-038: participation/permission axis; default member
  token_hash
  token_issued_at
  token_rotated_at                                                     -- single timestamp; granular rotation log deferred to v1.x per audit G6 (replay-detection is via the identity service's event log)
  status (active | suspended | removed)
  UNIQUE (project_id, email)                                           -- audit G3
  CHECK (discipline IS NOT NULL OR access_level IN ('admin', 'stakeholder'))   -- ADR-038: a composer must have either a discipline or an access-level-only role; never both null

sessions
  id (uuid, pk)
  project_id (fk)
  composer_id (fk)
  surface (ide | web | terminal | passive)
  agent_client (text)                                                  -- opaque-by-design free text per audit G5; e.g., "claude-code/0.4.2", "claude.ai", "cursor". The endpoint records but does not validate; agents may use any identifier they choose.
  status (active | idle | dead)                                        -- transitions per audit G4: active when heartbeat_at within policy.session_active_window_seconds (default 60s); idle when within policy.session_ttl_seconds (default 90s) but past active window; dead when past ttl (reaper transitions). Idle is observable but does not affect lock/contribution validity -- the session retains its claims until reaped.
  heartbeat_at
  created_at

territories
  id (uuid, pk)
  project_id (fk)
  name
  owner_role                                                           -- ADR-038 (typed against composer_discipline: analyst | dev | pm | designer | architect)
  review_role                                                          -- ADR-025 (review-routing key); nullable when same as owner_role
  scope_kind (files | doc_region | research_artifact | design_component | slice_config)
  scope_pattern
  requires_plan_review (bool, default false)                           -- ADR-039: when true, contributions in this territory must transition through state=plan_review before in_progress; opt-in per territory (default off keeps simple-territory workflows unaffected)
  created_at

contributions
  id (uuid, pk)
  project_id (fk)
  author_composer_id (fk to composers, NOT NULL when state > 'open')   -- ADR-036 (immortal attribution)
  author_session_id (fk to sessions, nullable, ON DELETE SET NULL)     -- ADR-036 (operational; may dangle)
  trace_ids (text[], CHECK cardinality(trace_ids) > 0)                 -- ADR-021; non-empty enforced at DB level
  territory_id (fk)
  artifact_scope (text[], interpreted per territory.scope_kind)
  state (open | claimed | plan_review | in_progress | review | merged | rejected)    -- ADR-034 (blocked moved to blocked_by); ADR-039 (plan_review added; per-territory opt-in)
  kind (implementation | research | design)                             -- ADR-033 (proposal + decision dropped)
  requires_owner_approval (bool, default false)                         -- ADR-033 (set when author role != territory owner_role; gates merge per ARCH 7.5)
  blocked_by (fk to contributions, nullable)                            -- ADR-034 (non-null implies blocked, regardless of state)
  blocked_reason (text, nullable)                                       -- ADR-034 (optional human-readable, e.g., "waiting on auth contract")
  approved_by_composer_id (fk to composers, nullable)                   -- audit G2: set when an authorized reviewer clears requires_owner_approval via update(owner_approval=true) per ARCH 6.2.2; null otherwise
  approved_at (timestamp, nullable)                                     -- audit G2: timestamp of approval recording; null when requires_owner_approval has not been cleared
  plan_review_approved_by_composer_id (fk to composers, nullable)       -- ADR-039: immortal identity of the plan-reviewer; populated only when state transitioned out of plan_review via approval (not on plan_review->claimed rejection)
  plan_review_approved_at (timestamp, nullable)                         -- ADR-039: timestamp of plan approval; null when plan_review was never engaged or was rejected
  content_ref (path or URL)
  transcript_ref (text, nullable, CHECK matches path-or-url pattern)    -- ADR-024 + audit F8 (repo path under transcripts/** OR fully-qualified URL)
  fencing_token (bigint, nullable)
  repo_branch (text, nullable)                                          -- audit F11 (set on first IDE update; per ARCH 6.2.2.1)
  commit_count (integer, default 0)                                     -- audit F11 (incremented by push handler)
  last_observed_commit_sha (text, nullable)                             -- audit F11 (updated by push handler)
  created_at
  updated_at

decisions
  id (uuid, pk)
  project_id (fk)
  author_composer_id (fk to composers, NOT NULL)                        -- ADR-036 (immortal attribution)
  session_id (fk to sessions, nullable, ON DELETE SET NULL)             -- ADR-036 (operational; may dangle)
  trace_ids (text[], CHECK cardinality(trace_ids) > 0)                  -- ADR-021 + audit F16
  category (architecture | product | design | research)                  -- ADR-037 (convention dropped)
  triggered_by_contribution_id (fk to contributions, nullable)           -- ADR-037 (link back to the contribution that prompted this ADR, when applicable)
  summary
  rationale
  reverses (fk, nullable)
  repo_commit_sha
  created_at
  -- append-only: no UPDATE, no DELETE

locks
  id (uuid, pk)
  project_id (fk)
  holder_composer_id (fk to composers, NOT NULL)                        -- ADR-036 (immortal attribution)
  session_id (fk to sessions, nullable, ON DELETE SET NULL)             -- ADR-036 (operational; defense-in-depth -- reaper releases first per ARCH 6.1)
  contribution_id (fk to contributions)                                 -- audit F11 (per ARCH 7.4.1; multiple locks per contribution permitted)
  artifact_scope (text[])
  fencing_token (bigint, monotonic per project)
  lock_type (exclusive | shared)
  acquired_at
  expires_at                                                            -- audit F17 (soft hint; release happens at session-reap, explicit release_lock, or contribution merge/release; not auto-enforced)

contracts
  id (uuid, pk)
  project_id (fk)
  territory_id (fk)
  name
  schema (jsonb)
  version (integer)                                                     -- semver-encoded as major*1000+minor per ARCH 6.6.1
  published_at
  classifier_decision (breaking | additive)                             -- ADR-035 (the classifier's reading per ARCH 6.6.1)
  classifier_reasons (jsonb)                                            -- ADR-035 (the criteria triggered, e.g., ["field_removed:foo"])
  override_decision (breaking | additive | null)                        -- ADR-035 (publisher override; null when none)
  override_justification (text)                                         -- ADR-035 (required when override_decision is non-null)
  effective_decision (breaking | additive)                              -- ADR-035 GENERATED: COALESCE(override_decision, classifier_decision)
  CHECK (override_decision IS NULL OR (override_justification IS NOT NULL AND length(trim(override_justification)) > 0))

telemetry
  id (uuid, pk)
  project_id (fk)
  composer_id (fk to composers, nullable)                               -- ADR-036 (durable attribution; nullable because some events are system-emitted)
  session_id (fk to sessions, nullable, ON DELETE SET NULL)             -- ADR-036
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
- `contributions`: writes to `author_composer_id`-owned rows must match the calling session's composer (per ADR-036 -- the immortal identity is the authorization key; `author_session_id` is operational metadata that may be NULL after session reap and is not used for authorization). Reads are project-scoped. Territory-authorship checks per ARCH 6.2.1 step 4 read `composers.discipline` (per ADR-038) -- e.g., a territory with `owner_role=architect` admits composers where `discipline=architect`.
- `contributions.approved_by_composer_id` writes (via `update(owner_approval=true)` per ARCH 6.2.2): writer must hold the contribution's `territories.review_role` AND must NOT be the same composer as `author_composer_id` (a composer cannot self-approve their own cross-role contribution).
- `decisions`: append-only (policy rejects UPDATE and DELETE). Authorship checked against `author_composer_id` (per ADR-036).
- `locks`: writes restricted to the lock's `holder_composer_id` (per ADR-036). Reads are project-scoped.
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

#### 6.1.1 Self-verification flow (smoke test)

A deterministic smoke-test sequence verifies that a client + endpoint + identity-provider + datastore stack is wired correctly end-to-end. The same sequence is invoked by `atelier doctor` (US-11.9), by client-facing setup runbooks under `docs/user/connectors/`, and by CI integration tests at M2 endpoint sign-off.

**Sequence.**

```
1. register(project_id=<self-discovered or env>, surface=<from caller>, composer_token=<bearer>)
   Expected: 200; response carries session_token + initial context payload
   Validates: bearer-token validation, session insertion, RLS scope

2. heartbeat(session_token)
   Expected: 200 within 500ms p95
   Validates: session-token recognition, heartbeat-write path

3. get_context(trace_id=null)   // unscoped form
   Expected: 200; response carries non-empty charter.paths array, recent_decisions, territories.owned/consumed, contributions_summary
   Validates: get_context implementation, RLS-filtered reads, project-scoping

4. deregister(session_token)
   Expected: 200; subsequent heartbeat with the same token returns 401
   Validates: session cleanup, token invalidation
```

**Pass criteria.** All four steps return 200 with the documented response shapes. Any non-200 or missing field fails the smoke test with a step-specific error.

**Failure-to-cause mapping (canonical):**

| Symptom | Likely cause | Where to look |
|---|---|---|
| Step 1 returns 401 | Bearer token invalid, expired, or AS metadata misconfigured | ARCH section 7.9; identity-provider config |
| Step 1 returns 403 | composer_id from token does not match a valid composers row for the project | atelier invite history; `composers` table |
| Step 1 returns 500 | Datastore connection failure or schema not migrated | atelier datastore init; ATELIER_DATASTORE_URL |
| Step 2 returns 401 | session_token invalidated by reaper before heartbeat fired | session_ttl_seconds policy; clock skew |
| Step 3 returns empty charter.paths | Charter files not committed; ATELIER_REPO not pointed at a real repo | repo configuration; webhook setup |
| Step 4 succeeds but step-2-replay also succeeds | deregister did not actually delete the session row | endpoint implementation bug |

**Invocation paths.**

- **`atelier doctor`** runs the sequence as a project-scoped self-check against a configured composer token (typically the admin's). Reports per-step status with the symptom-to-cause mapping above.
- **Client-side smoke test** is documented per-client under `docs/user/connectors/<client>.md` using the bearer token from `atelier invite`. Composers run it once after first connector setup to confirm their setup before authoring real work.
- **CI integration test** at M2 endpoint sign-off runs the sequence against a deployed staging endpoint and gates promotion.

**Why deterministic.** The sequence intentionally avoids any tool that depends on project state (no `claim`, no `find_similar`, no `log_decision`). It exercises the auth + session + read paths only. A fresh project with no contributions / no decisions / no contracts still passes.

#### 6.1.2 Session row cleanup policy

The reaper (per section 6.1) marks expired sessions as `status=dead` but does not delete them. Without a separate cleanup pass the `sessions` table grows indefinitely as projects accumulate short-lived agent sessions.

A second phase of the same reaper cron deletes `status=dead` rows older than `policy.session_dead_retention_seconds` (default 86400, i.e. 24 hours). The 24-hour retention preserves recent session history for debugging and `/atelier/observability` queries (per section 8.2) while bounding table growth.

**What survives cleanup.** Telemetry events emitted by the session (per section 8.1: `session.registered`, `session.heartbeat`, `session.deregistered`, `session.reaped`, etc.) live in the `telemetry` table and are not affected by session row deletion. The `composer_id` and timing data in those events provide audit-trail continuity even after the source `sessions` row is gone.

**What deletion frees.** Foreign-key references to the deleted session are nulled (contributions previously claimed by that session were already returned to `state=open` at reap time per section 6.1; the FK reference is cosmetic at that point). Lock rows are similarly already released at reap time.

**Configurability.** Teams running with stricter audit requirements can set `session_dead_retention_seconds` higher (e.g., 30 days) at the cost of larger session table. Teams with high session churn can set it lower (e.g., 1 hour) at the cost of less debugging context. Default 24 hours balances both.

**Surfaced by:** `scale-ceiling-benchmark-plan.md` section 5.1 architectural analysis; landed in this ARCH as a side-deliverable of the scale-ceiling planning work.

### 6.2 Contribution lifecycle

```
Create paths (per ADR-022):
  (a) Pre-existing open row (e.g., from BRD ingestion):
      Agent → claim(contribution_id) → state=claimed, author_session_id set
  (b) Atomic create-and-claim (ad-hoc work, esp. analyst):
      Agent → claim(null, kind, trace_ids, territory_id, optional content_stub)
        Endpoint inserts (state=open) and transitions to claimed in one transaction
   In both paths the endpoint runs find_similar on the new claim → warns if match
Optional plan-review gate (per ADR-039; activates iff territory.requires_plan_review=true):
   Agent → update(contribution_id, state=plan_review, payload=<plan markdown>)
     state=claimed → state=plan_review; no fencing token required (plan IS the working content at this state)
   Reviewer (territory.review_role; not the author) → update(contribution_id, state=in_progress)
     state=plan_review → state=in_progress; populates plan_review_approved_by_composer_id + plan_review_approved_at
   Reviewer rejects: update(contribution_id, state=claimed, reason=<text>)
     state=plan_review → state=claimed; agent revises and re-submits, or releases
   When territory.requires_plan_review=false (default), this gate is skipped entirely; lifecycle proceeds claimed → in_progress as before. See section 6.2.1.7 for full semantics.
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
  kind:              "implementation" | "research" | "design",   // required when contribution_id=null; per ADR-033 (decision routes via log_decision; proposal removed -- gate is the role check below)
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

1. `kind` is in the three-value enum (per ADR-033).
2. `trace_ids` is non-empty and every entry matches the project's `trace_id_pattern` from `.atelier/config.yaml`. Trace IDs need not yet exist in `traceability.json` (the registry catches up via the M1 traceability sync); the pattern check prevents typos.
3. `territory_id` references a row in `territories` for this project.
4. The calling session's composer holds a discipline (per ADR-038 `composers.discipline`) that may author into this territory. By default, only composers whose discipline matches `territories.owner_role` may author; `.atelier/config.yaml: territories.allow_cross_role_authoring` can opt-in to broader authoring. When the calling composer's discipline does NOT match `territories.owner_role` (and cross-role authoring is opted-in), the contribution is created with `requires_owner_approval=true` per ADR-033 -- the merge gate per ARCH 7.5 reads this flag. Composers whose `discipline` is null (access-level-only roles like admin or stakeholder) cannot create contributions; they participate via the lens model + comment routing (per ADR-017).
5. `content_stub`, if provided, fits within a configurable size cap (default 8 KiB).

**Implicit find_similar gate.** On atomic-create, the endpoint synchronously runs `find_similar(description=<derived>, trace_id=<first trace_id>)` where `<derived>` is `content_stub` if provided, otherwise a synthesized string from `kind + trace_ids + territory.name`. Results are returned in `similar_warnings` (primary band only; weak suggestions excluded to keep the response compact). The gate never blocks claim -- it warns. Composers can choose to release the new contribution immediately if a strong match exists.

**Race handling.** Two atomic-create calls for the same `kind + trace_ids + territory_id` succeed independently and produce two contribution rows. There is no implicit dedup -- duplicate work is a coordination concern, surfaced by the find_similar warning, not a uniqueness constraint. The two composers see each other's claim via `/atelier` presence (post-M4) and via the warning.

**`content_stub` semantics.** When provided, `content_stub` is written as the initial body of the contribution's `content_ref` artifact:

- For IDE-surface composers: the stub is returned in the response; the local agent writes it to disk under the appropriate path (`research/<trace>-<slug>.md`, `prototype/...`, etc.) using the territory's `scope_kind` to decide convention.
- For remote-surface composers: the per-project endpoint committer (per ADR-023, ARCH section 7.8) commits the stub to the repo as part of the create transaction. The commit author follows the section 7.8 attribution rules. Synchronous: claim does not return until the commit succeeds. On commit failure, the entire create-and-claim transaction rolls back.

If `content_stub` is null, no artifact is created; the contribution row carries `content_ref=null` until the first `update` call sets it.

**Idempotency.** Atomic-create accepts an optional `idempotency_key` (any unique string, typically a UUID generated by the agent client). The endpoint records `(session_id, idempotency_key)` in a per-session dedup table. A retry with the same key returns the original `ClaimResponse` rather than creating a duplicate. Keys are valid for 1 hour, then expire. Remote-surface composers should always send a key because their network path is longer.

**Lock acquisition is separate.** Claim does not acquire any lock. The agent must follow up with `acquire_lock(contribution_id, artifact_scope)` per the lifecycle above. If `acquire_lock` fails (e.g., the scope is already locked by another contribution), the contribution remains claimed but cannot be authored against. The agent's choices: wait, narrow the scope, or `release(contribution_id)` to give it back to `state=open`. There is no auto-release on lock failure -- an analyst may legitimately hold a contribution while waiting for a busy artifact.

#### 6.2.1.5 Pre-existing claim path

Section 6.2.1 specified the atomic-create path. The pre-existing path is the more common case for IDE-surface dev composers picking up BRD-ingested user-story contributions:

**Signature.**

```
claim(
  contribution_id: uuid,                                     // required; identifies the existing open row
  idempotency_key: string | null                             // optional; same semantics as atomic-create
) -> ClaimResponse
```

`kind`, `trace_ids`, `territory_id`, `content_stub` are NOT permitted on the pre-existing path -- they would conflict with the row's existing values. Including them returns BAD_REQUEST.

**Validation.**

1. The named `contribution_id` exists in the project.
2. The contribution is in `state=open` (not already claimed by another session).
3. The calling session's composer holds a role that may author into the contribution's territory (same role check as atomic-create per section 6.2.1).

**Conditional UPDATE.** The state transition is `UPDATE contributions SET state="claimed", author_session_id=<session>, updated_at=now WHERE id=<id> AND state="open"`. The `state="open"` predicate prevents racing claims: only one session can win the transition. The losing session receives `CONFLICT` with the current `author_session_id` so they know who claimed it.

**Find_similar gate.** Same as atomic-create -- the implicit gate runs and surfaces matches in `similar_warnings`. For pre-existing rows, the description is derived from the contribution's existing fields (`kind + trace_ids + territory.name`); `content_stub` is unavailable because the row is pre-existing.

**Idempotency.** Same per-session 1-hour dedup. A retry with the same key returns the original ClaimResponse.

**Created flag.** `ClaimResponse.created` is `false` for the pre-existing path, distinguishing it from atomic-create.

#### 6.2.1.7 Plan-review gate (per ADR-039; per-territory opt-in)

When the contribution's territory has `requires_plan_review=true`, the lifecycle inserts a `plan_review` state between `claimed` and `in_progress`. When the territory has `requires_plan_review=false` (the default), this section does not apply and the lifecycle proceeds claimed -> in_progress as before.

**Activation rule.** The endpoint reads `territories.requires_plan_review` for the contribution's `territory_id` at the moment of any `update(state=...)` call. If the territory requires plan-review:
- `update(state="in_progress")` from `state=claimed` is REJECTED with `BAD_REQUEST` ("territory requires plan_review; transition to plan_review first"). The agent must transition to plan_review before in_progress.
- `update(state="plan_review", payload=<plan markdown>)` from `state=claimed` is the legal path forward.

If the territory does not require plan-review, calls to `update(state="plan_review", ...)` are REJECTED with `BAD_REQUEST` ("territory does not require plan_review"). Plan-review is opt-in; territories that haven't enabled it cannot be targeted for plan-review writes (prevents accidental scope creep).

**Author transitions into plan_review.**

```
update(
  contribution_id:   uuid,
  state:             "plan_review",
  payload:           string,                                  // required; the plan markdown body
  content_ref:       string,                                  // required on first plan_review entry; e.g., "<contribution>/plan.md"
  fencing_token:     null                                     // not required at plan_review (no artifact-body lock applies; see "Lock semantics" below)
) -> UpdateResponse
```

Validation:
1. Contribution is in `state=claimed`.
2. Calling session's composer is the `author_composer_id` of the contribution (only the author may submit a plan).
3. Territory has `requires_plan_review=true`.
4. `payload` is non-empty (no zero-length plans).

On success, the contribution row updates: `state=plan_review`, `content_ref` set (if first entry), the plan body is stored at `content_ref`. Telemetry: `contribution.plan_submitted` recorded with `plan_length_chars` in metadata.

**Plan-revision path.** If the agent wants to revise a submitted plan before review (e.g., realized something missing), `update(state="plan_review", payload=<revised plan>)` from `state=plan_review` is permitted only by the author. The plan body at `content_ref` is overwritten. Telemetry: `contribution.plan_resubmitted`. This avoids forcing the author through claimed -> plan_review for trivial in-flight edits.

**Reviewer transitions out of plan_review (approval).**

```
update(
  contribution_id:   uuid,
  state:             "in_progress"
) -> UpdateResponse
```

Validation:
1. Contribution is in `state=plan_review`.
2. Calling session's composer holds `discipline = territory.review_role` (the same role-check used for the existing review state per ADR-025).
3. Calling session's composer is NOT the contribution's `author_composer_id` (self-approval blocked, same as the audit-G2 owner-approval rule).

On success: `state=in_progress`, `plan_review_approved_by_composer_id` set to the reviewer's composer_id, `plan_review_approved_at = now()`. Telemetry: `contribution.plan_approved` recorded with `reviewer_composer_id` in metadata.

**Reviewer transitions out of plan_review (rejection).**

```
update(
  contribution_id:   uuid,
  state:             "claimed",
  reason:            string                                   // required when transitioning plan_review -> claimed; surfaces in /atelier and in telemetry
) -> UpdateResponse
```

Validation: same as approval (reviewer composer in territory.review_role; not the author). The `reason` field is required so the author has actionable feedback and the audit trail captures why the plan was rejected.

On success: `state=claimed`, `plan_review_approved_by_composer_id` and `plan_review_approved_at` remain NULL (never set on a rejected plan). The agent can revise and re-submit by transitioning to plan_review again. Telemetry: `contribution.plan_rejected` with `reviewer_composer_id` and `reason` in metadata.

**Lock semantics.** No lock is required at `plan_review`. The plan markdown is a document that the author writes once (or revises in-place) and the reviewer reads; there is no concurrent-write conflict surface to fence against. Two agents cannot be simultaneously in plan_review for the same contribution because the contribution is single-claimed via `author_session_id` from the prior claim transition. Locks remain required at `in_progress` per ARCH section 7.4 -- the existing `acquire_lock` flow happens after plan-approval transitions the contribution to `in_progress`.

**Release behavior at plan_review.** `release(contribution_id)` from `state=plan_review` is permitted only by the author (same author-only rule as release from any other state). On release:
- `state -> open`, `author_session_id -> null`, `author_composer_id -> null` (per existing release semantics).
- The plan body at `content_ref` is preserved as a repo artifact -- it is not deleted. A subsequent claimer of the now-open contribution could read the prior plan as context, though they are not bound by it (the new claim path resets `state=open` and erases `plan_review_approved_*` columns).
- Telemetry: standard `contribution.released` event; the `metadata` payload includes `prior_state=plan_review` so the abandoned-at-plan pattern is observable.

**Auditability shape.** An auditor reading the canonical state for a contribution that passed through plan_review sees:
- `plan_review_approved_by_composer_id` -- who approved
- `plan_review_approved_at` -- when they approved
- The plan body at `content_ref` (preserved via the standard content-ref mechanism)
- The telemetry trail: `contribution.plan_submitted` -> `contribution.plan_approved` (or `_rejected`) -> `contribution.updated` -> `contribution.released` or final state

This is the load-bearing primitive that justifies the structural addition over a convention-based alternative: the audit trail lives in canonical state, queryable via RLS, telemetry-visible, and survives session reaping per ADR-036.

**Configuration.** Adding `requires_plan_review: true` to a territory in `.atelier/territories.yaml` is a deliberate signal that the territory's work warrants the alignment-touchpoint cost. The repo's own territories.yaml does NOT enable plan_review on any territory at v1 ship -- this is a per-deployment opt-in decision. Reasonable defaults for teams that opt in: enable on territories with `owner_role` in (architect, designer) where work tends to be high-stakes and irreversible.

**Find_similar interaction.** The implicit find_similar gate per section 6.2.1 fires at claim time, before plan_review. The plan body is not re-embedded as a separate find_similar surface at v1 -- only contributions, decisions, and BRD/PRD sections are corpus-eligible per ADR-006. Plan re-embedding can be a v1.x feature if reviewers signal demand for "is anyone else proposing this plan shape?" surfacing.

#### 6.2.2 Update operation semantics

`update` is the tool that advances a contribution from `claimed` through `in_progress` to `review`, and is the write-path for artifact content. Latent details from ARCH 6.2's high-level lifecycle:

**Signature.**

```
update(
  contribution_id:    uuid,                                   // required
  state:              "claimed" | "plan_review" | "in_progress" | "review" | null,   // optional; null means no state change; per ADR-034 blocked is no longer a state value; plan_review per ADR-039 (per-territory opt-in; see section 6.2.1.7)
  content_ref:        string | null,                          // optional; sets the artifact path on first call
  payload:            string | null,                          // optional; the artifact body
  payload_format:     "full" | "patch",                       // optional; defaults to "full"
  fencing_token:      bigint,                                 // required when payload is provided
  blocked_by:         uuid | null,                            // optional; non-null sets the contribution as blocked on the named contribution (per ADR-034); null clears
  blocked_reason:     string | null,                          // optional; human-readable when blocked_by is non-null
  owner_approval:     boolean,                                // optional, default false; when true, clears requires_owner_approval per audit G2 -- caller must hold territory.review_role AND must not be the contribution's author_composer_id (RLS rule per ARCH 5.3)
  commit_message:     string | null                           // optional; remote-surface only; defaults to convention below
) -> UpdateResponse
```

**Payload semantics.**

- `payload_format="full"` (default): `payload` is the complete new body of the artifact. The endpoint replaces the file contents wholesale. Simple to reason about; preferred for research artifacts and short documents.
- `payload_format="patch"`: `payload` is a unified diff against the current artifact body. The endpoint applies the patch atomically. Preferred for incremental code edits where preserving line-precise context matters.

`payload` may be null when only `state` is changing (e.g., `claimed` to `in_progress` to signal start without content yet).

**Fencing token requirement.** Any call providing `payload` must include a valid `fencing_token` from a prior `acquire_lock` against the artifact's scope. The endpoint validates the token server-side per ARCH section 7.4. State-only updates (no `payload`) do not require a fencing token.

**Owner approval recording (per audit G2).** `update(owner_approval=true)` is the explicit human approval action recorded in datastore per ARCH 7.5. On success, the endpoint atomically:
- Sets `contributions.requires_owner_approval = false`.
- Sets `contributions.approved_by_composer_id` to the calling session's composer.
- Sets `contributions.approved_at` to now.
- Emits telemetry event `contribution.approval_recorded` with the approving composer and the contribution's prior author for audit.

Validation per ARCH 5.3: the caller must hold the contribution's `territories.review_role` AND must not be the contribution's `author_composer_id` (no self-approval). Calls failing either check return 403 with the specific reason. Calls on a contribution where `requires_owner_approval=false` (already approved or never required) are no-ops (idempotent).

This pairs with the merge gate in ARCH 6.2.3: `update(state="merged")` on a contribution where `requires_owner_approval=true` returns CONFLICT with the message "owner approval required; call update(owner_approval=true) from a reviewer first." The CI mirror per ARCH 7.5 enforces the same constraint at the repo layer.

**Branch strategy for remote-surface composers.** The per-project endpoint committer (per ADR-023, ARCH section 7.8) commits each `update` call as a discrete commit on a per-contribution branch:

- Branch name: `<contribution_kind>/<first-trace-id>-<contribution_id_short>` (e.g., `research/US-1.3-a3f2e1b9`).
- Branch is created on the first `update` that produces a commit.
- The branch is merged to `main` when the contribution transitions to `merged` (via the review path; see section 6.2.3).
- IDE-surface composers commit to whatever branch their local git is on; the endpoint observes the branch via the contribution row's `repo_branch` field (added at M2 with the contributions table) and via versioned-file-store webhooks per section 6.2.2.1.

#### 6.2.2.1 Endpoint observation of IDE-surface commits

For IDE-surface composers the endpoint does not mediate writes. The composer commits and pushes locally. The endpoint learns about commits via the versioned-file-store webhook (configured at `atelier deploy` time):

- **Webhook events subscribed:** `push` (any branch), `pull_request.opened`, `pull_request.synchronize`, `pull_request.merged`.
- **Push handler:** parses the pushed branch name. If the name matches `<kind>/<trace-id>-<short-id>` for a known contribution, the endpoint updates `contributions.commit_count` and `contributions.last_observed_commit_sha`. Branches not matching the convention are ignored (the endpoint does not own all branches).
- **PR handlers:** see section 6.2.3 for the merge-observation path.
- **Latency:** webhook delivery is best-effort by the provider. Typical latency under 5 seconds; SLA depends on the configured provider.
- **Catch-up.** If the endpoint missed a webhook (provider downtime, restart), the periodic reconcile script (section 6.5) detects branches with commits ahead of the recorded `last_observed_commit_sha` and updates lazily.

The `repo_branch` field is set on the first IDE `update` call -- the agent declares its branch name explicitly. The endpoint does not infer branch from commit history; declaration is required to handle composers using non-conventional branch names.

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

- **For repo-resident artifacts (most contributions):** the contribution branch carries an open PR. PR creation responsibility depends on surface:
  - For remote-surface composers (web/terminal without local repo), the per-project endpoint committer (per section 7.8) opens the PR using its bot identity at the moment of the `state=review` transition.
  - For IDE-surface composers, the endpoint opens the PR via the versioned-file-store API at the `state=review` transition. By default the PR is attributed to the project's bot identity (consistent with remote-surface) so the PR-open audit trail is uniform; teams that prefer the dev's own identity on PRs may set `git_provider.use_composer_identity_for_pr_open: true` in `.atelier/config.yaml`, in which case the PR is opened via the composer's identity (requires the composer's identity provider to grant a write-scoped token to Atelier).
  - In both cases the endpoint validates that commits exist on the declared `repo_branch` before opening the PR. If no commits exist, `update(state="review")` returns BAD_REQUEST asking the composer to push first.

  The reviewer approves and merges the PR via the versioned-file-store UI or CLI. The merge webhook fires; the endpoint observes the merge via commit on `main` and transitions the contribution to `state=merged`.
- **For research artifacts (no PR pattern):** the reviewer calls `update(contribution_id, state="merged")` directly via the endpoint; no PR is involved because the artifact already lives on the branch and no code review applies.
- **For decisions:** decisions log via `log_decision` (see section 6.3), not via update. They have no `review` state.

**Authoritative merge confirmation.** A contribution is `state=merged` if and only if either (a) the corresponding PR is merged on `main`, observed via webhook, or (b) for non-PR artifacts, an authorized reviewer called `update(state="merged")`. The datastore state alone does not constitute merge -- the repo is canonical per ADR-005.

**Reviewer not available.** If `territories.review_role` for the contribution's territory has no active composer, the contribution stays in `state=review` indefinitely. The `/atelier` admin lens surfaces "review-stuck" contributions via section 8.2 observability. There is no auto-promotion of stuck reviews; coordination is the team's responsibility.

**Cross-territory contributions.** Per ADR-021, contributions may carry multiple `trace_ids`. If those trace IDs span multiple territories, the contribution's primary territory (the one passed to `claim`) drives review routing. Cross-territory consumers may comment but only the primary territory's `review_role` may merge.

#### 6.2.4 Release (the abandon-claim tool)

`release` is one of the 12 tools per ADR-013. Distinct from `release_lock` (which releases an artifact lock per section 7.4) and from `update(state="review")` (which advances toward merge per section 6.2.3). `release` returns a claimed contribution to `state=open` -- the abandon path.

**When release applies.** A composer who has claimed a contribution and decided not to author it (scope changed, found a better-fit composer, scope is too large for one session, etc.) calls `release` to give it back. The contribution becomes available for re-claim by any composer.

**Signature.**

```
release(
  contribution_id: uuid,
  reason: string | null     // optional; recorded in telemetry for audit
) -> ReleaseResponse

ReleaseResponse {
  contribution_id: uuid,
  state: "open",            // always open on success
  prior_author_session_id: uuid    // historical attribution preserved in telemetry
}
```

**Validation.**

- The calling session must be the contribution's current `author_session_id`. Other sessions cannot release someone else's claim.
- The contribution must be in `state=claimed` or `state=in_progress`. Releasing from `state=review` or `state=merged` returns `BAD_REQUEST` (use the review-routing path or, for merged contributions, file a reversal as a new contribution).

**Side effects.**

- `contributions.state -> open`, `contributions.author_session_id -> null`.
- Any locks held by the session against this contribution's artifact_scope are released (same effect as calling `release_lock` for each).
- Telemetry event `contribution.released` recorded with `prior_author_session_id` and `reason` so the abandoned-work pattern is observable in `/atelier/observability` (section 8.2).
- Broadcast `contribution.state_changed` (post-M4) so subscribers (e.g., other composers' `/atelier` lenses) see the contribution become available.

**Distinction from session reaping.** The reaper (per section 6.1) automatically releases contributions held by dead sessions. Explicit `release` is the live-session equivalent: "I'm alive but choosing to give this back." Both produce the same end state (state=open, author_session_id=null) and emit the same broadcast; only the telemetry differs (manual vs reaped).

**Atomic-created contributions.** A contribution created via the atomic claim path (section 6.2.1) and never authored against can be released the same way. The contribution row remains in the database with state=open; future composers see it as available work. There is no auto-deletion of unauthored contributions -- they persist until explicitly authored or until the project is archived.

### 6.3 Decision log write (the four-step atomic operation)

```
Agent → log_decision(category, summary, rationale, trace_ids, reverses?, idempotency_key?)
  Endpoint:
    1. Creates new file at decisions/ADR-NNN-<slug>.md in repo (commit + push) per ADR-030
    2. Inserts row in decisions table with repo_commit_sha
    3. Embedding pipeline picks up the new ADR via the commit webhook (per section 6.4.2);
       NOT inline in this transaction
    4. Broadcasts decision.created via pub/sub (post-M4 broadcast substrate)

  If step 1 push fails after local commit: see retry semantics in section 6.3.1
  If step 2 fails: repo write is authoritative; next call retries mirror keyed by repo_commit_sha
  If step 3 lags or fails: find_similar falls back to keyword search per section 6.4; banner in UI
  If step 4 fails (post-M4): sessions receive next update on reconnect
  Step 1 succeeding (commit + push) is the single success criterion for log_decision
```

#### 6.3.1 Operational specifics

**Signature (full).**

```
log_decision(
  category:                     "architecture" | "product" | "design" | "research",   // per ADR-037 (convention dropped)
  summary:                      string,                                   // becomes the ADR title
  rationale:                    string,                                   // becomes the body's Rationale section
  trace_ids:                    string[],                                 // per ADR-021; non-empty
  reverses:                     string | null,                            // optional; an existing ADR id like "ADR-014"
  triggered_by_contribution_id: string | null,                            // optional; per ADR-037 -- links the ADR back to the contribution that prompted it, when applicable
  idempotency_key:              string | null                             // optional but recommended; same semantics as claim per section 6.2.1
) -> LogDecisionResponse

LogDecisionResponse {
  decision_id:     uuid,
  adr_id:          string,                                   // e.g., "ADR-034"
  repo_path:       string,                                   // e.g., "docs/architecture/decisions/ADR-034-xxx.md"
  repo_commit_sha: string,
  created:         boolean                                   // false if idempotency_key matched a prior call
}
```

**Slug derivation.** `slug = lowercase(summary).replace(/[^a-z0-9]+/g, "-").trim("-").slice(0, 60)`. The endpoint applies this transform; agents do not pass a slug. If the slug collides with an existing file (extremely rare), the endpoint appends `-2`, `-3`, etc.

**ADR-NNN allocation.** The endpoint allocates `NNN` via a per-project monotonic counter held in a dedicated `adr_sequence` table (atomic increment under transaction). Two concurrent `log_decision` calls receive distinct NNN values. The counter never decrements; if a commit fails after allocation, that NNN is "spent" -- the next decision uses NNN+1. Gaps in the ADR sequence are acceptable (matches the per-ADR file-split spirit of ADR-030).

**Reversal flag.** When `reverses` is provided, the endpoint:
- Validates that the named ADR exists in `decisions` and was not itself reversed.
- Adds `reverses: ADR-NNN` to the new ADR's frontmatter.
- Updates the decisions index README via the same commit (the index marks the reversed ADR as superseded, with a link to the reversal).

The append-only convention is preserved: the original ADR file is not modified. Only the index reflects the reversal relationship.

**Idempotency.** Same dedup mechanism as `claim` (per section 6.2.1): per-session `(session_id, idempotency_key)` keyed; 1-hour validity. A retry with the same key returns the original response without re-creating the ADR. Critical for remote-surface composers since `log_decision` performs a network commit + push.

**Step 1 retry semantics on push failure.** If the local commit succeeds but `git push` fails (network blip, remote rejection, etc.):
- The endpoint retains the commit on the local working repo (per ADR-023's per-project committer holds a working clone).
- The committer retries push with exponential backoff (3 attempts, 5s/15s/45s).
- On final retry failure: the entire `log_decision` returns a retryable error with a stable `idempotency_key` echoed to the caller. The caller may retry; the local commit is preserved across retries via the idempotency table.
- The local commit is never auto-discarded -- recovering from a stuck push state is an admin operation via `atelier doctor` (M7).

**Decision commits always route through the endpoint committer regardless of composer surface.** IDE-surface composers commit code edits locally (per section 6.2.2.1) but `log_decision` calls always trigger a commit by the per-project endpoint committer (section 7.8). Two reasons: (1) ADR-NNN allocation requires the per-project monotonic counter held server-side; an IDE composer cannot pick a globally-unique NNN locally without a round trip. (2) The append-only invariant on the decisions directory requires server-side enforcement -- the committer is the choke point that ensures no ADR file is ever modified, only created. Decision commits are attributed via the same Co-Authored-By scheme as remote-surface code commits (section 7.8 attribution rules) so the calling composer's identity is preserved in `git log`.

**Step 3 reconciliation with section 6.4.2.** The ARCH section 6.3 four-step text historically described "Step 3: generates embedding + upserts into vector index" as inline. With section 6.4.2 (added 2026-04-27) embedding becomes webhook-driven on commit to main -- it is the same operation but happens out-of-transaction with respect to log_decision. Step 1's commit triggers the same webhook the embed pipeline already listens to; no separate trigger from log_decision is needed. The four-step description retains "Step 3" as a phase name for clarity but the implementation is asynchronous to log_decision.

**Step 4 broadcast message shape (post-M4).**

```
{
  channel: "decision.created",
  payload: {
    decision_id: uuid,
    adr_id: "ADR-NNN",
    project_id: uuid,
    trace_ids: string[],
    category: string,
    summary: string,                            // for client-side preview without re-fetching
    repo_path: string,
    repo_commit_sha: string,
    reverses: string | null,
    created_at: timestamp
  }
}
```

Subscribers: `/atelier` lenses (refresh decisions panel), agent sessions whose territories consume the affected trace_ids (via territory contracts), the M5 find_similar pipeline (re-rank cache invalidation).

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
  (Trigger mechanism evolves across milestones --
   polling at M1, post-commit hooks at M2, broadcast at M4.
   See scripts/README.md "publish-delivery trigger model" for cutover plan.)
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

**triage** (external comments → human-gated contributions; per ADR-033 these carry `kind` matching the change's discipline + `requires_owner_approval=true`, replacing the historical `kind=proposal` mechanism from ADR-018):
```
Trigger: webhook from published-doc or delivery tracker or design tool
  Pipeline:
    1. Classifier: category (scope | typo | question | pushback | off-topic), confidence
    2. If confidence > threshold:
       Drafter: generates proposed change as patch/diff
       Creates contribution with kind matching the change's discipline (implementation/research/design),
         author_session_id pointing at the triage-system session, requires_owner_approval=true (per ADR-033)
    3. If confidence < threshold:
       Routes to human-only queue for manual classification
    4. Never auto-merges
```

#### 6.5.1 Figma projection: explicit non-automation at v1

ADR-019 establishes that Figma is a feedback surface, not a design source -- design components live in the repo. The natural reading of "Figma receives projections of components" is that Atelier auto-pushes component renders to Figma. **At v1, Figma projection is explicitly NOT an Atelier automation.** Per ADR-008 the v1 sync substrate has exactly five scripts (publish-docs, publish-delivery, mirror-delivery, reconcile, triage); `publish-design` is not one of them.

Designers manually project components to Figma using their team's existing tooling (e.g., a storybook-to-figma export pipeline, the Figma API via a one-off script, or simple screenshot + paste). The projected Figma frame carries a manually-applied banner per the publish-pull asymmetry convention (NORTH-STAR section 8): "edit in repo, not here. Comment to propose changes."

Atelier's v1 responsibility on the Figma surface is **inbound only**: comments on the projected frame flow back through the triage script per section 6.5.2. The projection direction stays manual.

**Why explicit non-automation rather than a 6th script.** The five-script substrate is locked at v1 per ADR-008 to keep the surface area learnable. Adding `publish-design` would require either expanding the substrate (violating ADR-008) or sub-folding it into one of the existing scripts (no clean fit -- Figma is neither a delivery tracker nor a published-doc system in any structural sense). Manual projection is acceptable because designer workflows already include this step in current teams; Atelier's value-add is the inbound triage path, which is automated.

**v1.x extension hook.** A future `publish-design` script (or a sub-feature of `publish-docs` extended to handle design tools) is contemplated but not committed. Teams that want auto-projection at v1 can implement a project-local CI script that reads from `prototype/src/components/**` and writes to Figma; this lives outside Atelier's substrate but is a natural plugin point.

#### 6.5.2 Figma triage mechanics

The triage script per section 6.5 handles inbound comments from Figma (US-9.5/9.6/9.7, US-10.5). Figma-specific operational details:

**Webhook event.** Figma's webhook fires on `FILE_COMMENT` events. The triage script subscribes via the configured `integrations.design_tool.kind: figma` and `file_key`. The webhook payload includes the comment text, author, frame_id, and parent comment_id (for thread replies).

**Frame-to-contribution mapping.** Atelier needs to map a Figma frame back to a contribution to know what the comment is about. The mapping happens at projection time via embedded metadata:

- When a designer manually projects a component to Figma (per section 6.5.1), they paste a small JSON metadata block as a comment on the frame, in the format `{"atelier": {"contribution_id": "<uuid>", "trace_ids": ["US-3.3"], "component_path": "prototype/src/components/Button.tsx"}}`. This is part of the manual projection convention, not enforced by Atelier.
- The triage script reads this metadata comment when ingesting other comments on the same frame to attribute them.
- If no metadata comment exists on the frame, the triage script falls back to filename-based heuristic matching (frame name vs. component file name) and flags low-confidence matches for human routing.

**Drafted contribution content shape (Figma-sourced).** For Figma comments, the drafted contribution's `content_ref` is null (no patch can be auto-generated from a design comment). The drafted contribution's `content` field carries:

```yaml
source: figma
file_key: <key>
frame_id: <id>
comment_id: <id>
comment_author: <name>
comment_text: <verbatim>
parent_contribution_id: <uuid or null>
classifier_category: scope | typo | question | pushback | off-topic
classifier_confidence: 0.0 - 1.0
suggested_action: <free text from drafter>
```

The reviewer (the parent contribution's territory.review_role) sees the proposal in their `/atelier` lens, decides whether to address it (incorporate into the parent contribution as a follow-up update), reject it (close the proposal), or convert it to a fresh contribution.

**Unmappable comments.** If neither the metadata comment nor the heuristic match yields a contribution, the proposal is created with `parent_contribution_id=null` and routed to the admin queue. Admins can manually attribute or close.

**Comment edits and deletions.** Figma webhooks fire on comment updates and deletions. Triage handles updates by appending revisions to the proposal's content (the proposal does not get re-classified -- the original classifier outcome is sticky). Deletions mark the proposal as `state=rejected` with a `rejection_reason: source-deleted`.

### 6.6 Territory contract flow

```
Territory owner → propose_contract_change(territory_id, name, schema, override_classification?, override_justification?)
  Endpoint:
    1. Validate caller holds territory.owner_role discipline (per ARCH 5.3)
    2. Classify as breaking or additive per §6.6.1
    3. Apply ADR-035 effective_decision = COALESCE(override_decision, classifier_decision)
    4. If effective_decision = "additive":
       Insert contract version N+1 (minor bump); broadcast contract.published (post-M4)
       Return outcome="published"
    5. If effective_decision = "breaking":
       Create a contribution with kind=design (or kind matching consumer discipline),
         requires_owner_approval=true, tagged to the proposed contracts row
       Consumers approve via update(owner_approval=true) per ARCH 6.2.2
       On approval: insert contract version N+1 (major bump); broadcast contract.published
       Return outcome="proposal_created" with contribution_id
       Otherwise: proposal expires per BRD-OPEN-QUESTIONS section 8 (TODO: window cadence), contract unchanged
```

The tool name and signature land per ADR-040 (12-tool surface consolidation, 2026-04-30); the prior `publish_contract` and `get_contracts` names are not part of the v1 surface. Contract reads are served via `get_context` per section 6.7's ContextResponse shape.

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

**Publisher override.** A territory owner may classify an otherwise-breaking change as additive by passing `override_classification="additive"` plus a required `override_justification` string. The override is recorded on the `contracts` row and surfaced in `/atelier/observability` for audit. Overrides are reversible by any consumer territory by opening a contribution with `kind=design` (or matching their discipline) and `requires_owner_approval=true` against the publishing territory; the publishing-territory `review_role` then approves or rejects per the ARCH 6.2.2 owner-approval flow.

**Versioning.** Semver-style. Additive changes bump minor (`1.4 → 1.5`); breaking changes bump major (`1.5 → 2.0`). `contracts.version` is an integer pair stored as `major*1000+minor` to preserve sort order; the human-facing string is rendered on read. Consumers pin to a major version; minor upgrades are automatic.

#### 6.6.2 Design contract schemas

The `prototype-design` territory publishes two contracts: `design_tokens` and `component_variants`. Their v1 schemas:

**`design_tokens` schema.** Captures the raw design-token definitions consumed by `prototype-app` and downstream rendering surfaces.

```yaml
contract_name: design_tokens
version: <major.minor>
schema:
  tokens:
    color:
      <token_name>:
        value: <hex | rgb | hsl>
        description: <free text>
    spacing:
      <token_name>:
        value: <css-length>
    typography:
      <token_name>:
        family: <font stack>
        size: <css-length>
        weight: <100-900>
        line_height: <number>
    radius:
      <token_name>:
        value: <css-length>
    shadow:
      <token_name>:
        value: <css-shadow>
    z_index:
      <token_name>:
        value: <integer>
  meta:
    source: prototype/design-tokens/    # repo path the contract derives from
    last_token_count: <integer>          # advisory; not a constraint
```

Breaking-change classification (per section 6.6.1) on `design_tokens`: removing a token, renaming a token, or narrowing a value type (e.g., a token that was previously a free-form color becoming a constrained-palette enum) is breaking. Adding tokens is additive. Changing a token's value (e.g., adjusting a color hex) is additive at the contract layer (the contract shape is unchanged) but may be a breaking visual change for consumers -- the breaking-visual concern is handled at PR review, not at contract versioning.

**`component_variants` schema.** Captures the catalog of components and their available variants.

```yaml
contract_name: component_variants
version: <major.minor>
schema:
  components:
    <component_name>:
      path: <repo path to component file>
      variants:
        - name: <variant_name>
          props:
            <prop_name>: <prop_type>     # primary | secondary | tertiary | etc.
          required_tokens:
            - <token_name>               # references design_tokens contract
        - name: <variant_name>
          ...
      slots:
        - <slot_name>: <slot_description>
```

Breaking-change classification on `component_variants`: removing a component, removing a variant, removing a required slot, narrowing a prop type, or renaming any of the above is breaking. Adding components, variants, or optional slots is additive.

**Cross-contract dependency.** `component_variants.required_tokens[]` references token names in `design_tokens`. The contract publish flow (section 6.6) validates that referenced tokens exist; missing references return BAD_REQUEST and block the publish. When `design_tokens` undergoes a breaking change that removes a referenced token, `component_variants` is automatically flagged as needing a proposal-flow re-publish.

**Storage.** Contracts are stored in the `contracts` table per ARCH section 5.1, with the `schema` jsonb field carrying the YAML-equivalent JSON. The repo also stores a snapshot under `docs/architecture/schema/contracts/<contract_name>-v<major>.<minor>.yaml` for offline reading and find_similar embedding.

### 6.7 Get_context execution

`get_context` is the canonical session-continuity surface (per `../methodology/METHODOLOGY.md §6.1`; pre-M2 stand-in retired at M2-mid). It answers, in one call: what is the current state, where did the last session leave off, what decisions affect my work, what is open in my territory.

**Project scope.** The session token already carries `project_id`. `get_context` is implicitly project-scoped — there is no `project_id` parameter. A composer in multiple projects (per ADR-015) holds multiple sessions, one per project, and queries each independently.

**Signature.**

```
get_context(
  trace_id?:              string | string[],   // optional; scopes recent_decisions, contributions, traceability
  since_session_id?:      string,              // optional; return only what changed since that session
  lens?:                  string,              // optional; analyst | dev | pm | designer | stakeholder
  kind_filter?:           string[],            // optional; filter contributions by kind (implementation | research | ...)
  charter_excerpts?:      boolean,             // optional, default false; include excerpts vs paths only
  with_contract_schemas?: boolean              // optional; default false (true when lens=designer or lens=dev). Per ADR-040 contract body inclusion (replacing the former get_contracts tool)
) → ContextResponse
```

`lens` does not filter access -- every project member sees every project-scoped row. It tunes per-section depth defaults. Defaults are read from `.atelier/config.yaml: get_context.lens_defaults`:

```yaml
get_context:
  lens_defaults:
    analyst:
      charter_excerpts: false
      recent_decisions_per_band_limit: 15        # weight recent design context heavily
      contributions_active_limit: 10              # fewer code-kind contributions in active list
      contributions_kind_weights: {research: 3, implementation: 1, design: 1}   // per ADR-033 (decision + proposal removed from kind enum)
      traceability_entries_limit: 60              # broader trace context for cross-cutting research
    dev:
      charter_excerpts: false
      recent_decisions_per_band_limit: 10
      contributions_active_limit: 30              # more in-flight code-kind contributions
      contributions_kind_weights: {implementation: 3, research: 1, design: 1}   // per ADR-033
      traceability_entries_limit: 30
    pm:
      charter_excerpts: true                      # PMs often need full charter context
      recent_decisions_per_band_limit: 10
      contributions_active_limit: 40              # PMs see across territories for capacity tracking
      contributions_kind_weights: {implementation: 1, research: 1, design: 1}   // per ADR-033
      traceability_entries_limit: 80
    designer:
      charter_excerpts: false
      recent_decisions_per_band_limit: 10
      contributions_active_limit: 15
      contributions_kind_weights: {design: 3, research: 1, implementation: 1}   // per ADR-033
      traceability_entries_limit: 30
    stakeholder:
      charter_excerpts: true                      # stakeholders read for context, not action
      recent_decisions_per_band_limit: 10
      contributions_active_limit: 10
      contributions_kind_weights: {design: 1, research: 1, implementation: 1}   // per ADR-033 (stakeholders previously favored decision-kind contributions; with decision routed via log_decision and visible in the recent_decisions section, kind weighting is uniform across remaining disciplines)
      traceability_entries_limit: 50
```

When `lens` is omitted, the response uses unweighted defaults from the same config (under `get_context.section_limits` per section 6.7.2). Per-project teams may override the lens defaults to suit their workflow; the schema above is the bundled-template default.

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
    consumed: [
      {
        name,
        contracts_consumed: [
          {
            name: "<contract_name>",
            version: <integer>,                  // semver-encoded major*1000+minor per ARCH 6.6.1
            schema: <jsonb> | null,              // populated when lens=designer/dev OR with_contract_schemas=true (ADR-040)
            effective_decision: "breaking" | "additive",
            last_published_at: <timestamp>
          },
          ...
        ]
      },
      ...
    ]
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

`territories.owned` and `territories.consumed` are computed from `composers.discipline` (per ADR-038; replaces the prior `composers.default_role` reference) joined against `territories.owner_role` / `territories.contracts_consumed`. Contract bodies under `territories.consumed[].contracts_consumed[].schema` populate by default when `lens` is `designer` or `dev` and on opt-in via the `with_contract_schemas: true` parameter (per ADR-040, which folded the former `get_contracts` tool into this surface). A composer with secondary roles (per `.atelier/config.yaml`) sees the union.

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

This is the explicit "what changed since I was last here" mode — the protocol primitive that retired the pre-M2 `.atelier/checkpoints/SESSION.md` stand-in at M2-mid.

---

### 6.8 Broadcast topology

The broadcast substrate (lit up at M4 per BUILD-SEQUENCE; designed against the `BroadcastService` interface per ADR-029) carries real-time state-change events from the endpoint to interested subscribers. Topology is **per-project channel by default.**

**Channel naming.** Each project gets a dedicated channel: `atelier:project:<project_id>:events`. The channel name is computable from `project_id` so subscribers don't need a separate discovery step.

**Event categories on the project channel.**

| Event | Payload includes | Subscribers typically interested |
|---|---|---|
| `contribution.state_changed` | contribution_id, prior_state, new_state, author_session_id, trace_ids | `/atelier` lenses; territory consumers; publish-delivery (post-M2) |
| `contribution.released` | contribution_id, prior_author_session_id, reason | `/atelier` lenses; admin lens for abandon-pattern observability |
| `decision.created` | decision_id, adr_id, trace_ids, summary (per ARCH 6.3.1 broadcast shape) | `/atelier` decisions panel; M5 find_similar pipeline (cache invalidation); territory consumers via territory contracts |
| `lock.acquired` | lock_id, contribution_id, artifact_scope, holder_session_id, fencing_token | `/atelier` lenses; admin lens for conflict observability |
| `lock.released` | lock_id, contribution_id, prior_holder_session_id, reason (released / reaped) | Same |
| `contract.published` | contract_id, territory_id, name, version, breaking | Consumer territories of that contract; admin lens for cross-territory awareness |
| `session.presence_changed` | session_id, composer_id, status (active / idle / dead) | `/atelier` lenses for composer-presence indicators |

**Why per-project, not per-guild.**

- **Fanout limit.** A single guild channel would mean every composer in every project receives every event. At v1 envelope (100 composers per guild), each event would be delivered 100 times even if 99 of those subscribers don't care. Per-project channel limits delivery to ~20 subscribers per event (composers in the affected project).
- **Subscriber simplicity.** Per-project channels mean clients subscribe to exactly the channels they care about; no client-side filtering. A composer with sessions in projects A and B subscribes to two channels.
- **Provider capacity.** Supabase Realtime supports thousands of channels per cluster; v1 envelope (10 projects per guild, multiple guilds per Supabase project) stays well within capacity. Per-guild would put no pressure on channel count but high pressure on per-channel subscriber count.
- **Authorization fit.** The endpoint authenticates each subscription against the channel's project_id; channel name maps directly to RLS scope.

**Cross-project events: explicit non-feature at v1.** Some hypothetical events (e.g., "composer X joined the guild") would naturally be guild-scoped. v1 does not emit these. If they become needed at v1.x, the channel naming convention extends naturally (`atelier:guild:<guild_id>:events`) without breaking the per-project default.

**Subscriber lifecycle.**

1. Client calls `register` (section 6.1) and receives `session_token`.
2. Client opens a Realtime connection to the configured `BroadcastService` provider.
3. Client subscribes to `atelier:project:<project_id>:events` presenting the bearer JWT.
4. `BroadcastService` validates the JWT against the project_id in the channel name; rejects on mismatch.
5. Events flow until subscription is closed or session is reaped.

**`BroadcastService` interface contract (per ADR-029).**

```
publish(channel: string, event: { kind, payload }) -> Promise<void>
subscribe(channel: string, jwt: string, handler: (event) => void) -> Subscription
unsubscribe(subscription: Subscription) -> Promise<void>
```

Reference impl uses Supabase Realtime; documented migration impl uses Postgres NOTIFY/LISTEN with a thin compatibility shim. Both satisfy the interface; neither leaks past it.

**Ordering guarantees (required of every implementation).** Subscribers must see events in the order the endpoint published them, **per channel**. There is no cross-channel ordering guarantee (events on `atelier:project:A:events` and `atelier:project:B:events` may interleave arbitrarily). Within a channel:

- **FIFO per channel.** A subscriber receives events in the same order the endpoint published them.
- **No deduplication guarantee.** A network retry by the broadcast provider may deliver the same event twice; subscribers must be idempotent (use the event's `id` field, which the endpoint allocates monotonically per project).
- **No exactly-once.** At-least-once delivery within a channel; subscribers tolerate redelivery via the `id`-based dedup above.
- **Connection break behavior.** On reconnect, the subscriber may have missed events; the `degraded=true` flag on the next received event signals "you may want to query canonical state for definitive truth." Per-event sequence numbers (`event.seq`, monotonic per channel) let subscribers detect gaps.

These constraints intentionally fit both Supabase Realtime (which provides per-channel FIFO + at-least-once) and Postgres NOTIFY/LISTEN with a sequence-number wrapper. Implementations that cannot honor per-channel FIFO are not valid `BroadcastService` providers; the ARCH 6.5 `reconcile` script provides the eventual-consistency backstop when broadcast is degraded or unavailable.

**Failure mode: degraded broadcast.** If `BroadcastService` is unreachable, the endpoint continues to write to the datastore (ADR-005: repo-first; broadcast is a downstream concern). Subscribers receive a `degraded=true` flag on next reconnect; the `/atelier` UI renders a banner. State eventually converges via polling fallback (the publish-delivery cutover at M2 already establishes the polling pattern; broadcasts simply augment, not replace, the canonical state).

**Surfaced by:** `scale-ceiling-benchmark-plan.md` section 5.3 architectural analysis; landed in this ARCH as a side-deliverable of the scale-ceiling planning work, ahead of M4 implementation.

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
- Territory-ownership checks gate `propose_contract_change` (per ADR-040, replacing the prior `publish_contract` name).

### 7.3 Credential isolation

- Datastore admin/service-role credentials live server-side only (serverless runtime environment).
- Clients (agent, prototype, CLI) only ever hold per-composer tokens.
- Secret rotation supported via `atelier invite <email> --role <r> --rotate`.

### 7.4 Fencing & concurrency

- Every lock carries a monotonic fencing_token per project.
- Every write to a locked artifact validates the token server-side (the meaning of "validates" depends on surface; see section 7.4.2).
- Stale tokens (from sessions whose locks have been reaped and reassigned) are rejected unconditionally.

#### 7.4.1 Lock granularity, glob semantics, and multi-lock per contribution

**Artifact_scope as glob patterns.** `acquire_lock(contribution_id, artifact_scope)` accepts `artifact_scope` as a string array. Each entry is a glob pattern matched against the territory's `scope_pattern` and against active lock entries for overlap detection. Glob semantics follow the standard `picomatch` / `minimatch` rules:

- `*` matches any character except `/`
- `**` matches any character including `/`
- `?` matches exactly one character except `/`
- `[abc]` character class
- `{a,b}` alternation

Examples valid on the `protocol` territory (which has `scope_pattern: ["prototype/src/lib/protocol/**", "scripts/sync/**"]`):
- `prototype/src/lib/protocol/tools/acquire_lock.ts` -- exact file
- `prototype/src/lib/protocol/tools/*.ts` -- all .ts files at one level
- `prototype/src/lib/protocol/**` -- entire subtree (broad lock, generally avoided)

**Territory-scope check.** Every `artifact_scope` entry must be a subset of (i.e., be matched by) at least one of the territory's `scope_pattern` entries. Entries outside the territory return BAD_REQUEST. This prevents a dev from accidentally locking the analyst's `research/` files via a too-broad glob.

**Multi-lock per contribution.** A single contribution may hold multiple locks acquired across multiple `acquire_lock` calls. Each call returns a new `lock_id` and a new `fencing_token`. This handles the common case where a dev discovers more files needed mid-work without forcing them to release-and-reacquire.

**Overlap detection.** A new lock conflicts with an existing lock if any glob pattern in the new lock's `artifact_scope` matches any glob pattern in the existing lock's `artifact_scope` (computed via union of expanded paths, capped at a configurable expansion limit to prevent pathological globs). On conflict, the response includes `conflicting_lock: { id, holder_session_id, artifact_scope }` so the calling agent can decide to wait, narrow, or escalate.

**Expansion limit.** A glob expands to at most `policy.lock_glob_expansion_limit` paths (default 10000) for overlap-detection purposes. Globs that would expand further return BAD_REQUEST asking the composer to narrow. This prevents `**` against a million-file repo from blocking the project.

**Per-contribution lock release.** When a contribution transitions to `state=merged` (PR merge observed) or `state=open` (release/abandon), all locks held against that `contribution_id` are released atomically.

#### 7.4.1.1 scope_kind affects rendering, not lock mechanics

The territory's `scope_kind` (per ADR-003: files, doc_region, research_artifact, design_component, slice_config) shapes how the prototype web app renders the lock and contribution, not how the lock substrate operates. Lock acquisition, glob matching, overlap detection, and fencing all behave identically across scope_kinds.

| scope_kind | Prototype rendering hint |
|---|---|
| `files` | Path list; file icons; line-count summary |
| `doc_region` | Section headings; prose excerpt |
| `research_artifact` | Artifact title + author + word-count |
| `design_component` | Component name + thumbnail (rendered from the prototype's storybook or equivalent); variant count |
| `slice_config` | Slice name + traceability sub-tree summary |

The mechanical equivalence is intentional: the lock substrate operates on file paths regardless of what those files represent. Specialization happens at the UI layer, not in the protocol.

A territory may include the same path under different scope_kinds in different territories (e.g., `prototype/src/components/**` appears in both `prototype-app` with `scope_kind=files` and `prototype-design` with `scope_kind=design_component`). Both territories may lock the same file -- conflicts surface at lock-overlap time, not at territory-membership time.

#### 7.4.2 Fencing semantics by surface

The phrase "every write to a locked artifact validates the token server-side" in section 7.4 has different operational meanings depending on the composer's surface:

**Remote-surface composers (web, terminal-without-repo).** Writes flow through the per-project endpoint committer (section 7.8). Every commit-producing call (`update(payload=...)`) carries the `fencing_token` in the request. The endpoint validates the token against the active `locks` table before performing the commit. Stale or missing tokens return CONFLICT and no commit happens. This is the strongest enforcement -- the server is in the write path.

**IDE-surface composers.** Writes happen on the composer's local machine; the endpoint never sees individual file edits. Fencing for IDE composers operates as **soft coordination at acquire time, hard validation at PR-open time**:

- *Soft at acquire time.* The lock prevents OTHER composers (any surface) from claiming overlapping artifact_scope. The IDE composer trusts that holding the lock means they're the only one touching those files. There is no protocol-level enforcement preventing the IDE composer from editing files outside their lock; the social contract (and the territory boundary) is the only constraint.
- *Hard at PR-open time.* When the IDE composer transitions to `state=review` (per section 6.2.3, opens a PR), the endpoint inspects the changed-files list of the branch's commits. If the changed files include any path outside the contribution's held locks, the `update(state="review")` returns CONFLICT with the offending paths and the contribution stays in `state=in_progress`. The composer must either acquire additional locks for the missing paths or revert those edits before re-attempting the review transition.
- *Stale-token detection.* If the IDE composer's session was reaped (network drop > `session_ttl_seconds`) and their locks were released and re-acquired by another session before they reconnect, the PR-open check still uses the original lock-holder check; the offending PR-open is rejected. The composer must claim again and re-acquire (which will conflict with the new holder).

This split keeps the IDE workflow ergonomic (no fencing-token plumbing in every local command) while preserving the integrity guarantee at the PR boundary, where work becomes visible to the team.

**Decisions are always endpoint-mediated.** Regardless of surface, `log_decision` always commits through the per-project endpoint committer (per section 6.3.1). Decisions require ADR-NNN allocation and the append-only invariant per ADR-005, both of which require server-side coordination. IDE composers do not commit ADR files locally.

### 7.5 Triage sandboxing

- External comments classified + drafted into contributions with `kind` matching the change's discipline and `requires_owner_approval=true` (per ADR-033; replaces the historical `kind=proposal` mechanism from ADR-018).
- Such contributions cannot transition to `merged` without explicit human approval recorded in datastore (`approved_by_composer_id` populated via `update(owner_approval=true)` per ARCH 6.2.2).
- CI check on repo mirrors this constraint (catches attempts to merge cross-role contribution PRs without an approval record).

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

**Token-usage telemetry (per BRD-OPEN-QUESTIONS section 8 v1 commitment).** For actions that consume LLM tokens against an external model (find_similar embedding generation, transcript classification, triage drafting), the metadata payload includes:

- `model` -- the model identifier (e.g., `text-embedding-3-small`, `gpt-4o-mini`)
- `tokens_input` -- prompt tokens consumed
- `tokens_output` -- completion tokens produced (zero for embedding-only operations)
- `cost_usd` -- best-effort cost estimate computed from a configurable per-model price table (`.atelier/config.yaml: telemetry.model_prices`)
- `attribution` -- one of `composer` (caller-attributable, e.g., interactive find_similar) or `project` (amortized to the project, e.g., webhook-triggered embed pipeline)

Cost is attributed per the find_similar embedding policy (project-amortized for indexing; composer-attributable for interactive queries) so retrospective cost reporting at section 8.2 can break down by composer or by project as needed. Active cost-governance (per-composer budgets, hard limits) is v1.x scope; v1 ships visibility, not enforcement.

### 8.2 Admin observability route

`/atelier/observability` (admin-gated):
- **Sessions** — heartbeat health timeline, reaper activity, surface breakdown
- **Contributions** — state-transition audit log, throughput per territory
- **Locks** — acquisition/release ledger with fencing tokens, conflict rate
- **Decisions** — find_similar match-rate trend, precision/recall history
- **Triage** — classifier confidence distribution, human accept/reject rate
- **Sync** — per-script lag p95, error rate, last successful run
- **Vector index** — row count, index health, query p95
- **Cost** — token-usage and cost-estimate breakdown per composer / per project / per action class, drawn from the token-usage telemetry payload in section 8.1; lookback windows of 24h / 7d / 30d (per BRD-OPEN-QUESTIONS section 8 v1 commitment)

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

**One repo per project at v1** (per BRD-OPEN-QUESTIONS section 9). A project's `repo_url` (per ARCH 5.1 `projects` table) points at exactly one versioned-file-store repository. The traceability registry, the territory `scope_pattern` globs, the per-project endpoint committer (section 7.8), and the round-trip integrity contract (scripts/README.md) all assume one-repo-per-project. Cross-repo projects (e.g., a frontend repo + a backend repo + shared design tokens repo, all owned by one logical "product") are explicit v1.x scope. The v1.x extension hook is sketched as `.atelier/repos.yaml` listing additional repos with repo-qualified scope paths (`repo://name/path`); the schema and migration are not specified at v1 and will be designed when the v1.x epic is written. Teams with cross-repo needs at v1 either pick the primary repo and treat others as external (less integration) or run separate Atelier projects per repo (loses cross-repo coordination).

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
