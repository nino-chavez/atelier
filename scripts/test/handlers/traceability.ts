// traceability.json doc-class handler.
//
// Per scripts/README.md table:
//   Path:      traceability.json
//   Parser:    JSON
//   Projector: JSON with 2-space indent, key order matching schema
//   Permitted: trailing newline; key order per schema
//
// The schema's canonical top-level key order is documented in
// scripts/README.md "Traceability registry: graph-ready from M1":
//   $schema, generated_at, project_id, project_name, template_version,
//   counts, entries, edges
//
// Per-entry key order (from scripts/README.md example):
//   id, label, kind, docPath, docUrl, prototypePages
// Per-edge key order:
//   from, to, rel

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { byteDiff } from '../lib/diff.ts';
import type { DocClassHandler, RoundTripResult } from '../lib/types.ts';

const TOP_LEVEL_KEY_ORDER = [
  '$schema',
  'generated_at',
  'project_id',
  'project_name',
  'template_version',
  'counts',
  'entries',
  'edges',
] as const;

const ENTRY_KEY_ORDER = [
  'id', 'label', 'kind', 'docPath', 'docUrl', 'prototypePages',
  'adr', 'source', 'status', 'note',
] as const;
const EDGE_KEY_ORDER = ['from', 'to', 'rel'] as const;

export const traceabilityHandler: DocClassHandler = {
  name: 'traceability',
  pathPattern: 'traceability.json',
  permittedNormalizations: [
    'trailing newline addition',
    'top-level key order canonicalized to [$schema, generated_at, project_id, project_name, template_version, counts, entries, edges]',
    'entry key order canonicalized to [id, label, kind, docPath, docUrl, prototypePages]',
    'edge key order canonicalized to [from, to, rel]',
    '2-space indent',
  ],

  async enumerate(repoRoot) {
    const path = join(repoRoot, 'traceability.json');
    try {
      await fs.access(path);
      return [path];
    } catch {
      return [];
    }
  },

  async roundTrip(filePath: string): Promise<RoundTripResult> {
    const original = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(original) as Record<string, unknown>;

    const reordered = reorderTopLevel(parsed);
    const projected = JSON.stringify(reordered, null, 2) + '\n';
    const normalizedOriginal = original.endsWith('\n') ? original : original + '\n';

    const diffs = byteDiff(projected, normalizedOriginal);
    return {
      filePath,
      ok: diffs.length === 0,
      byteCount: original.length,
      ...(diffs.length > 0 ? { diffs } : {}),
    };
  },
};

function reorderTopLevel(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of TOP_LEVEL_KEY_ORDER) {
    if (k in obj) {
      if (k === 'entries' && Array.isArray(obj[k])) {
        out[k] = (obj[k] as Record<string, unknown>[]).map(reorderEntry);
      } else if (k === 'edges' && Array.isArray(obj[k])) {
        out[k] = (obj[k] as Record<string, unknown>[]).map(reorderEdge);
      } else {
        out[k] = obj[k];
      }
    }
  }
  // Preserve any unknown extra keys at the end (no-data-loss rule)
  for (const k of Object.keys(obj)) {
    if (!(k in out)) out[k] = obj[k];
  }
  return out;
}

function reorderEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ENTRY_KEY_ORDER) if (k in entry) out[k] = entry[k];
  for (const k of Object.keys(entry)) if (!(k in out)) out[k] = entry[k];
  return out;
}

function reorderEdge(edge: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EDGE_KEY_ORDER) if (k in edge) out[k] = edge[k];
  for (const k of Object.keys(edge)) if (!(k in out)) out[k] = edge[k];
  return out;
}
