#!/usr/bin/env -S npx tsx
//
// publish-docs: repo doc -> external doc system (Confluence / Notion).
//
// Per ARCH 6.5:
//   1. Extract sections with trace IDs
//   2. Render to target format
//   3. Prepend "edits here will be overwritten" banner
//   4. PUT to external page (full overwrite)
//   5. Update registry with external URL
//
// M1 scope: skeleton + adapter dispatch + banner-prepend. Section-by-section
// extraction with trace-ID anchors lands at v1.x when a real doc adapter
// (Confluence/Notion) replaces the no-op. M1 publishes each canonical doc
// as one whole-document page so the dispatch path is exercised end-to-end.
//
// CLI:
//   publish-docs --doc <path>...          One or more doc paths to publish
//   publish-docs --adapter <name>         Doc adapter (default noop)
//   publish-docs --space <id>             External space / workspace id
//   publish-docs --dry-run                Skip the upstream PUT

import { promises as fs } from 'node:fs';
import { basename } from 'node:path';
import { Client } from 'pg';
import { resolveDocAdapter } from './lib/adapters.ts';

const BANNER =
  '> Edits here will be overwritten. Atelier is the source of truth for this content.\n> Comment here to propose changes; comments flow back through the triage pipeline.\n\n';

interface Args {
  docs: string[];
  adapter: string;
  space: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    docs: [],
    adapter: process.env.ATELIER_DOC_ADAPTER ?? 'noop',
    space: process.env.ATELIER_DOC_SPACE ?? 'default',
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--doc') args.docs.push(argv[++i]!);
    else if (a === '--adapter') args.adapter = argv[++i]!;
    else if (a === '--space') args.space = argv[++i]!;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: publish-docs --doc <path>... [--adapter NAME] [--space ID] [--dry-run]');
      process.exit(0);
    }
  }
  return args;
}

interface PageRender {
  pageKey: string;
  title: string;
  bodyMarkdown: string;
}

function deriveTitle(markdown: string, fallback: string): string {
  const m = markdown.match(/^#\s+(.+)$/m);
  return m?.[1]?.trim() || fallback;
}

function renderPage(docPath: string, body: string): PageRender {
  const pageKey = docPath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const title = deriveTitle(body, basename(docPath, '.md'));
  return { pageKey, title, bodyMarkdown: BANNER + body };
}

interface PublishResult {
  docPath: string;
  externalUrl: string;
  externalRevision: string;
}

export async function publishDoc(opts: {
  docPath: string;
  adapterName: string;
  space: string;
  dryRun?: boolean;
}): Promise<PublishResult> {
  const { docPath, adapterName, space, dryRun = false } = opts;
  const body = await fs.readFile(docPath, 'utf8');
  const page = renderPage(docPath, body);
  const adapter = resolveDocAdapter(adapterName);

  if (dryRun) {
    return {
      docPath,
      externalUrl: `dry-run://${page.pageKey}`,
      externalRevision: 'dry-run',
    };
  }

  // M1: Markdown -> HTML conversion is a v1.x concern (the adapter receives
  // markdown today; concrete adapters can convert at their own boundary).
  // The DocPublishInput shape names `bodyHtml` to signal eventual format;
  // for M1 + the no-op adapter we pass markdown verbatim.
  const result = await adapter.publishPage({
    externalSpaceId: space,
    pageKey: page.pageKey,
    title: page.title,
    bodyHtml: page.bodyMarkdown,
    bannerNote: BANNER.trim(),
  });
  return {
    docPath,
    externalUrl: result.externalUrl,
    externalRevision: result.externalRevision,
  };
}

async function recordTelemetry(
  db: Client,
  projectId: string,
  results: PublishResult[],
  adapterName: string,
): Promise<void> {
  for (const r of results) {
    await db.query(
      `INSERT INTO telemetry (project_id, action, outcome, metadata)
       VALUES ($1, 'doc.published', 'ok', $2::jsonb)`,
      [
        projectId,
        JSON.stringify({
          docPath: r.docPath,
          externalUrl: r.externalUrl,
          externalRevision: r.externalRevision,
          adapter: adapterName,
        }),
      ],
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.docs.length === 0) {
    console.error('error: at least one --doc <path> is required');
    process.exit(1);
  }

  const results: PublishResult[] = [];
  for (const doc of args.docs) {
    const result = await publishDoc({
      docPath: doc,
      adapterName: args.adapter,
      space: args.space,
      dryRun: args.dryRun,
    });
    results.push(result);
    console.log(`[publish-docs] ${doc} -> ${result.externalUrl}${args.dryRun ? ' (dry-run)' : ''}`);
  }

  // Telemetry requires a project_id; resolution rule for M1 is ATELIER_PROJECT_ID env var.
  const projectId = process.env.ATELIER_PROJECT_ID;
  if (projectId && !args.dryRun) {
    const dbUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      await recordTelemetry(db, projectId, results, args.adapter);
    } finally {
      await db.end();
    }
  }
}

if (process.argv[1]?.endsWith('publish-docs.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { parseArgs, renderPage };
