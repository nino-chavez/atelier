# Wire Atelier to Figma

**Audience:** an operator (you) who wants comments left on Figma frames to
flow into Atelier's triage queue so designers' feedback is routed
through the same classifier -> drafter -> proposal pipeline as comments
from GitHub, Jira, and Linear.

**Scope:** Figma's hosted REST API at `https://api.figma.com/v1/`. The
adapter is **read-only** -- it pulls comments out of Figma for triage
and never writes back. Per ADR-019 (Figma is feedback surface, not
design source), design components live in the prototype; Figma is a
review companion.

**Trace ID:** US-10.5 (closes the F-series; F1-F4 covered Jira /
Linear / Confluence / Notion).

---

## What this adapter does

| Direction | Trigger | Effect |
|---|---|---|
| Atelier -> Figma | (none) | Read-only adapter. F5 does not publish to Figma. Per ADR-019. |
| Figma -> Atelier | `resolveCommentSourceAdapter('figma').fetchSince(date)` (driven by triage polling at v1; M2 endpoint webhooks replace polling) | Pulls all comments newer than `date` across the configured `fileKeys`, filters out resolved comments by default, maps each to an `ExternalComment` and feeds into the triage classifier + drafter pipeline. |

The adapter is the third interface in the F-series:
`CommentSourceAdapter`, not `DocAdapter` (F3/F4) or `DeliveryAdapter`
(F1/F2). The shape is `fetchSince(date) -> ExternalComment[]` -- a
pull, not a push.

---

## Figma vs the other F adapters: what differs

If you already wired up Jira / Linear / Confluence / Notion, four
Figma-specific quirks worth absorbing before you start:

1. **Auth header is `X-Figma-Token`, not `Authorization: Bearer ...`.**
   Every other adapter in this directory uses Bearer or Basic auth.
   Figma silently 403s on a Bearer header. The smoke test asserts
   `X-Figma-Token` is present and Bearer is absent on every captured
   request -- mirror that posture if you hand-test with `curl`.
2. **No server-side `since` filter.** Figma's
   `GET /v1/files/{file_key}/comments` returns the entire comment
   history of the file every call. The adapter filters by
   `created_at > since` client-side. For typical files (<1000
   comments) this is fine; the runbook calls out the cost for
   adopters with huge files.
3. **Rate limit is 2 req/sec per token.** With multiple `fileKey`s
   configured, the adapter serializes requests and sleeps 500ms
   between them. A single-file poll has zero added latency; an
   N-file poll adds (N-1) * 500ms.
4. **Resolved comments are skipped by default.** Triage is for
   unresolved feedback. The constructor exposes an `includeResolved`
   flag for adopters who want them.

---

## One-time setup

### 1. Create a Figma Personal Access Token

In the Figma workspace whose comments you want Atelier to ingest:

1. Visit your Figma **Account settings** (top-right avatar -> Settings).
2. Scroll to **Personal access tokens** -> **Create new token**.
3. Name it (e.g., `atelier-prod`) and submit.
4. Copy the token now -- Figma shows it once and never again.

Treat the token like a password. Tokens have **no scope granularity** at
v1: any token grants read access to every file the issuing user can see.
If you need a tighter blast radius, create a dedicated Figma user for
Atelier and grant that user view access to the specific files only.
Rotation procedure: see `docs/user/guides/rotate-secrets.md`.

### 2. Find each fileKey to poll

The Figma file URL looks like:

```
https://www.figma.com/file/<fileKey>/<file-name>?node-id=...
                          ^^^^^^^^^
                          fileKey (alphanumeric segment)
```

Extract the `<fileKey>` segment from each file you want polled. One
adapter instance polls all of them; each `fetchSince` call fans out
across them.

### 3. Set the env vars

Both env vars are required; omit either and the registry skips Figma
(scripts that resolve `'figma'` will throw "no comment-source adapter
registered" -- that is the intended fail-loud signal that Figma is
unconfigured).

```bash
export ATELIER_FIGMA_API_TOKEN=figd_<the-token-from-step-1>
export ATELIER_FIGMA_FILE_KEYS=<key1>,<key2>,<key3>
```

`ATELIER_FIGMA_FILE_KEYS` is a comma-separated list. Whitespace around
each entry is trimmed; empty entries are dropped. A single fileKey is
fine -- the comma isn't required.

### 4. Tell Atelier which adapter to use

Edit `.atelier/config.yaml`:

```yaml
integrations:
  design_tool:
    kind: figma
    file_keys:
      - <key1>
      - <key2>
```

`kind: figma` is what operator-facing scripts look for; the registry
factory (`scripts/sync/lib/adapter-registry.ts`) handles the actual
instantiation from the env vars above. The `file_keys` list in the
YAML is documentation-only at v1 (the env var is what the adapter
consumes); keep them in sync so future tooling reading the YAML sees
the same value.

---

## Pull comments

The adapter is a `CommentSourceAdapter`; consume it through the
registry:

```ts
import { resolveCommentSourceAdapter } from 'scripts/sync/lib/adapters.ts';
import { registerConfiguredAdapters } from 'scripts/sync/lib/adapter-registry.ts';

registerConfiguredAdapters();
const figma = resolveCommentSourceAdapter('figma');
const since = new Date(Date.now() - 60 * 60 * 1000); // last hour
const comments = await figma.fetchSince(since);
// comments[]: ExternalComment with source='figma', context.fileKey, etc.
```

What happens, step by step:

1. The adapter loops through the configured `fileKeys`.
2. For each file, `GET /v1/files/{file_key}/comments?as_md=true` (the
   `as_md=true` query param formats the message field as markdown so
   `@`-mentions and links render correctly downstream).
3. Between files, the adapter sleeps 500ms to stay under Figma's
   2 req/sec rate limit.
4. Comments older than or equal to `since` are filtered out
   client-side (Figma has no server-side `since` parameter).
5. Resolved comments are filtered out client-side unless you
   construct the adapter with `includeResolved: true`.
6. Each surviving Figma comment is mapped to an `ExternalComment`:
   - `source` = `'figma'`
   - `externalCommentId` = the Figma comment id
   - `externalAuthor` = the commenter's Figma handle
   - `text` = the markdown-formatted message
   - `receivedAt` = the comment's `created_at`
   - `context` = `{ fileKey, nodeId, parentCommentId, figmaUrl, resolved }`
7. The flat list is sorted ascending by `receivedAt` and returned.

Each `ExternalComment` is the same shape that the triage pipeline
already consumes (`route-proposal --comment-json <path>`). To trigger
triage on the pulled comments, write each one to a temp JSON file and
invoke `route-proposal`, or call `routeProposal()` directly (see the
smoke test for an in-process example).

---

## Verify the wiring

### Smoke test (no Figma account required)

```bash
npm run smoke:sync-figma
```

Expected output:

- `[A] adapter unit tests (mocked fetch)` -- all PASS unconditionally.
  Covers single-file fetch, multi-file fetch with the 500ms gap,
  `since` filter, `resolved` exclusion + override, the
  `X-Figma-Token` header (Bearer asserted absent), 401 + 500 token
  redaction, the 404-on-one-file warn-and-continue path, the
  empty-fileKeys throw, and the figmaUrl construction.
- `[B] integration with triage (routeProposal -> triage_pending)` --
  PASSes against a reachable local Postgres, otherwise SKIPs with an
  explicit `SKIP no Postgres reachable at ...` line.

If any check fails, the adapter is broken -- do not deploy.

### Force a pull against your real Figma workspace

After setting the env vars, run a one-shot pull from the Node REPL or
a small script:

```bash
node --import tsx -e "
  const { registerConfiguredAdapters } = await import('./scripts/sync/lib/adapter-registry.ts');
  const { resolveCommentSourceAdapter } = await import('./scripts/sync/lib/adapters.ts');
  registerConfiguredAdapters();
  const figma = resolveCommentSourceAdapter('figma');
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days
  const comments = await figma.fetchSince(since);
  console.log(JSON.stringify(comments, null, 2));
"
```

You should see a JSON array of `ExternalComment` objects with
`source: "figma"` and `context.fileKey` set. If the array is empty
but you know there are comments newer than 7 days, double-check
the fileKey is correct and the integration token belongs to a user
who can see that file.

### Hand-test with curl (optional)

```bash
curl -H "X-Figma-Token: $ATELIER_FIGMA_API_TOKEN" \
  "https://api.figma.com/v1/files/$ATELIER_FIGMA_FILE_KEYS/comments?as_md=true"
```

If you accidentally use `-H "Authorization: Bearer $TOKEN"` instead,
the API silently 403s. This is the most common first-time-Figma-API
mistake; the adapter shape exists specifically to prevent the same
error in code.

---

## Operating notes

- **Token never appears in logs.** 401 / 403 responses surface as
  `FigmaApiError: ... authentication failed` with no token leaked
  into the message. Other Figma errors include the response body
  but with the access token redacted to `***`.
- **Rate limits.** 2 req/sec per token. Adapter serializes requests
  with a 500ms gap between fileKeys; a 10-fileKey poll thus takes
  ~5 seconds wall-clock minimum. If your polling cadence at the
  operator side is once-per-minute, this is invisible. If you poll
  much more aggressively, watch for 429s and tune cadence rather
  than reaching for parallelism (Figma's per-token budget is the
  ceiling either way).
- **No `since` server-side filter.** The adapter fetches ALL comments
  per file each poll and filters client-side. For files with >1000
  comments, the network cost grows linearly. Adopters who care:
  archive resolved threads in Figma to keep file-comment counts
  bounded, or fork the adapter to keep a per-file
  `last-seen-comment-id` cursor and filter by that.
- **Resolved comments are skipped by default.** To include them, pass
  `includeResolved: true` to the constructor. The registry-factory
  path does not surface this knob; if you need it, instantiate the
  adapter directly and call `registerCommentSourceAdapter(adapter)`
  in your boot code.
- **Multi-file fault tolerance.** A 404 on one fileKey (typo, deleted
  file, permission revoked) does not kill the whole poll. The adapter
  logs a warning to stderr and continues with the remaining fileKeys.
  Other errors (5xx, auth, rate limit) propagate and abort the poll.
- **Comment threading is preserved through `parent_id`.** Top-level
  comments have `context.parentCommentId === null`; thread replies
  carry the parent's comment id. The triage classifier sees both as
  individual `ExternalComment`s; if you need conversation-aware
  classification, group by `parentCommentId` in the consuming code.
- **Canvas position via `client_meta.node_id`.** Comments anchored to
  a specific node carry `context.nodeId`; floating canvas comments
  carry `null`. The constructed `context.figmaUrl` includes a
  `node-id=` query parameter when present so reviewers landing on
  the URL jump directly to the commented frame.

---

## Known limitations (v1)

- **No webhooks at v1.** Triage polls the adapter rather than
  receiving push notifications. M2 endpoint webhooks replace polling
  per the BRD.
- **No write-back.** Per ADR-019 the adapter is read-only; F5 does
  not surface a "post a reply to Figma" path. If you want to mark a
  comment as resolved or reply, do it in Figma directly.
- **No comment-attachment ingestion.** Figma comments may carry
  attachments; the adapter forwards only the markdown message text.
  If a reviewer attaches an annotated screenshot, the screenshot is
  not propagated.
- **Token has no scope granularity.** A Figma personal access token
  grants read access to every file the issuing user can see. If you
  need tighter scope, create a dedicated Figma user for Atelier and
  grant that user view access to specific files.
- **No since-cursor persistence.** The caller passes `since` to
  `fetchSince`; the adapter does not remember the last poll boundary.
  Maintain the cursor at the caller side (typically a row in a
  `comment_sync_state` table or equivalent) and pass it back on the
  next poll.

If you need any of the above sooner than the v1.x roadmap implies,
file a `BRD-OPEN-QUESTIONS` entry per `docs/methodology/METHODOLOGY.md`
section 6.7.

---

## Cross-references

- `scripts/sync/lib/figma.ts` -- the adapter implementation.
- `scripts/sync/lib/adapter-registry.ts` -- the env-var-driven registry factory.
- `scripts/sync/__smoke__/figma.smoke.ts` -- smoke harness (`npm run smoke:sync-figma`).
- `scripts/sync/triage/route-proposal.ts` -- the triage entry point that consumes `ExternalComment`s.
- `docs/user/integrations/notion.md` -- the Notion sibling adapter (F4).
- `docs/user/integrations/confluence.md` -- the Confluence sibling adapter (F3).
- `docs/user/integrations/jira.md` -- the Jira delivery adapter (F1).
- `docs/user/integrations/linear.md` -- the Linear delivery adapter (F2).
- `docs/user/guides/rotate-secrets.md` -- rotation procedure shape (apply to the API token).
- `docs/strategic/BUILD-SEQUENCE.md` row F -- adapter sequencing (F5 = Figma; closes US-10.5 + F-series).
- ADR-019 (`docs/architecture/decisions/ADR-019-figma-is-feedback-surface-not-design-source.md`) -- Figma is feedback surface, not design source.
- BRD section 10.5 (US-10.5) -- the trace ID this work satisfies.
