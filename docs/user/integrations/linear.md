# Wire Atelier to Linear

**Audience:** an operator (you) who wants Atelier contributions to mirror
into Linear as issues — created on `claim`, state-set as the contribution
advances, and pulled back periodically to mirror Linear-authoritative
fields (assignee, project, estimate, status) into the registry.

**Scope:** Linear's hosted GraphQL API at `https://api.linear.app/graphql`.

**Trace ID:** US-10.3 (this is the Linear half; the Jira half landed in F1).

---

## What this adapter does

| Direction | Trigger | Effect |
|---|---|---|
| Atelier → Linear | contribution state change (`publish-delivery`) | upserts a Linear issue (IssueCreate first time, IssueUpdate thereafter) and resolves `stateId` against the team's workflow states. |
| Linear → Atelier | nightly cron (`mirror-delivery`) | pulls each linked issue's status, assignee, project (mapped to `sprint`), estimate (mapped to `points`), and `updatedAt`; writes them onto `delivery_sync_state.metadata`. |

Branch reaping (`reconcile --reap-branches`) is **not** offered by the
Linear adapter — Linear is a delivery tracker, not a source-control
surface. The reconcile script already skips the reaping pass for
adapters that do not implement `listManagedBranches`.

---

## Linear vs Jira: the things that bite

Three Linear-specific quirks worth absorbing before you wire it up:

1. **No Bearer prefix.** Linear's personal API keys go into the
   `Authorization` header verbatim — *not* `Bearer <key>`. Frequent
   footgun for operators who have GitHub / Jira / OAuth muscle memory.
2. **Linear's "Project" is approximate sprint.** Linear has no Sprint
   primitive; its closest equivalent is the cross-team Project entity.
   The adapter maps `issue.project.name` into Atelier's `sprint` field.
   For tighter cycle tracking, Linear's Cycle entity exists but is not
   surfaced at v1 (file an issue if you need it).
3. **Labels and workflow states are entities, not strings.** Atelier's
   label and state names must resolve to Linear UUIDs at upsert time.
   The adapter caches the team's name-to-id maps on first use; if a
   name doesn't resolve, it logs a warning and omits the label /
   skips the state-change. **You must pre-create the labels in the
   Linear UI** (full list below).

---

## One-time setup

### 1. Create a Linear API key

1. Open Linear → Settings → API → Personal API keys.
2. Click **Create new key**, give it a label (e.g., `atelier-prod`),
   and copy the value. Linear shows it once only.

### 2. Find your team ID

Linear scopes issues to a Team (different from Linear's "Project" — see
above). The team's ID is a UUID.

The cleanest way is the GraphQL playground:

```graphql
query {
  teams { nodes { id name key } }
}
```

In Linear's app: Settings → API → API explorer (or
`https://studio.apollographql.com/public/Linear-API/...`). Issue the
query above and copy the `id` of the team you want issues to land in.

### 3. Pre-create the labels in Linear

Atelier's labels are GraphQL entities, not free-form strings. Pre-create
this exact set in **Settings → Labels** (scope: the team you chose
above) before turning the adapter on:

```
atelier
atelier/kind:implementation
atelier/kind:research
atelier/kind:design
atelier/state:open
atelier/state:claimed
atelier/state:in_progress
atelier/state:review
atelier/state:merged
atelier/state:rejected
```

Trace-ID labels (`atelier/trace:US-X.Y`, etc.) are project-specific —
the adapter logs a warning and omits any unresolved label rather than
auto-creating, but it doesn't fail the upsert. Pre-create the trace
labels you actively use, or accept the warnings during ramp.

### 4. Set the env vars

The adapter-registry factory reads these at startup. Both are required;
omit either and the registry skips Linear.

```bash
export ATELIER_LINEAR_API_KEY=<the key from step 1>
export ATELIER_LINEAR_TEAM_ID=<the team UUID from step 2>
```

### 5. Tell Atelier which adapter to use

Edit `.atelier/config.yaml`:

```yaml
integrations:
  delivery_tracker:
    kind: linear
    team_id: <your team UUID>
```

`kind: linear` is what the operator-facing scripts look for; the
registry factory handles instantiation from the env vars above. The
`team_id` value is documentation-only at v1 (the env var is what the
adapter consumes); keep them in sync so future tooling reading the YAML
sees the same value.

---

## Workflow status mapping

Linear has no transitions API — issues are state-set directly via
`stateId`. The adapter resolves Atelier states to Linear workflow
states by name (case-insensitive):

| Atelier state | Linear state name candidates |
|---|---|
| `open`        | Backlog, Todo |
| `claimed`     | Todo, Backlog |
| `in_progress` | In Progress |
| `review`      | In Review, Review |
| `merged`      | Done, Completed |
| `rejected`    | Cancelled, Canceled |

If your team's workflow uses different state names, the cleanest fix is
to rename the Linear state to match a candidate above. To inspect your
team's workflow states:

```graphql
query WorkflowStates($teamId: ID!) {
  workflowStates(filter: { team: { id: { eq: $teamId } } }) {
    nodes { id name type }
  }
}
```

If no candidate matches when the adapter runs, the adapter logs a
warning and omits `stateId` from the mutation — Linear keeps the issue
in its current state, the field updates still apply, and the upsert
returns success. This is the deliberate fail-soft posture for workflow
drift; you will see the warning in the script's stdout. The next poll
re-attempts.

This mirrors the same fail-soft posture as the F1 (Jira) runbook;
adopters with custom workflows on either tracker get the same
predictable behavior.

---

## Verify the wiring

### Smoke test (no Linear account required)

```bash
npm run smoke:sync-linear
```

Expected output:

- `[A] adapter unit tests (mocked fetch)` — all PASS unconditionally.
  Includes the GraphQL-200-with-errors path, missing-label warning,
  no-state-match warning, and the API-key redaction assertions.
- `[B] integration with publish-delivery + delivery_sync_state` — PASS
  when local Supabase is reachable on `127.0.0.1:54322`; SKIP otherwise
  with a one-line note explaining why.

If [B] SKIPs, bring up the local stack with `supabase start` and re-run.
If [A] fails, the adapter is broken — do not deploy.

### Force a publish against your real Linear team

After setting the env vars, pre-creating the labels, and editing
`.atelier/config.yaml`, run a single dry cycle:

```bash
ATELIER_DELIVERY_ADAPTER=linear \
ATELIER_PROJECT_ID=<your project uuid> \
  npx tsx scripts/sync/publish-delivery.ts --once --adapter linear --dry-run
```

`--dry-run` skips the `delivery_sync_state` write so you can prove the
adapter contacts Linear correctly before trusting it with state. Drop
`--dry-run` once the dry pass looks healthy.

A fresh contribution with `state='claimed'` should produce a new issue
in your Linear team, with the `atelier`, `atelier/state:claimed`,
`atelier/kind:<kind>` labels (those you pre-created), and state set to
the resolved Linear state name (e.g., Todo).

### Mirror Linear state back into the registry

Once issues exist, run the mirror pass:

```bash
ATELIER_DELIVERY_ADAPTER=linear \
ATELIER_PROJECT_ID=<your project uuid> \
  npx tsx scripts/sync/mirror-delivery.ts --once --adapter linear
```

This populates `delivery_sync_state.metadata` with `assignee`, `sprint`
(mapped from `project.name`), `points` (mapped from `estimate`), and
`observedAt` for every linked issue.

---

## Operating notes

- **API key never appears in error messages.** 401 / 403 surface as
  `LinearGraphQLError: ... authentication failed`. Other errors (HTTP
  5xx with bodies; GraphQL `errors[]` returned alongside HTTP 200) get
  the API key value redacted to `***` if it leaks into the response
  body.
- **GraphQL 200-with-errors is treated as a failure.** Linear returns
  HTTP 200 OK with `{ errors: [...] }` on application errors. The
  adapter throws `LinearGraphQLError` rather than silently succeeding.
  This is the v1 reason the smoke test asserts on this path explicitly.
- **No auto-create.** Atelier never creates labels or workflow states
  on your behalf. Pre-create them per step 3 above.

---

## Cross-references

- `scripts/sync/lib/linear.ts` — the adapter implementation.
- `scripts/sync/lib/adapter-registry.ts` — the env-var-driven registry factory.
- `scripts/sync/__smoke__/linear.smoke.ts` — smoke harness (`npm run smoke:sync-linear`).
- `docs/user/integrations/jira.md` — the parallel F1 (Jira) runbook; same shape, different REST surface.
- `docs/user/guides/rotate-secrets.md` — rotation procedure shape (apply to the API key).
- `docs/strategic/BUILD-SEQUENCE.md` row F — adapter sequencing.
- BRD §10.3 (US-10.3) — the trace ID this work satisfies (closes the story; F1 + F2 together).
