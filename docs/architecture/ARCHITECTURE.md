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

- Embeddings generated on: new decisions, merged contributions, BRD/PRD section commits, research artifact commits.
- Refresh: real-time on writes; full rebuild available via `atelier eval find_similar --rebuild-index`.
- Model: swappable via config. Default documented in `.atelier/config.yaml`.
- Query: `find_similar` runs cosine similarity; threshold configurable; top-k returned.

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
       (scoped to project_id, optionally to trace_id subtree)
    3. Filter matches above similarity threshold
    4. Enrich with source metadata (decision/contribution/BRD section/research)
    5. Return top-k with scores
  If vector index unavailable:
    Fall back to keyword search; response carries degraded=true
    UI renders explicit banner
```

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
