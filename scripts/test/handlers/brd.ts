// BRD story regions doc-class handler.
//
// Per scripts/README.md table:
//   Path:      docs/functional/BRD.md US-X.Y blocks
//   Parser:    Markdown headings + structured story format
//   Projector: Markdown verbatim within story bounds
//   Permitted: trailing newline only
//
// Story-block detection: lines that begin with '## US-<digits>.<digits>'
// open a story; the next equivalent heading or end-of-file closes it.
// The verbatim contract means parse-then-rejoin must equal the original
// bytes exactly (modulo trailing newline). The harness verifies this by
// extracting + concatenating the boundary regions and comparing to the
// original block-by-block.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { byteDiff } from '../lib/diff.ts';
import type { DocClassHandler, RoundTripResult } from '../lib/types.ts';

const STORY_HEADING = /^## US-\d+\.\d+(?:\s|$)/;

export const brdHandler: DocClassHandler = {
  name: 'BRD-stories',
  pathPattern: 'docs/functional/BRD.md (US-X.Y blocks)',
  permittedNormalizations: ['trailing newline addition'],

  async enumerate(repoRoot) {
    const path = join(repoRoot, 'docs/functional/BRD.md');
    try {
      await fs.access(path);
      return [path];
    } catch {
      return [];
    }
  },

  async roundTrip(filePath: string): Promise<RoundTripResult> {
    const original = await fs.readFile(filePath, 'utf8');

    // Parse: split into pre-stories prose + an array of story regions.
    const parsed = parseStories(original);

    // Project: reassemble verbatim. The structure carries enough info to
    // reconstruct the source byte-for-byte.
    const projected = parsed.preamble + parsed.stories.join('') + parsed.postamble;

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

interface ParsedBrd {
  preamble: string;     // text before the first story
  stories: string[];    // each ends with the trailing newline before the next heading
  postamble: string;    // text after the last identifiable story (typically empty)
}

function parseStories(text: string): ParsedBrd {
  const lines = text.split('\n');
  const storyStartIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (STORY_HEADING.test(lines[i] ?? '')) storyStartIndices.push(i);
  }

  if (storyStartIndices.length === 0) {
    return { preamble: text, stories: [], postamble: '' };
  }

  const preambleEnd = storyStartIndices[0]!;
  const preamble = lines.slice(0, preambleEnd).join('\n') + (preambleEnd > 0 ? '\n' : '');

  const stories: string[] = [];
  for (let i = 0; i < storyStartIndices.length; i++) {
    const start = storyStartIndices[i]!;
    const end = i + 1 < storyStartIndices.length ? storyStartIndices[i + 1]! : lines.length;
    const block = lines.slice(start, end).join('\n');
    // Append a newline if not the final block (preserves the blank line
    // between stories in the source).
    stories.push(i + 1 < storyStartIndices.length ? block + '\n' : block);
  }

  return { preamble, stories, postamble: '' };
}
