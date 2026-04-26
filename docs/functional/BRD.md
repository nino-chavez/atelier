# Business Requirements Document: Atelier

**Companion to:** `PRD.md` v1.0
**Status:** Draft v1.0
**Owner:** Nino Chavez
**Last updated:** 2026-04-24
**Scope:** Complete v1 feature set — all 16 epics ship together per `../strategic/NORTH-STAR.md` §17.

---

## 1. Purpose & scope

This document specifies the complete v1 capability set for Atelier as described in `PRD.md`. Expanded into epics with user stories, each tagged with a trace ID. All stories are v1-scope; Atelier explicitly rejects phased rollout per ADR-011 (destination-first design). See `../architecture/decisions/` for the canonical decision log.

---

## 2. Glossary

See `README.md` for the canonical vocabulary table. Additional terms specific to BRD:

| Term | Definition |
|---|---|
| **Scaffold** | The file tree, config, and minimal prototype produced by `atelier init` |
| **Contribution** | The atomic unit of work; subsumes tasks, decisions, proposals, PRs, drafts |
| **Artifact_scope** | The target of a lock or contribution; files, doc regions, research artifacts, or design components |
| **Fencing token** | Monotonic per-project counter attached to every lock; required on every write to locked artifact |
| **Constitution** | Repo-resident governance files read by every agent: `CLAUDE.md`, `AGENTS.md`, `decisions.md`, `.atelier/*` |
| **Lens** | A role-specific first-view cut over shared state in the prototype's `/atelier` route |

---

## 3. Personas

See `PRD.md` §3. Personas referenced throughout: dev principal, analyst principal, PM principal, designer principal, stakeholder.

---

## 4. Story format

```
US-<epic>.<story>  <Title>
As a <persona>
I want <capability>
So that <outcome>

Acceptance:
- Given ... When ... Then ...
- Given ... When ... Then ...

NFR: <non-functional constraints>
Depends on: <trace IDs>
```

All stories v1-scope. No phase tags.

---

## 5. Epic catalog

| Epic | Title | Stories |
|---|---|---|
| 1 | Project scaffolding & lifecycle | US-1.1 to US-1.7 |
| 2 | Agent interop endpoint | US-2.1 to US-2.12 |
| 3 | Canonical artifact (prototype web app) | US-3.1 to US-3.7 |
| 4 | Territory + contribution model | US-4.1 to US-4.6 |
| 5 | Decision durability | US-5.1 to US-5.5 |
| 6 | Fit_check + eval harness | US-6.1 to US-6.6 |
| 7 | Locks + fencing tokens | US-7.1 to US-7.5 |
| 8 | Territory contracts | US-8.1 to US-8.4 |
| 9 | Sync substrate (all 5 scripts) | US-9.1 to US-9.7 |
| 10 | External system integrations | US-10.1 to US-10.6 |
| 11 | CLI tooling | US-11.1 to US-11.9 |
| 12 | Observability | US-12.1 to US-12.5 |
| 13 | Security model | US-13.1 to US-13.6 |
| 14 | Composer lifecycle | US-14.1 to US-14.5 |
| 15 | Role-aware lenses | US-15.1 to US-15.5 |
| 16 | Remote composer support | US-16.1 to US-16.6 |

---

## 6. Epic details

### Epic 1 — Project scaffolding & lifecycle

Goal: `atelier init` produces a fully formed project in one command.

**US-1.1 — Scaffold new project**
As a dev principal, I want `atelier init <name>` to create a complete repo so that I have canonical structure and prototype from the first commit.

Acceptance:
- Given a clean directory, when I run `atelier init foo`, then the directory contains the seven-layer `docs/` tree (per ADR-032) including `docs/strategic/NORTH-STAR.md`, `docs/functional/PRD.md`, `docs/functional/BRD.md`, `docs/architecture/ARCHITECTURE.md`, `docs/architecture/decisions/` (with seed ADRs), `docs/methodology/METHODOLOGY.md`, plus `README.md`, `.atelier/config.yaml`, `.atelier/territories.yaml`, `prototype/`, `scripts/`, `CLAUDE.md`, `AGENTS.md`, `traceability.json`.
- Given the scaffolded project, when I run the prototype locally, then all six routes render with seed content.

**US-1.2 — Provision coordination datastore**
As a dev principal, I want `atelier datastore init` to provision the datastore so that coordination state has somewhere to live.

Acceptance:
- Given a valid datastore credential, when I run `atelier datastore init`, then tables are created, RLS policies applied, indexes built, and the schema migrated to the current version.
- Given an existing datastore, when I re-run the command, then migrations are idempotent.

**US-1.3 — Deploy prototype + endpoint**
As a dev principal, I want `atelier deploy` to ship the prototype and agent endpoint so that composers can start working.

Acceptance:
- Given a deploy target configured, when I run `atelier deploy`, then the prototype web app deploys to static/edge hosting and the agent endpoint deploys to serverless runtime.
- Given a failed deploy, when the command returns, then it reports which component failed and leaves previous version serving.

**US-1.4 — Composer invite**
As a PM principal, I want `atelier invite <email> --role <role>` so that I can add team members to the project with scoped access.

Acceptance:
- Given a valid email and role, when I invite, then a signed token with role claims is generated and delivered.
- Given an invitee, when they accept, then their composer record is created and they appear in `/atelier` sessions list (as inactive until first session).

**US-1.5 — Territory declaration**
As a dev principal, I want `atelier territory add <name>` so that I can declare new territories as the project grows.

Acceptance:
- Given a territory name + owner role + scope_kind + scope_pattern, when I run the command, then `.atelier/territories.yaml` is updated and committed via PR.
- Given a territory with contracts, when added, then contract placeholders are created in the datastore.

**US-1.6 — Project health check**
As a dev principal, I want `atelier doctor` so that I can diagnose project drift.

Acceptance:
- Given a project, when I run doctor, then it reports session health, lock ledger sanity, fit_check precision, sync lag, and any drift between repo and datastore.
- Given detected issues, when doctor runs, then it suggests remediation (e.g., "run `atelier reconcile`").

**US-1.7 — Upgrade scaffold to new Atelier version**
As a dev principal, I want `atelier upgrade` so that existing projects can adopt new template features without re-scaffolding.

Acceptance:
- Given a project on template vN, when I upgrade to vN+1, then migrations run and new files are added without overwriting authored content.
- Given conflicting edits, when upgrade runs, then conflicts are reported for manual resolution.

---

### Epic 2 — Agent interop endpoint

Goal: 12 tools, all present at v1, accessible via the chosen agent interop protocol.

**US-2.1 — Register session**
As a dev principal (via agent), I want to register a session so that my agent is known to the project.

Acceptance:
- Given a valid composer token + locus, when `register` is called, then a session row is inserted with heartbeat timestamp and an endpoint-scoped session token is returned.

**US-2.2 — Heartbeat**
As any composer (via agent), I want `heartbeat` so that my session stays live.

Acceptance:
- Given an active session, when heartbeat is called within TTL, then heartbeat timestamp updates.
- Given heartbeat stops, when TTL expires, then reaper marks session dead and releases held resources.

**US-2.3 — Deregister session**
As any composer (via agent), I want `deregister` so that I can cleanly end a session.

Acceptance:
- Given an active session, when deregister is called, then all held locks are released, all claimed in-progress contributions are released, and the session row is deleted.

**US-2.4 — Get context**
As any composer (via agent), I want `get_context` so that my agent knows the current state of the project.

Acceptance:
- Given a session, when get_context is called, then the response contains constitution files, last N decisions, territory state, contribution summary for active territory, and traceability registry slice.
- Given a trace_id parameter, when get_context is called, then the response is filtered to that trace ID's scope.

**US-2.5 — Fit_check**
As any composer (via agent), I want `fit_check` so that I can detect duplication before starting work.

Acceptance:
- Given a description string + optional trace_id, when fit_check is called, then matches above similarity threshold are returned with sources (decisions, contributions, BRD/PRD sections, research artifacts) and similarity scores.
- Given the vector index is unavailable, when fit_check is called, then keyword search runs and the response includes a `degraded: true` flag.

**US-2.6 — Claim contribution**
As any composer (via agent), I want to claim an open contribution so that other composers see it's taken.

Acceptance:
- Given an open contribution in my territory, when I claim, then contribution state transitions to `claimed` with my session_id.
- Given an already-claimed contribution, when I claim, then the call fails with conflict details.

**US-2.7 — Update contribution**
As any composer (via agent), I want to transition contribution state so that progress is visible.

Acceptance:
- Given a contribution I own, when I update with a valid state transition, then the new state is persisted and broadcast.
- Given an invalid transition (e.g., `open` → `merged`), when I update, then the call fails with the allowed-transitions list.

**US-2.8 — Release contribution**
As any composer (via agent), I want to release a claimed contribution so that others can pick it up.

Acceptance:
- Given a contribution I own in a non-terminal state, when I release, then contribution returns to `open`, my session_id clears, and any held locks for the contribution's artifact_scope release.

**US-2.9 — Acquire lock**
As any composer (via agent), I want `acquire_lock` with fencing token so that my writes are safe against GC pauses and stale sessions.

Acceptance:
- Given an artifact_scope with no conflicting locks, when I acquire, then a lock record is created with a monotonic fencing token and the token is returned.
- Given a conflicting lock, when I acquire, then the call fails with the holder's session_id and expiry.

**US-2.10 — Release lock**
As any composer (via agent), I want `release_lock` so that others can acquire the artifact.

Acceptance:
- Given a lock I hold, when I release, then the lock record is deleted and the fencing token is invalidated for future writes.

**US-2.11 — Log decision**
As any composer (via agent), I want `log_decision` so that architectural/strategic choices are preserved.

Acceptance:
- Given a decision (category, summary, rationale, trace_id), when log_decision is called, then a new ADR file is created at `../architecture/decisions/ADR-NNN-<slug>.md` (per ADR-005, ADR-030), mirrored to the datastore, indexed in the vector index, and broadcast via pub/sub — all within the same call.
- Given the datastore is unavailable, when log_decision is called, then the repo write still succeeds; the mirror is retried on the next healthy call.

**US-2.12 — Publish + get contracts**
As a dev principal (via agent), I want `publish_contract` and `get_contracts` so that territories have typed interfaces.

Acceptance:
- Given a territory owner + contract name + schema, when publish is called, then the contract is stored and subscribers are notified.
- Given a territory consumer, when get_contracts is called, then current contracts for subscribed territories are returned.

---

### Epic 3 — Canonical artifact (prototype web app)

Goal: Six routes, role-aware lenses, live state. The prototype is both product and dashboard.

**US-3.1 — Project home route**
As any composer, I want `/` to show the project at a glance so that I can orient myself in 10 seconds.

Acceptance:
- Given an active project, when I visit `/`, then I see: slice index, demo reel, project status summary, recent activity feed.
- Given role claims in my token, when I visit `/`, then quick-links prioritize my role's lens.

**US-3.2 — Strategy route**
As any composer, I want `/strategy` to render the canonical BRD/PRD so that I can read the strategic context without leaving the prototype.

Acceptance:
- Given BRD and PRD in the repo, when I visit `/strategy`, then both are rendered with trace-ID links.
- Given a trace ID anchor, when I click, then I'm scrolled to the relevant section and the traceability panel highlights the link.

**US-3.3 — Design route**
As a designer principal, I want `/design` to show components, flows, and linked design-tool frames so that I have one view of all design state.

Acceptance:
- Given component definitions in the repo, when I visit `/design`, then components render with scope-lock indicators and pending-review flags.
- Given linked external design frames, when I visit `/design`, then frame previews are embedded with back-links to the external tool.

**US-3.4 — Slice detail route**
As any composer, I want `/slices/[id]` to show one slice's three panels plus its atelier mini-panel so that I can see everything about a slice in one place.

Acceptance:
- Given a slice ID, when I visit `/slices/[id]`, then strategy/design/current-state panels render plus a `/atelier` mini-panel filtered to that slice's trace ID.

**US-3.5 — Atelier coordination route**
As any composer, I want `/atelier` to show live coordination state so that I know what's happening right now.

Acceptance:
- Given active sessions, contributions, decisions, locks, when I visit `/atelier`, then all four render live via pub/sub.
- Given my role claims, when I visit `/atelier`, then the default lens matches my role; I can switch lenses via a selector.

**US-3.6 — Traceability route**
As any composer, I want `/traceability` to show the bidirectional link registry so that I can navigate between docs, slices, decisions, and stories.

Acceptance:
- Given the registry, when I visit `/traceability`, then I see a searchable, filterable view of all trace IDs with their links.
- Given a trace ID, when I click, then I can navigate to any linked surface in one click.

**US-3.7 — Scale budget enforcement**
As any composer, I want list views to paginate and virtualize predictably so that performance doesn't collapse at 10× data.

Acceptance:
- Given a list of N contributions, when N > 50, then pagination kicks in server-side.
- Given N > 500, when rendered, then list virtualization is active.
- Given filter/sort controls, when I apply them, then the query runs server-side and only rendered rows transfer.

---

### Epic 4 — Territory + contribution model

**US-4.1 — Declare territory**
As a dev principal, I want to declare a territory so that scope and ownership are explicit.

Acceptance:
- Given `.atelier/territories.yaml` entry with name, owner_role, scope_kind, scope_pattern, contracts_published, contracts_consumed, when committed, then the territory is available for contribution claiming and lock acquisition.

**US-4.2 — Contribution schema**
As any composer, I want contributions to subsume tasks/decisions/proposals/PRs in one schema so that coordination primitives apply uniformly.

Acceptance:
- Given a contribution record, then it has: id, project_id, author_session_id, trace_id, territory, artifact_scope, state (one of 7), kind (one of 5), content_ref, fencing_token, created_at, updated_at.

**US-4.3 — Contribution state machine**
As any composer, I want valid state transitions so that lifecycle rules are enforced.

Acceptance:
- Given a contribution, valid transitions are: open ↔ claimed, claimed → in_progress, in_progress → review, review → merged or rejected or in_progress, any → blocked, blocked → open.
- Given an invalid transition, when attempted, then the call fails with allowed-transitions.

**US-4.4 — Artifact_scope kinds**
As a composer, I want scope_kind to cover files, doc_region, research_artifact, design_component, slice_config so that non-code work is first-class.

Acceptance:
- Given a territory with scope_kind=doc_region, when a contribution is created, then artifact_scope accepts markdown-section anchors (e.g., `BRD.md#section-3`).
- Given scope_kind=research_artifact, when a contribution is created, then artifact_scope accepts paths under `research/`.

**US-4.5 — Cross-territory contribution**
As any composer, I want to propose a contribution in a territory I don't own so that cross-territory work is possible via proposals.

Acceptance:
- Given a composer outside the owning role, when they create a contribution in another territory, then it's created with kind=proposal and requires owner approval to transition past `review`.

**US-4.6 — Contribution filtering**
As any composer, I want to filter contributions by territory/state/kind/assignee so that I can focus.

Acceptance:
- Given query params, when the dashboard queries the datastore, then server-side filtering returns only matching rows.

---

### Epic 5 — Decision durability

**US-5.1 — Log decision end-to-end**
As any composer (via agent), I want `log_decision` to write repo-first then mirror so that decisions survive datastore outage.

Acceptance:
- Given a decision payload, when logged, then a new file is created at `../architecture/decisions/ADR-NNN-<slug>.md` (per ADR-005, ADR-030) with YAML frontmatter (id, trace_ids, category, session, composer, timestamp, optional reverses) and a body containing summary, rationale, and consequences; the directory README index is updated; the datastore mirror is updated; the vector index is refreshed; pub/sub broadcasts.

**US-5.2 — Per-ADR file structure**
As a dev principal, I want every ADR file to follow a deterministic format so that parsing, CI checks, and the index regeneration are reliable.

Acceptance:
- Given an ADR file, then it starts with `---` frontmatter (YAML), followed by `---`, then `# Title`, then `**Summary.**`, `**Rationale.**`, `**Consequences.**`, optional `**Re-evaluation triggers.**` sections.
- Given monotonic ADR numbering, then `NNN` increments without gaps and never duplicates.

**US-5.3 — Repo-datastore sync CI check**
As a dev principal, I want a CI check that validates every datastore decision has a corresponding repo file and vice versa so that drift is caught before merge.

Acceptance:
- Given a PR that touches `../architecture/decisions/`, when CI runs, then a script compares datastore decision IDs to repo file IDs (parsed from frontmatter) and fails the check on mismatch.

**US-5.4 — Decision append-only**
As any composer, I want decisions to be append-only so that history is auditable.

Acceptance:
- Given a datastore UPDATE attempt on decisions, when executed, then the database rejects it (RLS / triggers).
- Given a git edit that modifies a prior ADR file, when committed, then CI flags the edit as a reversal-required pattern. New ADRs are new files; existing files are never edited.

**US-5.5 — Decision reversal**
As any composer, I want to reverse a prior decision via a new decision referencing the old so that reversals are explicit.

Acceptance:
- Given an ADR with id ADR-NNN, when I log a reversal, then the new ADR file has `reverses: ADR-NNN` in frontmatter and the directory README index marks the old ADR as superseded with a link to the reversal.

---

### Epic 6 — Fit_check + eval harness

**US-6.1 — Semantic search implementation**
As any composer (via agent), I want fit_check to use vector search so that semantic duplicates are caught, not just keyword matches.

Acceptance:
- Given a description string, when fit_check is called, then embeddings are generated, a nearest-neighbor search runs against the vector index, and matches above threshold are returned with similarity scores.

**US-6.2 — Eval set ships with template**
As a dev principal, I want `atelier/eval/fit_check/*.yaml` seeded at init so that precision can be measured from day one.

Acceptance:
- Given `atelier init`, then `atelier/eval/fit_check/` contains seed positive pairs, seed negative pairs, and adversarial cases.

**US-6.3 — Eval runner CLI**
As a dev principal, I want `atelier eval fit_check` to report precision/recall so that I can verify the disconfirming test.

Acceptance:
- Given the eval set, when I run the command, then precision, recall, F1, and per-case verdicts are printed and written to `eval-results/fit_check-<timestamp>.json`.

**US-6.4 — CI gate**
As a dev principal, I want CI to fail PRs that drop fit_check precision below 75% at recall 60% so that the disconfirming test is enforced.

Acceptance:
- Given a PR that touches fit_check logic or eval set, when CI runs, then `atelier eval fit_check` runs and fails the check if thresholds are not met.

**US-6.5 — Keyword fallback with banner**
As any composer, I want fit_check to degrade to keyword search when embeddings are unavailable and surface this in UI so that I don't get silent weak matches.

Acceptance:
- Given the vector index is unavailable, when fit_check is called, then keyword search runs and responses carry `degraded: true`.
- Given `degraded: true`, when UI renders matches, then an explicit banner states "keyword fallback — semantic search unavailable."

**US-6.6 — Accept/reject feedback loop**
As any composer, I want to accept or reject fit_check matches so that the eval set improves over time.

Acceptance:
- Given a fit_check response in UI, when I accept or reject a match, then the decision is recorded and periodically rolled into the eval set (human-reviewed).

---

### Epic 7 — Locks + fencing tokens

**US-7.1 — Acquire lock with fencing**
As any composer (via agent), I want every lock to include a monotonic fencing token so that stale-session writes are rejected.

Acceptance:
- Given a lock acquisition, when successful, then the returned record includes a fencing_token (per-project monotonic counter).
- Given the token, when included on a write, then the server validates it against the current lock's token.

**US-7.2 — Reject stale-token writes**
As a security principle, I want writes with stale fencing tokens to be rejected so that GC pauses don't cause silent data loss.

Acceptance:
- Given a lock held by session A with token T1, when session B acquires the same scope with token T2 after A's TTL expiry, then any write from A with token T1 is rejected server-side.

**US-7.3 — Lock TTL + heartbeat extension**
As any composer, I want locks to have TTL and extend via heartbeat so that crashed sessions don't orphan locks.

Acceptance:
- Given a lock with TTL 2h, when heartbeat fires within TTL, then TTL resets.
- Given no heartbeat, when TTL expires, then reaper releases the lock.

**US-7.4 — Lock conflict reporting**
As any composer, I want failed acquisitions to report the holder + expiry so that I can decide whether to wait or pick different work.

Acceptance:
- Given a conflict, when acquire fails, then the response includes holder session_id, locked_at, expires_at, and the artifact_scope overlap details.

**US-7.5 — Lock ledger audit**
As an admin, I want a lock ledger with acquisition + fencing-token history so that lock-based incidents are diagnosable.

Acceptance:
- Given a project, when I query the ledger, then I see every acquisition/release event with session, scope, token, timestamp.

---

### Epic 8 — Territory contracts

**US-8.1 — Publish contract**
As a dev principal, I want `publish_contract` so that my territory's interface is queryable.

Acceptance:
- Given a territory I own, when I publish a contract (name + schema), then it's stored in the datastore and broadcast.

**US-8.2 — Consume contracts**
As any composer (via agent), I want `get_contracts` filtered by consumed-list so that I can query only relevant contracts.

Acceptance:
- Given my territory's contracts_consumed list, when I call get_contracts, then only those contracts are returned with current schema + version.

**US-8.3 — Contract-change notification**
As a downstream consumer, I want pub/sub broadcasts on contract changes so that I see breaking changes immediately.

Acceptance:
- Given a contract change in an upstream territory, when broadcast, then all consuming sessions receive the event in real time.

**US-8.4 — Breaking-change proposal flow**
As a dev principal, I want breaking contract changes to route through a proposal flow so that consumers have a chance to respond.

Acceptance:
- Given a contract change classified as breaking (heuristics: removed fields, narrowed types), when I publish, then the publish is staged as a proposal and consumers receive an approval request; after a configurable window with no objections, the proposal promotes.

---

### Epic 9 — Sync substrate (all 5 scripts)

**US-9.1 — publish-docs**
As a PM principal, I want BRD/PRD commits to publish to the published-doc system so that stakeholders see the canonical content.

Acceptance:
- Given a commit touching BRD.md or PRD.md, when CI runs, then `publish-docs` fires and overwrites the target pages with a banner stating "edits here will be overwritten; comment to propose changes."

**US-9.2 — publish-delivery**
As a PM principal, I want contribution state transitions to sync to the delivery tracker so that delivery teams see canonical progress.

Acceptance:
- Given a contribution transitioning to `claimed` or later, when the transition fires, then `publish-delivery` creates or updates the corresponding delivery-tracker issue with current status, assignee, sprint.

**US-9.3 — mirror-delivery**
As a PM principal, I want delivery-tracker-authoritative fields mirrored nightly so that reports don't depend on the delivery-tracker API.

Acceptance:
- Given a nightly cron, when it runs, then all delivery-authoritative fields for all contributions are pulled into the registry and queryable locally.

**US-9.4 — reconcile**
As a dev principal, I want a drift-detection script that never auto-writes so that I can see disagreements between repo and external systems.

Acceptance:
- Given a project, when `reconcile` runs, then a report lists every divergence (repo says X, external says Y) with recommended resolution; the script never writes to either side.

**US-9.5 — triage classifier**
As a dev principal, I want external comments to be classified so that proposals are categorized before drafting.

Acceptance:
- Given a webhook from published-doc or delivery-tracker comment, when received, then the classifier assigns category (scope, typo, question, pushback, off-topic) and confidence score.

**US-9.6 — triage drafter**
As a dev principal, I want classified comments to be drafted into proposal contributions so that accept/reject is one human action.

Acceptance:
- Given a classified comment with sufficient confidence, when drafted, then a `kind:proposal` contribution is created citing the source with the drafted change as content.

**US-9.7 — triage never auto-merges**
As a safety principle, I want triage drafts to require human merge so that unsanitized external content never lands in canonical state.

Acceptance:
- Given a drafted proposal, when merge is attempted without human approval, then the datastore and CI both reject.

---

### Epic 10 — External system integrations

**US-10.1 — Versioned file store integration**
As a project, I want to work with any git-provider with OAuth + webhooks so that teams aren't locked into one provider.

Acceptance:
- Given a supported provider (GitHub, GitLab, Bitbucket), when configured, then triage webhooks fire and publish-delivery can reference issue URLs.

**US-10.2 — Delivery tracker adapter interface**
As a dev principal, I want a pluggable adapter interface so that new delivery trackers can be added without rewriting sync.

Acceptance:
- Given a new delivery-tracker adapter implementing the interface (create_issue, update_issue, list_issues, list_comments), when configured, then publish-delivery and mirror-delivery work without changes.

**US-10.3 — Jira / Linear adapters shipped**
As a v1 deliverable, I want Jira and Linear adapters so that the two largest delivery trackers are supported out-of-box.

Acceptance:
- Given valid credentials, when configured for Jira or Linear, then publish-delivery/mirror-delivery/triage all work end-to-end.

**US-10.4 — Published-doc system adapters**
As a v1 deliverable, I want Confluence and Notion adapters so that published-doc integration works with either.

Acceptance:
- Given valid credentials, when configured, then publish-docs writes pages with banners; webhook-triage reads comments.

**US-10.5 — Design tool adapter**
As a v1 deliverable, I want a Figma adapter so that design feedback is triaged.

Acceptance:
- Given Figma configured, when a comment is posted on a frame with a trace ID, then triage picks it up and drafts a proposal.

**US-10.6 — Messaging adapter**
As a PM principal, I want notifications to route to Slack/Teams so that the team sees significant events without checking the prototype.

Acceptance:
- Given configured webhook, when a contribution transitions, a decision logs, or fit_check flags a high-confidence match, then a message is sent to the configured channel.

---

### Epic 11 — CLI tooling

See `PRD.md` §4.11 for the full surface. All 9 commands ship at v1:
`atelier init`, `datastore init`, `deploy`, `invite`, `territory add`, `sync <target>`, `reconcile`, `eval fit_check`, `doctor`.

US-11.1 through US-11.9 map 1:1 to the commands. Acceptance: each command has `--help`, documented exit codes, and a corresponding end-to-end test.

---

### Epic 12 — Observability

**US-12.1 — Telemetry emission**
As a platform, I want every endpoint call + state transition + lock event to emit telemetry so that diagnosis is possible.

Acceptance:
- Given any endpoint call, when it completes (success or failure), then an event is written to the observability sink with session, action, outcome, duration.

**US-12.2 — Admin observability sub-route**
As an admin composer, I want `/atelier/observability` so that I can see system health.

Acceptance:
- Given admin role, when I visit the route, then I see sections for sessions, contributions, locks, decisions, fit_check match rate, triage accuracy, sync lag, vector-index health.

**US-12.3 — Session heartbeat dashboard**
As an admin, I want to see heartbeat status per session so that reaper activity is visible.

Acceptance:
- Given active and recently-reaped sessions, when I view, then each shows heartbeat interval health, last seen, and reaper actions taken.

**US-12.4 — Fit_check match-rate report**
As a dev principal, I want to see fit_check match rates over time so that precision regressions are visible.

Acceptance:
- Given historical eval runs, when I view, then a trend chart shows precision/recall per run with markers on threshold breaches.

**US-12.5 — Sync lag alerting**
As an admin, I want alerts when sync lag exceeds thresholds so that drift is caught.

Acceptance:
- Given sync lag p95 > 60s (publish) or > 24h (mirror), when observed, then the messaging adapter fires an alert.

---

### Epic 13 — Security model

**US-13.1 — Per-composer signed tokens**
As a security principle, I want each composer to have a unique signed token so that impersonation is prevented.

Acceptance:
- Given invite acceptance, when a composer is activated, then a unique token is issued with role claims and project scope.

**US-13.2 — Row-level authorization**
As a security principle, I want every datastore write scoped to session ownership so that cross-composer tampering is prevented.

Acceptance:
- Given a session token, when a write to another composer's contribution is attempted, then RLS rejects it.

**US-13.3 — Append-only decisions**
As a security principle, I want decisions append-only at the datastore level so that audit integrity is guaranteed.

Acceptance:
- Given an UPDATE or DELETE on decisions, when attempted, then the datastore rejects it via policy or trigger.

**US-13.4 — Service-role isolation**
As a security principle, I want the datastore service-role credential to never reach clients so that RLS isn't bypassable from the browser.

Acceptance:
- Given the serverless runtime, when it reads the service-role credential, then it's only from environment variables set server-side.

**US-13.5 — Triage sandbox**
As a security principle, I want triage-drafted proposals to never auto-merge so that external content doesn't land unsanitized.

Acceptance:
- Given a proposal with kind=proposal from triage, when merge is attempted without explicit human approval recorded in the datastore, then merge is blocked.

**US-13.6 — Token rotation**
As an admin, I want to rotate a composer's token so that lost devices don't become ongoing risks.

Acceptance:
- Given an admin action, when a token is rotated, then the old token is invalidated immediately and the new token is issued via the invite mechanism.

---

### Epic 14 — Composer lifecycle

**US-14.1 — Invite flow**
See US-1.4.

**US-14.2 — Session registration**
See US-2.1.

**US-14.3 — Heartbeat**
See US-2.2.

**US-14.4 — Deregister**
See US-2.3.

**US-14.5 — Reaper**
As a platform, I want stale sessions to be reaped automatically so that crashed composers don't hold resources forever.

Acceptance:
- Given heartbeat timeout, when reaper runs, then session is marked dead, held locks released, claimed contributions released.

---

### Epic 15 — Role-aware lenses

**US-15.1 — Analyst lens**
Shows strategy contributions, research artifacts, proposals needing review, decisions affecting strategy.

**US-15.2 — Dev lens**
Shows contributions in territory, active locks, recent impl decisions, contract changes from other territories.

**US-15.3 — PM lens**
Shows phase progress, priority flow, story states, delivery mirror.

**US-15.4 — Designer lens**
Shows design components in review, visual contracts, feedback queue from design tool.

**US-15.5 — Stakeholder lens**
Shows read-only public decisions + demo reel.

All five lenses query the same canonical state; differ in default filter presets, sort orders, and which panels expand by default.

---

### Epic 16 — Remote composer support

**US-16.1 — Remote protocol transport**
As an analyst principal, I want my web agent to connect to the project endpoint via remote protocol so that I can participate from a browser.

Acceptance:
- Given a browser-based agent client with remote-protocol support (e.g., claude.ai with MCP connectors), when configured with my composer token + project endpoint URL, then I can call all 12 endpoint tools.

**US-16.2 — Non-code territory: doc_region**
As an analyst principal, I want to claim contributions scoped to doc_region so that I can work on BRD sections without conflicting with other analysts.

Acceptance:
- Given a territory with scope_kind=doc_region and scope_pattern including `BRD.md#*`, when I claim a contribution targeting `BRD.md#personas`, then a lock is acquired on that markdown region.

**US-16.3 — Non-code territory: research_artifact**
As an analyst principal, I want to author research artifacts via my web agent so that agent-session outputs land durably in the repo.

Acceptance:
- Given a claimed contribution with kind=research and scope_kind=research_artifact, when I author content via my agent, then the content is written to `research/<trace-id>-<slug>.md` and committed on `release`.

**US-16.4 — Knowledge-work artifact durability**
As an analyst principal, I want my agent-session transcript preserved alongside the distilled artifact so that full reasoning trail is recoverable.

Acceptance:
- Given a research contribution, when completed, then the transcript is stored as a sidecar file (`research/<trace-id>-<slug>.transcript.json`) and linked from the research artifact frontmatter.

**US-16.5 — Web-composer auth UX**
As an analyst principal, I want OAuth/SSO sign-in to the prototype so that I don't manually handle tokens.

Acceptance:
- Given identity service configured with OAuth, when I sign in, then a composer token is issued and stored securely in the browser session.

**US-16.6 — Cross-locus visibility**
As any composer, I want to see sessions from all loci in `/atelier` so that I know who's active regardless of their tool.

Acceptance:
- Given sessions from ide, web, and terminal loci, when I view `/atelier` sessions list, then all three kinds render with locus icon + last heartbeat.

---

## 7. Non-functional requirements

| NFR | Target | Stories impacted |
|---|---|---|
| **Fit_check precision** | ≥75% at ≥60% recall on eval set | Epic 6 |
| **Agent endpoint p95** | < 500ms for read tools, < 1s for write tools | Epic 2 |
| **Pub/sub delivery p95** | < 2s end-to-end | Epic 2, Epic 3 |
| **Publish-sync p95** | < 60s after commit | Epic 9 |
| **Mirror-sync SLA** | < 24h staleness | Epic 9 |
| **Prototype TTI** | < 2s on typical project state | Epic 3 |
| **Scale budget** | Paginate at 50, virtualize at 500 | Epic 3 |
| **Lock conflict rate** | < 2% of acquisition attempts in typical multi-composer work | Epic 7 |
| **Session reaper rate** | < 5% (indicates healthy crash recovery, not overload) | Epic 14 |
| **Graceful degradation** | Every capability has a documented fallback when a dependency is unavailable | Epic 2, Epic 5, Epic 6 |

---

## 8. Open questions

See `BRD-OPEN-QUESTIONS.md` for detail. Highlights:

1. Territory-model validation on the analyst case.
2. Switchman dependency vs. own-implementation for file locks.
3. Embedding-model default + swappability for fit_check.
4. Contract-breaking-change heuristics (what counts as breaking).
5. Identity-service default (self-hosted OIDC, external provider, or bring-your-own).
6. Upgrade-path semantics when a project on template vN is migrated to vN+1.
