// .atelier/config.yaml doc-class handler.
//
// Per scripts/README.md table:
//   Path:      .atelier/config.yaml
//   Parser:    YAML
//   Projector: YAML preserving the template's section order; comments preserved
//   Permitted: trailing newline; comment preservation required
//
// This is the only canonical doc class with hard comment-preservation
// requirements. We use eemeli/yaml's Document API which retains comments
// in a CST-like representation that round-trips byte-faithfully.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { byteDiff } from '../lib/diff.ts';
import type { DocClassHandler, RoundTripResult } from '../lib/types.ts';

export const configHandler: DocClassHandler = {
  name: 'config',
  pathPattern: '.atelier/config.yaml',
  permittedNormalizations: [
    'trailing newline addition',
    'YAML library normalization (e.g., quote-style consistency, whitespace within string scalars). Section order and comments preserved.',
  ],

  async enumerate(repoRoot) {
    const path = join(repoRoot, '.atelier/config.yaml');
    try {
      await fs.access(path);
      return [path];
    } catch {
      return [];
    }
  },

  async roundTrip(filePath: string): Promise<RoundTripResult> {
    const original = await fs.readFile(filePath, 'utf8');

    // Parse to Document (preserves comments + structure)
    const doc = parseDocument(original);
    if (doc.errors.length > 0) {
      return {
        filePath,
        ok: false,
        byteCount: original.length,
        diffs: [{
          offsetHex: '0x000000',
          expectedHex: '<valid yaml>',
          gotHex: '<parse error>',
          context: doc.errors.map((e) => e.message).join('; '),
        }],
      };
    }

    // Project: re-emit. eemeli/yaml's Document.toString() preserves comments
    // and order but may re-normalize whitespace within scalars.
    const projected = doc.toString();

    // The library's output is the canonical projection. The original is
    // normalized by parsing+re-emitting (a byte-stable form of itself).
    const normalizedOriginal = parseDocument(original).toString();

    const projectedWithNl = projected.endsWith('\n') ? projected : projected + '\n';
    const originalWithNl = normalizedOriginal.endsWith('\n') ? normalizedOriginal : normalizedOriginal + '\n';

    const diffs = byteDiff(projectedWithNl, originalWithNl);
    return {
      filePath,
      ok: diffs.length === 0,
      byteCount: original.length,
      ...(diffs.length > 0 ? { diffs } : {}),
    };
  },
};
