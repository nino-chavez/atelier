# Wire Atelier to Notion

**Audience:** an operator (you) who wants Atelier's canonical project docs
to publish into a Notion database as pages — overwritten on every
`publish-docs` run with a "this page is generated" banner so commenters
discover the canonical artifact in the repo.

**Scope:** Notion's hosted REST API at `https://api.notion.com/v1/`
(API version `2022-06-28`, the long-stable production version).

**Trace ID:** US-10.4 (this is the Notion half; the Confluence half
landed in F3). With F4 merged, US-10.4 is closed.

---

## What this adapter does

| Direction | Trigger | Effect |
|---|---|---|
| Atelier → Notion | `publish-docs --adapter notion --space <DATABASE_ID> --doc <path>` | upserts a Notion page in the configured database (POST first time, PATCH-title + delete-then-replace blocks thereafter) with the canonical body and a "do not edit here" banner. |
| Notion → Atelier | (handled by the comments adapter at v1.x; not part of F4) | comments on the Notion page would flow back through the triage pipeline; comment ingestion is a separate `CommentSourceAdapter` not implemented at v1. |

Page upsert is keyed on `database + title`. The adapter does the
search-by-title internally because `publish-docs` is one-shot and does
not pass back a prior `externalUrl` to the adapter (no `doc_sync_state`
table at v1).

---

## Notion vs Confluence: the things that bite

If you already wired up the Confluence adapter (F3), four
Notion-specific quirks worth absorbing:

1. **Internal Integration must be granted access to the database.** A
   Notion API token alone is not enough — you must explicitly add the
   integration as a connection on the target database via the
   database's "..." menu → "Add connections". Without this, the API
   returns `404 object_not_found` even though the database exists.
   This is the most common first-time-Notion-API failure; the runbook
   walks you through it explicitly below.
2. **`Notion-Version` header is required.** Every request must carry
   `Notion-Version: 2022-06-28` (or another stable version) or the API
   returns 400. The adapter sets this automatically; do not override
   unless you know what you're doing.
3. **No version-number concurrency control.** Notion is last-write-wins
   on `PATCH /pages` and `PATCH /blocks/{id}/children`. There is no
   analog to Confluence's monotonic `version.number`. If two agents
   publish the same page in parallel, blocks may interleave —
   serialize on the caller side if that matters to you.
4. **Content is block-based, not HTML.** Each paragraph, heading, and
   list item is a separate block object. The adapter ships a minimal
   HTML→blocks translator that handles `<h1>`-`<h3>`, `<p>`, `<ul>`,
   `<ol>`, `<pre><code>`, `<a>`, `<strong>`, `<em>`, inline `<code>`,
   and `<hr/>`. Tables, images, nested lists, and syntax-highlighted
   code blocks are out of scope at v1.

---

## One-time setup

### 1. Create a Notion Internal Integration

In the Notion workspace where Atelier docs should appear:

1. Visit `https://www.notion.so/my-integrations`.
2. Click **+ New integration**.
3. Pick the workspace, give the integration a name (e.g., `atelier-prod`),
   and choose **Internal** as the type.
4. Submit. Notion shows the **Internal Integration Secret** — copy it now
   (you can re-reveal it later from the integration's settings page).

Treat the token like a password. Rotation procedure mirrors any other
secret in `docs/user/guides/rotate-secrets.md`.

### 2. Grant the integration access to the target database

**This step is required.** Without it, the API returns 404 even though
the database exists.

1. In Notion, navigate to the database you want Atelier to publish into.
2. Click the **`...`** menu in the top-right of the database.
3. Scroll to **Connections** → click **Add connections**.
4. Search for the integration name from step 1 (e.g., `atelier-prod`)
   and select it.
5. Confirm. The integration now appears in the database's connections list.

If your workspace has many databases, repeat this step for each one
the integration should be able to write to. Atelier currently writes
to a single configured database per project.

### 3. Find the database ID

The database URL looks like:

```
https://www.notion.so/<workspace>/abc123...?v=def456...
                                  ^^^^^^^^^
                                  database id (32-char hex; dashes optional)
```

Take the 32-char hex segment between the workspace slug and the `?v=`.
Notion accepts the database id either dashed (UUID form,
`abcdef12-3456-7890-abcd-ef1234567890`) or undashed
(`abcdef1234567890abcdef1234567890`) — pick either.

### 4. Set the env vars

Both env vars are required; omit either and the registry skips Notion
(the script falls back to whatever adapter you passed via `--adapter`,
which is `noop` by default).

```bash
export ATELIER_NOTION_API_TOKEN=secret_<the-token-from-step-1>
export ATELIER_NOTION_DATABASE_ID=<the-database-id-from-step-3>
```

### 5. Tell Atelier which adapter to use

Edit `.atelier/config.yaml`:

```yaml
integrations:
  published_docs:
    kind: notion
    database_id: <the-database-id>
```

`kind: notion` is what the operator-facing scripts look for; the
registry factory handles the actual instantiation from the env vars
above. The `database_id` value is documentation-only at v1 (the env
var or `--space` flag is what the adapter consumes); keep them in sync
so future tooling reading the YAML sees the same value.

---

## Publish a doc

```bash
ATELIER_DOC_ADAPTER=notion \
  npx tsx scripts/sync/publish-docs.ts \
    --adapter notion \
    --space <DATABASE_ID> \
    --doc docs/strategic/NORTH-STAR.md
```

What happens, step by step:

1. The script reads `docs/strategic/NORTH-STAR.md`.
2. It derives a page title from the first `# H1` heading (or falls back
   to the file basename without `.md`).
3. It prepends the canonical "edits here will be overwritten" banner.
4. The Notion adapter searches the database for a page with that title
   (`POST /v1/databases/{db}/query` with a `Name` title-equals filter).
5. If a page exists, the adapter:
   a. PATCHes the page properties to ensure the title is current.
   b. Lists the existing top-level child blocks and archives them
      one-at-a-time via `DELETE /v1/blocks/{id}`.
   c. Appends fresh blocks via `PATCH /v1/blocks/{page-id}/children`.
   d. Re-fetches the page to get the latest `last_edited_time`.
6. If no page exists, the adapter `POST`s `/v1/pages` with the database
   parent + title property + initial children blocks.
7. The script logs the resolved Notion URL.

A fresh run on a never-published doc creates a new page in your Notion
database; subsequent runs update the same page **at the same URL** —
the adapter chooses delete-then-replace specifically so external links
to the page stay stable across publishes.

### Dry-run

```bash
npx tsx scripts/sync/publish-docs.ts --adapter notion --space <DATABASE_ID> --doc <path> --dry-run
```

`--dry-run` skips the network round-trip entirely so you can prove the
script discovered the doc and resolved the adapter before trusting it
with a real Notion write.

---

## Verify the wiring

### Smoke test (no Notion account required)

```bash
npm run smoke:sync-notion
```

Expected output:

- `[A] adapter unit tests (mocked fetch)` — all PASS unconditionally.
- `[B] integration with publish-docs.publishDoc()` — all PASS
  unconditionally. (The Notion smoke does not require a local Postgres;
  `publish-docs.publishDoc()` is one-shot and writes no database state
  directly. Telemetry, when enabled, is written by `publish-docs.main()`
  and is exercised separately when you run the script with
  `ATELIER_PROJECT_ID` set against a reachable database.)

If any check fails, the adapter is broken — do not deploy.

### Force a publish against your real Notion workspace

After setting the env vars and editing `.atelier/config.yaml`, run a
single dry cycle against the actual Notion API:

```bash
ATELIER_DOC_ADAPTER=notion \
  npx tsx scripts/sync/publish-docs.ts \
    --adapter notion \
    --space "$ATELIER_NOTION_DATABASE_ID" \
    --doc docs/methodology/METHODOLOGY.md
```

Visit your Notion database and look for a row whose title matches the
H1 of `METHODOLOGY.md`. Open it; the page should show the banner as
the first paragraph, then a divider, then the rest of the document
body decomposed into Notion blocks.

---

## Operating notes

- **Token never appears in logs.** 401 / 403 responses surface as
  `NotionApiError: ... authentication failed` with no token leaked
  into the message. Other Notion errors include the response body but
  with the bearer token redacted to `***`.
- **API version: `2022-06-28`.** The adapter pins to this long-stable
  production version. Override via `notionVersion` in the constructor
  config if you need a newer version (a v1.x adopter concern; the env
  var path does not surface this knob).
- **Body format: Notion blocks.** Each `<p>`, `<h1>`-`<h3>`, list item,
  code block, divider becomes a separate block object. The HTML-to-
  blocks translator is intentionally minimal — it covers the common
  markdown→HTML output shape and falls through to plain-text paragraph
  blocks for anything outside the supported subset.
- **Page upsert is title-keyed.** Because there is no `doc_sync_state`
  table for docs at v1, the adapter searches the database by title on
  every publish to decide create vs update. If you rename the H1
  heading of a canonical doc, the next publish will create a new page
  rather than updating the existing one — clean up the old page in
  Notion, or rename it in Notion to match before re-publishing.
- **Same-process cache.** Within a single `publish-docs` run, the
  adapter caches `databaseId → (title → pageId)` to avoid re-querying
  the database on subsequent publishes of the same title in the same
  process. The cache lives on the adapter instance and resets per
  process; there is no cross-process state.
- **Markdown content from `publish-docs` at v1.** `publish-docs.ts`
  currently passes the raw markdown body into `bodyHtml` (a known v1
  shortcut; the field is named for the eventual format). Until the
  markdown-to-HTML conversion lands inside `publish-docs.ts`, the
  Notion adapter renders markdown source as plain-text paragraph
  blocks rather than headings/lists. The adapter is built to handle
  real HTML when that conversion lands; no adapter change required at
  that point.

---

## Known limitations (v1)

- **No tables.** Notion tables require `table` + `table_row` block
  objects with a specific cell-rich-text structure. The HTML-to-blocks
  translator falls through to plain-text paragraphs for `<table>`
  inputs.
- **No images.** Image blocks need a `file` or `external` URL object.
  Adopters who need image support can post-edit pages manually after
  publish.
- **No nested lists.** Notion supports nested list items via the
  `children` field on a list-item block; the v1 translator emits a
  flat list. Sub-bullets in the source HTML render as additional
  top-level bullets.
- **No syntax highlighting on code blocks.** All code blocks emit with
  `language: 'plain text'`. Notion supports a wide language enum; the
  v1 translator does not infer language from `<code class="language-X">`
  attributes.
- **Last-write-wins concurrency.** Two agents publishing the same page
  in parallel may interleave blocks. Serialize on the caller side if
  this matters.
- **No `doc_sync_state` table.** Upsert is keyed on `database + title`
  every run; renaming a doc's H1 creates a new Notion page. Track the
  `externalUrl` yourself if you need a stable reference.
- **No comment ingestion via this adapter.** F4 implements only the
  `DocAdapter` (write) surface. Comment ingestion is the
  `CommentSourceAdapter` and is out of scope for F4.

If you need any of the above sooner than the v1.x roadmap implies,
file a `BRD-OPEN-QUESTIONS` entry per `docs/methodology/METHODOLOGY.md`
section 6.7.

---

## Cross-references

- `scripts/sync/lib/notion.ts` — the adapter implementation.
- `scripts/sync/lib/adapter-registry.ts` — the env-var-driven registry factory.
- `scripts/sync/__smoke__/notion.smoke.ts` — smoke harness (`npm run smoke:sync-notion`).
- `scripts/sync/publish-docs.ts` — the script that drives the adapter.
- `docs/user/integrations/confluence.md` — the Confluence sibling adapter (F3).
- `docs/user/integrations/jira.md` — the Jira delivery adapter (F1).
- `docs/user/integrations/linear.md` — the Linear delivery adapter (F2).
- `docs/user/guides/rotate-secrets.md` — rotation procedure shape (apply to the API token).
- `docs/strategic/BUILD-SEQUENCE.md` row F — adapter sequencing (F4 = Notion; closes US-10.4).
- BRD §10.4 (US-10.4) — the trace ID this work satisfies.
