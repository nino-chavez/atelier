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
| **Charter** | Repo-resident governance files read by every agent: `CLAUDE.md`, `AGENTS.md`, `decisions.md`, `.atelier/*` |
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
| 6 | Find_similar + eval harness | US-6.1 to US-6.6 |
| 7 | Locks + fencing tokens | US-7.1 to US-7.5 |
| 8 | Territory contracts | US-8.1 to US-8.4 |
| 9 | Sync substrate (all 5 scripts) | US-9.1 to US-9.7 |
| 10 | External system integrations | US-10.1 to US-10.6 |
| 11 | CLI tooling | US-11.1 to US-11.13 |
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
- Given a project, when I run doctor, then it reports session health, lock ledger sanity, find_similar precision, sync lag, and any drift between repo and datastore.
- Given detected issues, when doctor runs, then it suggests remediation (e.g., "run `atelier reconcile`").

**US-1.7 — Upgrade scaffold to new Atelier version**
As a dev principal, I want `atelier upgrade` so that existing projects can adopt new template features without re-scaffolding.

Acceptance:
- Given a project on template vN, when I upgrade to vN+1, then migrations run and new files are added without overwriting authored content.

**US-1.8 — Guided handshake for credentials AI cannot self-provision**
As an agent or human running `atelier init`, I want a guided handshake protocol so that credentials requiring browser-based human action (Supabase OAuth consent, GitHub App authorization, Vercel project linking, identity-provider client registration) are obtained without breaking the implementer's flow.

Surfaced by the 2026-04-28 AI-speed red-team pivot: AI implementation collapses most of the setup timeline, but third-party UI-only security flows remain a hard handover boundary. Without a structured handshake, agents either stall waiting for credentials or write brittle "TODO: paste token here" comments.

Acceptance:
- Given `atelier init` running in interactive mode, when a credential cannot be obtained programmatically, then the CLI prints a structured prompt: the exact URL the human should visit, the action they should take (e.g., "create a service role token with these scopes"), and a clear paste-back affordance with format validation.
- Given a non-interactive mode (`--non-interactive`, e.g., when invoked by an agent that lacks human channel), when a credential is missing, then the CLI exits with code 78 (EX_CONFIG) and writes a structured `init.handshake.json` listing each missing credential with the same prompt metadata, so the agent can route the request through its own human-handover channel.
- Given a partial setup state (some credentials provided, others missing), when re-run, then the handshake resumes from the first missing item rather than re-prompting for completed steps; state persists in `.atelier/.init-state.json` (gitignored).
- Given a successful handshake, when complete, then `.atelier/config.yaml` is populated with the resolved credentials' references (typically env-var names or secret-manager paths, never literal secrets), and the next CLI command (`atelier datastore init`) can run without re-prompting.

NFR: the structured prompt format is itself a contract -- documented under `docs/architecture/protocol/init-handshake.md` so alternative-stack implementations can honor the same prompt shape.
- Given conflicting edits, when upgrade runs, then conflicts are reported for manual resolution.

---

### Epic 2 — Agent interop endpoint

Goal: 12 tools, all present at v1, accessible via the chosen agent interop protocol.

**US-2.1 — Register session**
As a dev principal (via agent), I want to register a session so that my agent is known to the project.

Acceptance:
- Given a valid composer token + surface, when `register` is called, then a session row is inserted with heartbeat timestamp and an endpoint-scoped session token is returned.

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
- Given a session, when get_context is called, then the response contains charter files, last N decisions, territory state, contribution summary for active territory, and traceability registry slice.
- Given a trace_id parameter, when get_context is called, then the response is filtered to that trace ID's scope.
- Given a `scope_files` parameter (per ADR-045), when get_context is called, then the response carries an `overlapping_active` section listing active contributions and held locks whose `artifact_scope` intersects the supplied file scope. Empty arrays (not absent) when no overlaps exist; section absent when `scope_files` is omitted. This is the canonical pre-claim file-overlap awareness surface — composers query before committing to a `claim` whose intended files might collide with active work.

**US-2.5 — Find_similar (advisory search aid; per ADR-006 + ADR-042 + ADR-043)**
As any composer (via agent), I want `find_similar` so that I can search for prior semantically-related work across decisions, contributions, BRD/PRD sections, and research artifacts.

Acceptance:
- Given a description string + optional trace_id, when find_similar is called, then matches above similarity threshold are returned with sources (decisions, contributions, BRD/PRD sections, research artifacts) and similarity scores.
- Given the vector index is unavailable or the embeddings adapter is misconfigured, when find_similar is called, then keyword search runs and the response includes a `degraded: true` flag (per US-6.5).
- The advisory tier (P >= 0.60 AND R >= 0.60 per ADR-043) is the v1 default. Warnings surface in claim flows, PR comments, and `/atelier` panels but do not block. The blocking tier (P >= 0.85, R >= 0.70) is v1.x opt-in gated on the cross-encoder reranker per BRD-OPEN-QUESTIONS section 27.

Note: pre-claim file-overlap awareness (the question "is anyone touching these specific files right now?") is `get_context`'s job per US-2.4 + ADR-045, not find_similar's. The two capabilities answer different questions and ship as siblings, not alternatives.

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

**US-2.12 — Propose contract change + read contracts**
As a dev principal (via agent), I want `propose_contract_change` and contract reads via `get_context` so that territories have typed interfaces. Per ADR-040 (12-tool surface consolidation): `propose_contract_change` is the publish path (the endpoint decides additive-publish vs proposal-creation via the ARCH 6.6.1 classifier); contract reads collapse onto `get_context`.

Acceptance:
- Given a territory owner + contract name + schema, when `propose_contract_change` is called, then the endpoint runs the classifier; on additive (or override-additive) it stores the contract and notifies subscribers; on breaking it creates a contribution with `requires_owner_approval=true` for cross-territory approval per ARCH 6.6.
- Given a territory consumer with active session, when `get_context` is called with `with_contract_schemas: true` (or under `lens=designer`/`dev`), then current contracts for subscribed territories are returned with full schemas under `territories.consumed[].contracts_consumed[]`.

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
- Given a contribution record, then it has: id, project_id, author_composer_id (per ADR-036), author_session_id (operational, may dangle on session reap), trace_ids, territory_id, artifact_scope, state (one of 6 per ADR-034), kind (one of 3 per ADR-033), requires_owner_approval, blocked_by, blocked_reason, content_ref, transcript_ref, fencing_token, repo_branch, commit_count, last_observed_commit_sha, created_at, updated_at.

**US-4.3 — Contribution state machine**
As any composer, I want valid state transitions so that lifecycle rules are enforced.

Acceptance:
- Given a contribution, valid transitions are: open <-> claimed, claimed -> in_progress, in_progress -> review, review -> merged or rejected or in_progress.
- Given any active state (claimed, in_progress, review), `blocked_by` may be set to a non-null contribution_id (per ADR-034); the lifecycle position is preserved -- blocked is a status flag, not a state.
- Given a blocked contribution, clearing `blocked_by` to null returns it to active work in the same lifecycle position it paused at.
- Given an invalid transition, when attempted, then the call fails with allowed-transitions.

**US-4.4 — Artifact_scope kinds**
As a composer, I want scope_kind to cover files, doc_region, research_artifact, design_component, slice_config so that non-code work is first-class.

Acceptance:
- Given a territory with scope_kind=doc_region, when a contribution is created, then artifact_scope accepts markdown-section anchors (e.g., `BRD.md#section-3`).
- Given scope_kind=research_artifact, when a contribution is created, then artifact_scope accepts paths under `research/`.

**US-4.5 — Cross-territory contribution**
As any composer, I want to propose a contribution in a territory I don't own so that cross-territory work is possible via proposals.

Acceptance:
- Given a composer outside the owning role (with `territories.allow_cross_role_authoring=true`), when they create a contribution in another territory, then it's created with `requires_owner_approval=true` per ADR-033 and cannot transition to `merged` without explicit owner approval recorded per ARCH 7.5.

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

### Epic 6 — Find_similar + eval harness

**US-6.1 — Semantic search implementation**
As any composer (via agent), I want find_similar to use vector search so that semantic duplicates are caught, not just keyword matches.

Acceptance:
- Given a description string, when find_similar is called, then embeddings are generated, a nearest-neighbor search runs against the vector index, and matches above threshold are returned with similarity scores.

**US-6.2 — Eval set ships with template**
As a dev principal, I want `atelier/eval/find_similar/*.yaml` seeded at init so that precision can be measured from day one.

Acceptance:
- Given `atelier init`, then `atelier/eval/find_similar/` contains seed positive pairs, seed negative pairs, and adversarial cases.

**US-6.3 — Eval runner CLI**
As a dev principal, I want `atelier eval find_similar` to report precision/recall so that I can verify the disconfirming test.

Acceptance:
- Given the eval set, when I run the command, then precision, recall, F1, and per-case verdicts are printed and written to `eval-results/find_similar-<timestamp>.json`.

**US-6.4 — CI gate**
As a dev principal, I want CI to fail PRs that drop find_similar precision below 75% at recall 60% so that the disconfirming test is enforced.

Acceptance:
- Given a PR that touches find_similar logic or eval set, when CI runs, then `atelier eval find_similar` runs and fails the check if thresholds are not met.

**US-6.5 — Keyword fallback with banner**
As any composer, I want find_similar to degrade to keyword search when embeddings are unavailable and surface this in UI so that I don't get silent weak matches.

Acceptance:
- Given the vector index is unavailable, when find_similar is called, then keyword search runs and responses carry `degraded: true`.
- Given `degraded: true`, when UI renders matches, then an explicit banner states "keyword fallback — semantic search unavailable."

**US-6.6 — Accept/reject feedback loop**
As any composer, I want to accept or reject find_similar matches so that the eval set improves over time.

Acceptance:
- Given a find_similar response in UI, when I accept or reject a match, then the decision is recorded and periodically rolled into the eval set (human-reviewed).

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

**US-8.1 — Propose contract change**
As a dev principal, I want `propose_contract_change` so that my territory's interface is queryable and breaking changes go through cross-territory approval. Per ADR-040: this single tool replaces the prior `publish_contract` name; the endpoint decides additive-publish vs proposal-creation based on the ARCH 6.6.1 classifier.

Acceptance:
- Given a territory I own + contract name + schema, when I call `propose_contract_change`, then the classifier runs; on `effective_decision=additive` it stores at minor-bumped version and broadcasts; on `effective_decision=breaking` it creates a contribution with `requires_owner_approval=true` for cross-territory approval and the major-bumped version lands only on approval.

**US-8.2 — Consume contracts via `get_context`**
As any composer (via agent), I want contract reads filtered by my territories' consumed-list via `get_context` so that I can query only relevant contracts. Per ADR-040 the prior `get_contracts` tool collapses into `get_context`.

Acceptance:
- Given my territory's `contracts_consumed` list, when I call `get_context` with `with_contract_schemas: true` (or under `lens=designer`/`dev`), then only contracts from my consumed-list are returned with current schema + version under `territories.consumed[].contracts_consumed[]`.

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
- Given a classified comment with sufficient confidence, when drafted, then a contribution is created citing the source with the drafted change as content; the contribution's `kind` matches the discipline of the proposed change (implementation/research/design per ADR-033) and `requires_owner_approval=true`.

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
- Given configured webhook, when a contribution transitions, a decision logs, or find_similar flags a high-confidence match, then a message is sent to the configured channel.

---

### Epic 11 — CLI tooling

See `PRD.md` §4.11 for the full surface. CLI commands ship at v1 across milestones per `BUILD-SEQUENCE.md` Epic 1 sequencing table.

NFR for all stories below: each command has `--help`, documented exit codes, and a corresponding end-to-end test.

The canonical CLI surface is **12 commands** at v1 (per NORTH-STAR §10): the 9 enumerated below plus `atelier upgrade` (US-1.7 covers the lifecycle framing; US-11.10 below covers the CLI surface), `atelier audit` (US-11.11), and `atelier review` (US-11.12).

**US-11.1 — atelier init**
As a team starting a new project, I want `atelier init <project>` so that I get the scaffolded directory structure, config templates, and charter files in one command.

Acceptance:
- Given an empty directory, when `atelier init <project>` runs, then the directory contains `docs/`, `prototype/`, `research/`, `scripts/`, `.atelier/`, `CLAUDE.md`, `AGENTS.md`, `traceability.json`, and `.github/workflows/atelier-audit.yml` per the bundled template.

**US-11.2 — atelier datastore init**
As a team standing up a guild, I want `atelier datastore init` so that the coordination datastore tables, indexes, and RLS policies exist.

Acceptance:
- Given valid `ATELIER_DATASTORE_URL`, when `atelier datastore init` runs, then the schema from ARCH §5.1 is applied, indexes from §5.2 exist, RLS policies from §5.3 are enforced; re-running is idempotent.

**US-11.3 — atelier deploy**
As a team, I want `atelier deploy` so that the prototype web app and agent endpoint go live on the configured hosting.

Acceptance:
- Given valid `ATELIER_PROTOTYPE_DEPLOY_URL` and `ATELIER_ENDPOINT_URL`, when `atelier deploy` runs, then both surfaces are reachable and the endpoint passes a synthetic register/heartbeat/deregister check.

**US-11.4 — atelier invite**
As an admin, I want `atelier invite <email> --role <r>` so that a composer gets a usable bearer token (OAuth setup link or static API token per ARCH §7.9).

Acceptance:
- Given the configured identity provider is reachable, when `atelier invite <email> --role <r>` runs, then the response carries both an OAuth setup link and a static API token; the composer's first `register` call with that token succeeds.

**US-11.5 — atelier territory add**
As an architect, I want `atelier territory add` so that a new territory definition lands in `.atelier/territories.yaml` with validated fields.

Acceptance:
- Given an interactive prompt for name/owner_role/scope_kind/scope_pattern/contracts, when the prompts complete, then a new territory entry appears in `.atelier/territories.yaml` validated against the schema, the change is committed via the standard PR flow per `.atelier/territories.yaml` header governance rule.

**US-11.6 — atelier sync `<target>`**
As an operator, I want `atelier sync <target>` so that I can manually trigger any of the sync substrate scripts (publish-docs, publish-delivery, mirror-delivery, reconcile, triage) outside the normal cron/webhook cadence.

Acceptance:
- Given a valid target name, when `atelier sync <target>` runs, then the target script executes once with the project's configured adapter and exits with status reflecting success/partial/failure.

**US-11.7 — atelier reconcile**
As a dev, I want `atelier reconcile` so that I can see all drift between repo canonical state and external systems on demand.

Acceptance:
- Given external integrations configured, when `atelier reconcile` runs, then a divergence report is produced (per ARCH §6.5 reconcile flow) listing repo-says-X / external-says-Y for each tracked field; the script never writes.

**US-11.8 — atelier eval find_similar**
As a dev, I want `atelier eval find_similar` so that I can run the precision/recall eval harness against the labeled seed set on demand.

Acceptance:
- Given the eval set exists at the configured path, when `atelier eval find_similar` runs, then precision and recall are computed against the seed set and reported against the `ci_precision_gate`/`ci_recall_gate` thresholds from `.atelier/config.yaml`.

**US-11.9 — atelier doctor**
As any composer, I want `atelier doctor` so that I get a single command that diagnoses common configuration and connectivity issues.

Acceptance:
- Given any project state, when `atelier doctor` runs, then it reports status for: datastore reachability, endpoint reachability, identity-provider reachability, configured integrations, sync-script lag, and any drift detected; suggests remediation for each non-OK item.

**US-11.10 — atelier upgrade (CLI surface)**
As a team running an existing project, I want `atelier upgrade` so that I can adopt new template features without re-scaffolding. (Lifecycle framing per US-1.7; this story covers the CLI invocation surface.)

Acceptance:
- Given a project on template_version N, when `atelier upgrade` runs, then it identifies template-version delta, runs additive-preferred migrations per ARCH 9.7, halts with a report on any conflict, and updates `projects.template_version` on success.
- Given the upgrade requires a destructive change (per ARCH 9.7), when `atelier upgrade` runs, then it refuses to proceed without `--allow-destructive` AND a co-shipped reversal ADR reference.

**US-11.11 — atelier audit**
As an architect, I want `atelier audit` so that I can run cross-doc consistency and data-model audits on demand or via CI per METHODOLOGY 11.3 and 11.5.

Acceptance:
- Given the `--per-pr` flag, when `atelier audit` runs against a PR diff, then it executes the per-PR check classes from `scripts/README.md` "Extended cross-doc consistency".
- Given the `--milestone-exit` flag, when run, then it executes the milestone-exit drift sweep per METHODOLOGY 11.3 and writes `docs/architecture/audits/milestone-<id>-exit.md`.
- Given the `--milestone-entry` flag, when run, then it executes the data-model + contract audit per METHODOLOGY 11.5 and writes `docs/architecture/audits/pre-<id>-data-model-audit.md`.
- Given the `--quarterly` flag, when run, then it executes the quarterly destination check per METHODOLOGY 11.4.

**US-11.12 — atelier review**
As any composer, I want `atelier review` so that I can compute the required reviewers for a contribution or PR based on the territory it touches.

Acceptance:
- Given a contribution_id or a PR-changed-files list, when `atelier review` runs, then it computes the required reviewers from `.atelier/territories.yaml` review_role + `.atelier/config.yaml` reviewer-matrix overrides per METHODOLOGY 11.2.
- Given multiple territories touched, when run, then the response lists the union of required reviewers per territory with the routing logic explained.

**US-11.13 — atelier dev**
As any composer, I want `atelier dev` so that I can bring up the entire local Atelier substrate (Supabase + dev server + bearer + sanity checks) with a single command instead of stepping through `local-bootstrap.md` Step 0 plus Steps 1, 2, 4, 5 every session.

Acceptance:
- Given a clean repo with prerequisites installed (Node 22+, Supabase CLI, Docker, an OpenAI API key in `prototype/.env.local`), when `atelier dev` runs, then Supabase starts (or is detected as already running), migrations are applied, the prototype dev server starts on port 3030, a bearer is issued (or the cached one is detected as still valid), `.mcp.json` is updated, and the connection summary prints with the `/atelier` URL + the bearer-rotation reminder.
- Given a partially-up substrate (e.g., Supabase running but dev server stopped), when run, then `atelier dev` brings up only what's missing without restarting components that are already healthy.
- Given a port :3030 conflict, when run, then `atelier dev` reports the conflict and exits with a non-zero code rather than silently falling back to a different port.
- Given a stale bearer (expired or near-expiry per the JWT exp claim), when run, then `atelier dev` re-issues a fresh bearer and updates `.mcp.json` automatically.
- Per the M7 kickoff: 13th v1 CLI command (CLI surface only; does NOT touch the ADR-013/040 12-tool MCP surface lock). Surfaced by 4 runbook drift findings + 2 bearer-cache incidents + 1 port-mismatch fix observed across M2-M6.

---

### Epic 12 — Observability

**US-12.1 — Telemetry emission**
As a platform, I want every endpoint call + state transition + lock event to emit telemetry so that diagnosis is possible.

Acceptance:
- Given any endpoint call, when it completes (success or failure), then an event is written to the observability sink with session, action, outcome, duration.

**US-12.2 — Admin observability sub-route**
As an admin composer, I want `/atelier/observability` so that I can see system health.

Acceptance:
- Given admin role, when I visit the route, then I see sections for sessions, contributions, locks, decisions, find_similar match rate, triage accuracy, sync lag, vector-index health.

**US-12.3 — Session heartbeat dashboard**
As an admin, I want to see heartbeat status per session so that reaper activity is visible.

Acceptance:
- Given active and recently-reaped sessions, when I view, then each shows heartbeat interval health, last seen, and reaper actions taken.

**US-12.4 — Find_similar match-rate report**
As a dev principal, I want to see find_similar match rates over time so that precision regressions are visible.

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
- Given a contribution with `requires_owner_approval=true` (whether from triage or cross-role authoring per ADR-033), when merge is attempted without explicit human approval recorded in the datastore, then merge is blocked.

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

**US-16.6 — Cross-surface visibility**
As any composer, I want to see sessions from all surfaces in `/atelier` so that I know who's active regardless of their tool.

Acceptance:
- Given sessions from ide, web, and terminal surfaces, when I view `/atelier` sessions list, then all three kinds render with surface icon + last heartbeat.

---

## 7. Non-functional requirements

| NFR | Target | Stories impacted |
|---|---|---|
| **Find_similar precision** | ≥75% at ≥60% recall on eval set | Epic 6 |
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
3. Embedding-model default + swappability for find_similar.
4. Contract-breaking-change heuristics (what counts as breaking).
5. Identity-service default (self-hosted OIDC, external provider, or bring-your-own).
6. Upgrade-path semantics when a project on template vN is migrated to vN+1.
