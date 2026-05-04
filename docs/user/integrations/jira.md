# Wire Atelier to Jira Cloud

**Audience:** an operator (you) who wants Atelier contributions to mirror
into Jira Cloud as issues — created on `claim`, transitioned through
status as the contribution advances, and pulled back periodically to
mirror Jira-authoritative fields (assignee, sprint, story points, status)
into the registry.

**Scope:** Jira Cloud (the `*.atlassian.net` SaaS shape). Jira Server /
Data Center is similar but uses different endpoints for some surfaces and
different auth (PAT vs Basic-auth-with-API-token); not exercised at v1.

**Trace ID:** US-10.3.

---

## What this adapter does

| Direction | Trigger | Effect |
|---|---|---|
| Atelier → Jira | contribution state change (`publish-delivery`) | upserts a Jira issue (POST first time, PUT thereafter) and applies the transition matching Atelier's state. |
| Jira → Atelier | nightly cron (`mirror-delivery`) | pulls each linked issue's status, assignee, sprint, story points, and last-updated time; writes them onto `delivery_sync_state.metadata`. |

Branch reaping (`reconcile --reap-branches`) is **not** offered by the
Jira adapter — Jira is a delivery tracker, not a source-control surface.
The reconcile script already skips the reaping pass for adapters that do
not implement `listManagedBranches`.

---

## One-time setup

### 1. Create a Jira API token

In the Atlassian account that should appear as the issue author:

1. Visit `https://id.atlassian.com/manage-profile/security/api-tokens`.
2. Click **Create API token**, give it a label (e.g., `atelier-prod`),
   and copy the token value. You cannot retrieve it later.
3. Note the email address of that Atlassian account — Jira's Basic auth
   pairs the email with the token (not your password).

Treat the token like a password. Rotation procedure mirrors any other
secret in `docs/user/guides/rotate-secrets.md`.

### 2. Set the env vars

The adapter-registry factory reads these at startup. All four are required;
omit any one and the registry skips Jira (the script falls back to whatever
adapter you passed via `--adapter`, which is `noop` by default).

```bash
export ATELIER_JIRA_BASE_URL=https://your-site.atlassian.net
export ATELIER_JIRA_EMAIL=you@example.com
export ATELIER_JIRA_API_TOKEN=<the token from step 1>
export ATELIER_JIRA_PROJECT_KEY=ATL   # the Jira project key issues should land in
```

### 3. Tell Atelier which adapter to use

Edit `.atelier/config.yaml`:

```yaml
integrations:
  delivery_tracker:
    kind: jira
    project_key: ATL
```

`kind: jira` is what the operator-facing scripts look for; the registry
factory handles the actual instantiation from the env vars above. The
`project_key` value is documentation-only at v1 (the env var is what the
adapter consumes); keep them in sync so future tooling reading the YAML
sees the same value.

---

## Workflow status mapping

Jira workflows are project-configurable, so the adapter cannot hard-code
transition IDs. At upsert time it calls `GET /rest/api/2/issue/{key}/transitions`
and picks the first transition whose target status name matches one of:

| Atelier state | Jira target status candidates (case-insensitive) |
|---|---|
| `open`        | To Do, Open, Backlog |
| `claimed`     | To Do, Selected for Development, Open |
| `in_progress` | In Progress |
| `review`      | In Review, Review, Code Review |
| `merged`      | Done, Closed, Resolved |
| `rejected`    | Rejected, Won't Do, Closed, Done |

If your workflow uses different status names, the cleanest fix is to
rename one Jira status to match a candidate above. To inspect your
project's available statuses:

```bash
curl -s -u "$ATELIER_JIRA_EMAIL:$ATELIER_JIRA_API_TOKEN" \
  "$ATELIER_JIRA_BASE_URL/rest/api/2/project/$ATELIER_JIRA_PROJECT_KEY/statuses"
```

If no transition matches when the adapter runs, the adapter logs a warning
and leaves the issue in its current Jira status — the upsert still succeeds
(the issue exists, fields are updated). This is the deliberate
fail-soft posture for workflow drift; you will see the warning in
`telemetry.action='delivery.synced'` rows or in the script's stdout, and
the next poll re-attempts the transition.

---

## Custom field IDs (Sprint + Story Points)

Sprint and Story Points live in custom fields whose ids vary per Jira
site. The adapter defaults to the most common Cloud values:

| Field | Default custom field id |
|---|---|
| Sprint        | `customfield_10020` |
| Story Points  | `customfield_10016` |

To find your project's actual ids, use the `/rest/api/2/field` endpoint
and filter by name:

```bash
curl -s -u "$ATELIER_JIRA_EMAIL:$ATELIER_JIRA_API_TOKEN" \
  "$ATELIER_JIRA_BASE_URL/rest/api/2/field" \
  | jq '.[] | select(.name == "Sprint" or .name == "Story Points") | {id, name}'
```

Override the defaults at adapter construction time. The cleanest fork-free
path is to set them through your own bootstrap of `JiraDeliveryAdapter`
(e.g., a small shim that calls `registerDeliveryAdapter` with the
overridden ids before `publish-delivery.main()` runs). At v1 the env-var
factory does not surface these overrides — file an issue if you hit a
project where this matters in production and we will surface them.

---

## Verify the wiring

### Smoke test (no Jira account required)

```bash
npm run smoke:sync-jira
```

Expected output:

- `[A] adapter unit tests (mocked fetch)` — all PASS unconditionally.
- `[B] integration with publish-delivery + delivery_sync_state` — PASS
  when local Supabase is reachable on `127.0.0.1:54322`; SKIP otherwise
  with a one-line note explaining why.

If [B] SKIPs, bring up the local stack with `supabase start` and re-run.
If [A] fails, the adapter is broken — do not deploy.

### Force a publish against your real Jira

After setting the env vars and editing `.atelier/config.yaml`, run a
single dry cycle:

```bash
ATELIER_DELIVERY_ADAPTER=jira \
ATELIER_PROJECT_ID=<your project uuid> \
  npx tsx scripts/sync/publish-delivery.ts --once --adapter jira --dry-run
```

`--dry-run` skips the `delivery_sync_state` write so you can prove the
adapter contacts Jira correctly before trusting it with state. Drop
`--dry-run` once the dry pass looks healthy.

A fresh contribution with `state='claimed'` should produce a new issue
in your Jira project, prefixed by trace IDs in the summary, with the
labels `atelier`, `atelier/kind:<kind>`, `atelier/state:claimed`, and
`atelier/trace:<id>` for each trace ID.

### Mirror Jira state back into the registry

Once issues exist, run the mirror pass:

```bash
ATELIER_DELIVERY_ADAPTER=jira \
ATELIER_PROJECT_ID=<your project uuid> \
  npx tsx scripts/sync/mirror-delivery.ts --once --adapter jira
```

This populates `delivery_sync_state.metadata` with `assignee`, `sprint`,
`points`, and `observedAt` for every linked issue.

---

## Operating notes

- **Token never appears in logs.** 401 / 403 responses surface as
  `JiraHttpError: ... authentication failed` with no token, no Authorization
  header value, and no Basic-auth-encoded form leaked into the message.
  Other Jira errors include the response body but with token + Basic-auth
  header value redacted to `***`.
- **API version: v2.** The adapter uses `/rest/api/2/...` for issue CRUD
  bodies because v3 requires the Atlassian Document Format (a JSON tree)
  for the `description` field, while v2 still accepts plain text. v3 is
  used only if a future field requires it.
- **Issue type defaults to `Task`.** The adapter constructor accepts an
  `issueType` override; expose it through your own registration shim if
  your project uses Story / Bug / etc. exclusively.
- **Jira labels reject whitespace.** The adapter's label shape (`atelier`,
  `atelier/kind:<kind>`, `atelier/state:<state>`, `atelier/trace:<id>`)
  is whitespace-free by construction.

---

## Cross-references

- `scripts/sync/lib/jira.ts` — the adapter implementation.
- `scripts/sync/lib/adapter-registry.ts` — the env-var-driven registry factory.
- `scripts/sync/__smoke__/jira.smoke.ts` — smoke harness (`npm run smoke:sync-jira`).
- `docs/user/guides/rotate-secrets.md` — rotation procedure shape (apply to the API token).
- `docs/strategic/BUILD-SEQUENCE.md` row F — adapter sequencing (F1 = Jira, F2 = Linear).
- BRD §10.3 (US-10.3) — the trace ID this work satisfies.
