# Wire Atelier to Confluence Cloud

**Audience:** an operator (you) who wants Atelier's canonical project docs
to publish into a Confluence space as pages — overwritten on every
`publish-docs` run with a "this page is generated" banner so commenters
discover the canonical artifact in the repo.

**Scope:** Confluence Cloud (the `*.atlassian.net/wiki` SaaS shape).
Confluence Server / Data Center is similar but uses different endpoints
for some surfaces; not exercised at v1.

**Trace ID:** US-10.4 (this is the Confluence half; the Notion half lands
in F4).

---

## What this adapter does

| Direction | Trigger | Effect |
|---|---|---|
| Atelier → Confluence | `publish-docs --adapter confluence --space <KEY> --doc <path>` | upserts a Confluence page (POST first time, PUT thereafter) with the canonical body and a "do not edit here" banner. |
| Confluence → Atelier | (handled by the comments adapter at v1.x; not part of F3) | comments on the Confluence page flow back through the triage pipeline and become draft contributions per ADR-018. |

Page upsert is keyed on `space + title`. The adapter does the search-by-title
internally because `publish-docs` is one-shot and does not pass back a
prior `externalUrl` to the adapter (no `doc_sync_state` table at v1).

---

## Confluence vs Jira: the things that bite

If you already wired up the Jira adapter (F1), three Confluence-specific
quirks worth absorbing:

1. **Same Atlassian token, different product surface.** A Jira Cloud API
   token created at `id.atlassian.com` already works for Confluence —
   they are issued against your Atlassian Account, not per-product. You
   do not need to create a second token.
2. **Base URL includes `/wiki`.** Confluence Cloud lives at
   `https://{tenant}.atlassian.net/wiki`, distinct from Jira's
   `https://{tenant}.atlassian.net`. Set `ATELIER_CONFLUENCE_BASE_URL`
   to the wiki-prefixed form; the adapter appends `/rest/api/content/...`
   to it.
3. **Page versioning is monotonic on update.** Every PUT must include
   `version.number = current + 1`. If a concurrent writer (a human
   editing through the Confluence UI, another Atelier process) bumped
   the version between the search and the PUT, the API returns
   409 Conflict. The adapter re-fetches the current version and retries
   up to three times before surfacing the conflict.

---

## One-time setup

### 1. Create an Atlassian API token

In the Atlassian account that should appear as the page author:

1. Visit `https://id.atlassian.com/manage-profile/security/api-tokens`.
2. Click **Create API token**, give it a label (e.g., `atelier-confluence-prod`),
   and copy the token value. You cannot retrieve it later.
3. Note the email address of that Atlassian account — Confluence's
   Basic auth pairs the email with the token (not your password).

If you already have a token from the Jira adapter setup, the **same
token works**. Reuse it.

Treat the token like a password. Rotation procedure mirrors any other
secret in `docs/user/guides/rotate-secrets.md`.

### 2. Find your Confluence base URL and space key

- **Base URL.** Visit your Confluence site. The URL bar will show
  `https://{tenant}.atlassian.net/wiki/...`. Take everything up to and
  including `/wiki`. Trailing slash is optional; the adapter normalizes.
- **Space key.** In the Confluence UI, navigate to the space you want
  Atelier docs to land in. The URL is
  `https://{tenant}.atlassian.net/wiki/spaces/<KEY>/...` — the segment
  after `/spaces/` is the key (uppercase, alphanumeric). It is
  distinct from the space name.

### 3. Set the env vars

The adapter-registry factory reads these at startup. The first three
are required; omit any one and the registry skips Confluence (the script
falls back to whatever adapter you passed via `--adapter`, which is
`noop` by default). The fourth is optional — it provides a default
space key when `publish-docs` runs without `--space`.

```bash
export ATELIER_CONFLUENCE_BASE_URL=https://your-site.atlassian.net/wiki
export ATELIER_CONFLUENCE_EMAIL=you@example.com
export ATELIER_CONFLUENCE_API_TOKEN=<the token from step 1>
export ATELIER_CONFLUENCE_SPACE_KEY=ATL   # optional; default for --space
```

### 4. Tell Atelier which adapter to use

Edit `.atelier/config.yaml`:

```yaml
integrations:
  published_docs:
    kind: confluence
    space_key: ATL
```

`kind: confluence` is what the operator-facing scripts look for; the
registry factory handles the actual instantiation from the env vars
above. The `space_key` value is documentation-only at v1 (the env var
or `--space` flag is what the adapter consumes); keep them in sync so
future tooling reading the YAML sees the same value.

---

## Publish a doc

```bash
ATELIER_DOC_ADAPTER=confluence \
  npx tsx scripts/sync/publish-docs.ts \
    --adapter confluence \
    --space ATL \
    --doc docs/strategic/NORTH-STAR.md
```

What happens, step by step:

1. The script reads `docs/strategic/NORTH-STAR.md`.
2. It derives a page title from the first `# H1` heading (or falls back
   to the file basename without `.md`).
3. It prepends the canonical "edits here will be overwritten" banner.
4. The Confluence adapter searches the space for a page with that
   title (`GET /rest/api/content?spaceKey=ATL&title=...&expand=version`).
5. If a page exists, the adapter `PUT`s an update with
   `version.number = current + 1`. If 409 comes back, it re-fetches the
   current version and retries up to three times.
6. If no page exists, the adapter `POST`s a new page.
7. The script logs the resolved Confluence URL.

A fresh run on a never-published doc creates a new page in your
Confluence space; subsequent runs update the same page in place.

### Dry-run

```bash
npx tsx scripts/sync/publish-docs.ts --adapter confluence --space ATL --doc <path> --dry-run
```

`--dry-run` skips the network round-trip entirely so you can prove the
script discovered the doc and resolved the adapter before trusting it
with a real Confluence write.

---

## Verify the wiring

### Smoke test (no Confluence account required)

```bash
npm run smoke:sync-confluence
```

Expected output:

- `[A] adapter unit tests (mocked fetch)` — all PASS unconditionally.
- `[B] integration with publish-docs.publishDoc()` — all PASS
  unconditionally. (The Confluence smoke does not require a local
  Postgres; `publish-docs.publishDoc()` is one-shot and writes no
  database state directly. Telemetry, when enabled, is written by
  `publish-docs.main()` and is exercised separately when you run the
  script with `ATELIER_PROJECT_ID` set against a reachable database.)

If any check fails, the adapter is broken — do not deploy.

### Force a publish against your real Confluence

After setting the env vars and editing `.atelier/config.yaml`, run a
single dry cycle against the actual Confluence API:

```bash
ATELIER_DOC_ADAPTER=confluence \
  npx tsx scripts/sync/publish-docs.ts \
    --adapter confluence \
    --space ATL \
    --doc docs/methodology/METHODOLOGY.md
```

Visit the Confluence space and look for a page titled "Atelier
Methodology" (or whatever H1 your `METHODOLOGY.md` carries). The page
should open with the banner, then a horizontal rule, then the rest of
the document body.

---

## Operating notes

- **Token never appears in logs.** 401 / 403 responses surface as
  `ConfluenceHttpError: ... authentication failed` with no token, no
  `Authorization` header value, and no Basic-auth-encoded form leaked
  into the message. Other Confluence errors include the response body
  but with token + Basic-auth header value redacted to `***`.
- **API surface: `/rest/api/content`.** The adapter uses the v1 REST
  surface (the only stable surface for Cloud at v1). Confluence v2 REST
  is in beta as of this writing and is not exercised.
- **Body format: storage format (subset of XHTML).** The adapter
  forwards `bodyHtml` from `DocPublishInput` verbatim as
  `body.storage.value` with `representation: 'storage'`. Simple HTML
  elements (`<p>`, `<h1>`–`<h6>`, `<ul>`, `<ol>`, `<li>`, `<a>`,
  `<strong>`, `<em>`, `<code>`, `<pre>`, `<blockquote>`, `<hr/>`) are
  accepted as-is.
- **Banner is XML-escaped, body is not.** The `bannerNote` field gets
  XML-escaped before being wrapped in `<p>...</p>`, so reserved chars
  (`&`, `<`, `>`, `"`, `'`) survive. The `bodyHtml` field is forwarded
  unchanged — the caller is responsible for storage-format-compatible
  HTML.
- **Markdown content from `publish-docs` at v1.** `publish-docs.ts`
  currently passes the raw markdown body into `bodyHtml` (a known v1
  shortcut; the field is named for the eventual format). Until the
  markdown-to-HTML conversion lands inside `publish-docs.ts`,
  Confluence will render markdown source as literal text rather than
  formatted prose. The adapter is built to handle real HTML when that
  conversion lands; no adapter change required at that point.
- **Page upsert is title-keyed.** Because there is no `doc_sync_state`
  table for docs at v1, the adapter searches the space by title on
  every publish to decide create vs update. If you rename the H1
  heading of a canonical doc, the next publish will create a new page
  rather than updating the existing one — clean up the old page in
  Confluence, or rename it in Confluence to match before re-publishing.

---

## Known limitations (v1)

- **No table / image / syntax-highlighted code blocks.** These require
  Confluence-specific `<ac:structured-macro>` markup. The adapter does
  not translate them at v1; if your canonical doc contains a markdown
  table, the published page will show literal pipe characters.
  Workaround: post-edit the page manually after publish, or keep
  table-heavy content in repo-only docs.
- **No `doc_sync_state` table.** Upsert is keyed on `space + title`
  every run; renaming a doc's H1 creates a new Confluence page. Track
  the externalUrl yourself if you need a stable reference.
- **No comment ingestion via this adapter.** F3 implements only the
  `DocAdapter` (write) surface. Comment ingestion (reading discussions
  back into the triage pipeline) is the `CommentSourceAdapter` and is
  out of scope for F3; track this through the triage pipeline once
  that adapter ships.

If you need any of the above sooner than the v1.x roadmap implies,
file a `BRD-OPEN-QUESTIONS` entry per `docs/methodology/METHODOLOGY.md`
section 6.7.

---

## Cross-references

- `scripts/sync/lib/confluence.ts` — the adapter implementation.
- `scripts/sync/lib/adapter-registry.ts` — the env-var-driven registry factory.
- `scripts/sync/__smoke__/confluence.smoke.ts` — smoke harness (`npm run smoke:sync-confluence`).
- `scripts/sync/publish-docs.ts` — the script that drives the adapter.
- `docs/user/integrations/jira.md` — the Jira sibling adapter (F1).
- `docs/user/integrations/linear.md` — the Linear sibling adapter (F2).
- `docs/user/guides/rotate-secrets.md` — rotation procedure shape (apply to the API token).
- `docs/strategic/BUILD-SEQUENCE.md` row F — adapter sequencing (F3 = Confluence).
- BRD §10.4 (US-10.4) — the trace ID this work satisfies.
