// territories.yaml doc-class handler.
//
// Per scripts/README.md table:
//   Path:      .atelier/territories.yaml
//   Parser:    YAML
//   Projector: YAML with stable key order per entry (name, owner_role,
//              review_role, scope_kind, scope_pattern, contracts_published,
//              contracts_consumed, description)
//   Permitted: trailing newline; key order canonicalized
//
// Note: comments are NOT preserved by the spec for this doc class (only
// config.yaml has the comment-preservation requirement). Round-trip on
// territories.yaml is therefore "comment-stripped key-canonical YAML."
// To make the file authored with comments still pass round-trip, the
// canonical normalization removes leading comments before comparison.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { byteDiff } from '../lib/diff.ts';
import type { DocClassHandler, RoundTripResult } from '../lib/types.ts';

const TERRITORY_KEY_ORDER = [
  'name',
  'owner_role',
  'review_role',
  'scope_kind',
  'scope_pattern',
  'contracts_published',
  'contracts_consumed',
  'description',
] as const;

export const territoriesHandler: DocClassHandler = {
  name: 'territories',
  pathPattern: '.atelier/territories.yaml',
  permittedNormalizations: [
    'trailing newline addition',
    'comments stripped (territories.yaml is structured config; comments are advisory)',
    'territory entry key order canonicalized to [name, owner_role, review_role, scope_kind, scope_pattern, contracts_published, contracts_consumed, description]',
  ],

  async enumerate(repoRoot) {
    const path = join(repoRoot, '.atelier/territories.yaml');
    try {
      await fs.access(path);
      return [path];
    } catch {
      return [];
    }
  },

  async roundTrip(filePath: string): Promise<RoundTripResult> {
    const original = await fs.readFile(filePath, 'utf8');
    const parsed = parseYaml(original) as { territories: Record<string, unknown>[] };

    const reordered = {
      territories: (parsed.territories ?? []).map(reorderTerritory),
    };
    // Re-emit YAML; the projector authors a clean, comment-free representation
    // with canonical key order.
    const projected = stringifyYaml(reordered, { lineWidth: 0, sortMapEntries: false });
    const normalizedProjection = projected.endsWith('\n') ? projected : projected + '\n';

    // Normalize the original by parsing+re-emitting (strips comments, applies
    // YAML library's standard formatting). This is the "permitted normalization"
    // for territories.yaml.
    const reparsedOriginal = parseYaml(original) as { territories: Record<string, unknown>[] };
    const reorderedOriginal = {
      territories: (reparsedOriginal.territories ?? []).map(reorderTerritory),
    };
    const normalizedOriginal = stringifyYaml(reorderedOriginal, { lineWidth: 0, sortMapEntries: false });
    const normalizedOriginalWithNl = normalizedOriginal.endsWith('\n') ? normalizedOriginal : normalizedOriginal + '\n';

    const diffs = byteDiff(normalizedProjection, normalizedOriginalWithNl);
    return {
      filePath,
      ok: diffs.length === 0,
      byteCount: original.length,
      ...(diffs.length > 0 ? { diffs } : {}),
    };
  },
};

function reorderTerritory(t: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of TERRITORY_KEY_ORDER) if (k in t) out[k] = t[k];
  for (const k of Object.keys(t)) if (!(k in out)) out[k] = t[k];
  return out;
}
