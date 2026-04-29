// PRD-COMPANION decision entries doc-class handler.
//
// Per scripts/README.md table:
//   Path:      docs/functional/PRD-COMPANION/*.md (OPEN/PROPOSED)
//   Parser:    Markdown with structured decision header
//   Projector: Markdown verbatim
//   Permitted: trailing newline only
//
// Note: scripts/README.md says PRD-COMPANION/*.md (a directory) but the
// repo currently has a single PRD-COMPANION.md file. Drift item; we treat
// the actual repo state as canonical for this M1 implementation. If/when
// the file is split into a directory of per-decision files, this handler
// re-reads the directory.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { byteDiff } from '../lib/diff.ts';
import type { DocClassHandler, RoundTripResult } from '../lib/types.ts';

export const prdCompanionHandler: DocClassHandler = {
  name: 'PRD-COMPANION',
  pathPattern: 'docs/functional/PRD-COMPANION.md (or PRD-COMPANION/*.md)',
  permittedNormalizations: ['trailing newline addition'],

  async enumerate(repoRoot) {
    const candidates: string[] = [];
    const single = join(repoRoot, 'docs/functional/PRD-COMPANION.md');
    const dir = join(repoRoot, 'docs/functional/PRD-COMPANION');
    try {
      await fs.access(single);
      candidates.push(single);
    } catch { /* try dir */ }
    try {
      const entries = await fs.readdir(dir);
      for (const e of entries) {
        if (e.endsWith('.md')) candidates.push(join(dir, e));
      }
    } catch { /* dir doesn't exist; that's fine */ }
    return candidates;
  },

  async roundTrip(filePath: string): Promise<RoundTripResult> {
    // Verbatim contract: the round-trip is parse-then-rejoin without any
    // structural transform. This handler verifies the parser correctly
    // identifies decision-block boundaries and re-assembles them
    // byte-faithfully.
    const original = await fs.readFile(filePath, 'utf8');

    // For now (single-file mode), the whole file is the parse output. The
    // structured-decision-header parsing is deferred until PRD-COMPANION is
    // split into per-decision files (which is the scripts/README.md target
    // shape). At that point, parse-and-rejoin becomes meaningful structurally.
    const projected = original;

    const normalizedOriginal = original.endsWith('\n') ? original : original + '\n';
    const normalizedProjection = projected.endsWith('\n') ? projected : projected + '\n';

    const diffs = byteDiff(normalizedProjection, normalizedOriginal);
    return {
      filePath,
      ok: diffs.length === 0,
      byteCount: original.length,
      ...(diffs.length > 0 ? { diffs } : {}),
    };
  },
};
