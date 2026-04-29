// ADR doc-class handler.
//
// Per scripts/README.md table:
//   Path:     docs/architecture/decisions/ADR-NNN-*.md
//   Parser:   YAML frontmatter + Markdown body
//   Projector: YAML frontmatter (key order: id, trace_id, category, session,
//              composer, timestamp, reverses?) + Markdown body verbatim
//   Permitted: trailing newline addition; YAML key order canonicalized
//
// The "datastore" representation here is just the parsed object. We never
// actually round-trip through Postgres for ADRs; the repo IS canonical for
// decisions per ADR-005.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { byteDiff } from '../lib/diff.ts';
import type { DocClassHandler, RoundTripResult } from '../lib/types.ts';

const KEY_ORDER = ['id', 'trace_id', 'category', 'session', 'composer', 'timestamp', 'reverses'] as const;

export const adrHandler: DocClassHandler = {
  name: 'ADR',
  pathPattern: 'docs/architecture/decisions/ADR-NNN-*.md',
  permittedNormalizations: [
    'trailing newline addition',
    'YAML frontmatter key order canonicalized to [id, trace_id, category, session, composer, timestamp, reverses]',
  ],

  async enumerate(repoRoot) {
    const dir = join(repoRoot, 'docs/architecture/decisions');
    const entries = await fs.readdir(dir);
    return entries
      .filter((e) => /^ADR-\d{3}-.+\.md$/.test(e) && e !== 'README.md')
      .map((e) => join(dir, e));
  },

  async roundTrip(filePath: string): Promise<RoundTripResult> {
    const original = await fs.readFile(filePath, 'utf8');
    const split = splitFrontmatter(original);
    if (split === null) {
      return { filePath, ok: false, byteCount: original.length, diffs: [{
        offsetHex: '0x000000',
        expectedHex: '0x2d',  // '-'
        gotHex: '<no frontmatter>',
        context: 'ADR file is missing the YAML frontmatter delimiters (--- ... ---)',
      }] };
    }

    // Parse phase
    const fm = parseYaml(split.frontmatter) as Record<string, unknown>;
    const body = split.body;

    // Project phase: emit frontmatter in canonical key order
    const ordered: Record<string, unknown> = {};
    for (const k of KEY_ORDER) {
      if (k in fm) ordered[k] = fm[k];
    }
    // Any keys not in the canonical list are appended (preserves data)
    for (const k of Object.keys(fm)) {
      if (!(k in ordered)) ordered[k] = fm[k];
    }

    const projectedFrontmatter = stringifyYaml(ordered, { lineWidth: 0 }).trimEnd();
    const projected = `---\n${projectedFrontmatter}\n---\n${body.startsWith('\n') ? body : '\n' + body}`;

    // Normalize the original (apply permitted normalizations) before compare
    const normalizedOriginal = applyNormalizations(original);
    const normalizedProjection = applyNormalizations(projected);

    const diffs = byteDiff(normalizedProjection, normalizedOriginal);
    return {
      filePath,
      ok: diffs.length === 0,
      byteCount: original.length,
      ...(diffs.length > 0 ? { diffs } : {}),
    };
  },
};

interface FrontmatterSplit {
  frontmatter: string;
  body: string;
}

function splitFrontmatter(text: string): FrontmatterSplit | null {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return null;
  return {
    frontmatter: text.slice(4, end),
    body: text.slice(end + 5),
  };
}

function applyNormalizations(text: string): string {
  // Ensure trailing newline (the only whitespace normalization permitted)
  return text.endsWith('\n') ? text : text + '\n';
}
