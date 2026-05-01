// Corpus extractors (ARCH 6.4.2 corpus composition).
//
// Walks the repo and produces a flat list of items the embed pipeline can
// upsert. The taxonomy mirrors ARCH 6.4.2's table verbatim:
//
//   | source_kind        | granularity                           |
//   | decision           | one row per ADR file                  |
//   | brd_section        | one row per BRD story (US-X.Y block)  |
//   | prd_section        | one row per top-level PRD section     |
//   | research_artifact  | one row per file under research/      |
//   | contribution       | one row per merged contribution (DB)  |
//
// Contributions are NOT extracted from disk; they are DB-resident, so the
// inline-merge embed path in write.ts (M5+ work) handles them directly.
// This module covers the four file-resident kinds.
//
// Trace ID extraction:
//   - Decisions: ADR's frontmatter `trace_id` field + `id` (e.g. ADR-006).
//     Where the ADR has a `reverses:` field, both ADR ids land in trace_ids.
//   - BRD sections: parsed from US-X.Y heading + the surrounding epic
//     identifier (BRD:Epic-N).
//   - PRD sections: section headings carry no canonical trace IDs at v1;
//     trace_ids stays empty. Adopters who add front-matter trace_ids per
//     section can extend this extractor.
//   - Research artifacts: parsed from the file's frontmatter `trace_ids`
//     field if present; otherwise empty.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import matter from 'gray-matter';

import type { EmbeddingSourceKind } from './embed-pipeline.ts';

// ===========================================================================
// Output type
// ===========================================================================

export interface ExtractedItem {
  sourceKind: EmbeddingSourceKind;
  sourceRef: string;       // repo-relative path or table+id reference
  contentText: string;
  traceIds: string[];
}

// ===========================================================================
// Decisions (ADR files)
// ===========================================================================

/**
 * Walk docs/architecture/decisions/ADR-NNN-*.md and produce one item per
 * ADR. Trace IDs include the ADR's own id, the trace_id frontmatter field,
 * and any `reverses:` reference.
 */
export function extractDecisions(repoRoot: string): ExtractedItem[] {
  const dir = join(repoRoot, 'docs', 'architecture', 'decisions');
  if (!existsSync(dir)) return [];
  const items: ExtractedItem[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.startsWith('ADR-') || !entry.endsWith('.md')) continue;
    const path = join(dir, entry);
    const raw = readFileSync(path, 'utf8');
    const parsed = matter(raw);
    const frontmatter = parsed.data as Record<string, unknown>;
    const id = (frontmatter['id'] as string | undefined) ?? entry.replace(/\.md$/, '');
    const traceIds = collectAdrTraceIds(id, frontmatter);
    // content_text = full body (frontmatter parsed but we want it included
    // for embedding so the embedder can reason about author/category etc.)
    items.push({
      sourceKind: 'decision',
      sourceRef: relative(repoRoot, path),
      contentText: raw,
      traceIds,
    });
  }
  return items;
}

function collectAdrTraceIds(id: string, frontmatter: Record<string, unknown>): string[] {
  const set = new Set<string>([id]);
  const traceIdField = frontmatter['trace_id'];
  if (typeof traceIdField === 'string' && traceIdField.length > 0) {
    set.add(traceIdField);
  } else if (Array.isArray(traceIdField)) {
    for (const t of traceIdField) {
      if (typeof t === 'string' && t.length > 0) set.add(t);
    }
  }
  const reverses = frontmatter['reverses'];
  if (typeof reverses === 'string' && reverses.length > 0) set.add(reverses);
  return Array.from(set);
}

// ===========================================================================
// BRD sections
// ===========================================================================

/**
 * Parse docs/functional/BRD.md and produce one item per US-X.Y block.
 * Each block runs from the US heading to the next US heading or to the
 * next non-US H2/H3, whichever comes first.
 *
 * Trace IDs include the US-X.Y itself + BRD:Epic-X.
 */
export function extractBrdSections(repoRoot: string): ExtractedItem[] {
  const path = join(repoRoot, 'docs', 'functional', 'BRD.md');
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n');
  const items: ExtractedItem[] = [];
  let currentEpic: string | null = null;
  let currentStory: { id: string; epic: string; lines: string[]; startLine: number } | null = null;

  const flush = () => {
    if (!currentStory) return;
    const text = currentStory.lines.join('\n').trim();
    if (text.length > 0) {
      items.push({
        sourceKind: 'brd_section',
        sourceRef: `docs/functional/BRD.md#${currentStory.id}`,
        contentText: text,
        traceIds: [currentStory.id, currentStory.epic],
      });
    }
    currentStory = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const epicMatch = line.match(/^#+\s.*Epic\s+(\d+)/i);
    if (epicMatch && epicMatch[1]) {
      currentEpic = `BRD:Epic-${epicMatch[1]}`;
    }
    const storyMatch = line.match(/^#+\s.*\b(US-\d+\.\d+)\b/);
    if (storyMatch && storyMatch[1]) {
      flush();
      currentStory = {
        id: storyMatch[1],
        epic: currentEpic ?? `BRD:Epic-${storyMatch[1].split('.')[0]!.replace('US-', '')}`,
        lines: [line],
        startLine: i,
      };
      continue;
    }
    if (currentStory) {
      // End the story when a sibling heading at same-or-higher level appears
      // without a US- token. We approximate by stopping when a top-level
      // (#) or epic heading shows up; finer parsing is a v1.x improvement.
      const isHeading = /^#+\s/.test(line);
      if (isHeading && epicMatch) {
        flush();
        continue;
      }
      currentStory.lines.push(line);
    }
  }
  flush();
  return items;
}

// ===========================================================================
// PRD sections
// ===========================================================================

/**
 * Parse docs/functional/PRD.md and produce one item per top-level (H2)
 * section. PRD section headings carry no canonical trace IDs at v1;
 * trace_ids stays empty.
 */
export function extractPrdSections(repoRoot: string): ExtractedItem[] {
  const path = join(repoRoot, 'docs', 'functional', 'PRD.md');
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  return splitByH2(raw, 'docs/functional/PRD.md').map((section) => ({
    sourceKind: 'prd_section' as const,
    sourceRef: section.sourceRef,
    contentText: section.text,
    traceIds: [],
  }));
}

function splitByH2(raw: string, repoRelativePath: string): Array<{ text: string; sourceRef: string }> {
  const lines = raw.split('\n');
  const sections: Array<{ text: string; sourceRef: string }> = [];
  let current: { heading: string; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.lines.join('\n').trim();
    if (text.length > 0) {
      const slug = current.heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      sections.push({ text, sourceRef: `${repoRelativePath}#${slug}` });
    }
    current = null;
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2 && h2[1]) {
      flush();
      current = { heading: h2[1], lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  return sections;
}

// ===========================================================================
// Research artifacts
// ===========================================================================

/**
 * Walk research/ and produce one item per markdown file. Trace IDs come
 * from the file's frontmatter `trace_ids` array (if present); otherwise
 * empty.
 */
export function extractResearchArtifacts(repoRoot: string): ExtractedItem[] {
  const dir = join(repoRoot, 'research');
  if (!existsSync(dir)) return [];
  const items: ExtractedItem[] = [];
  walkMarkdown(dir, (path) => {
    const raw = readFileSync(path, 'utf8');
    const parsed = matter(raw);
    const frontmatter = parsed.data as Record<string, unknown>;
    const traceIds: string[] = [];
    const tids = frontmatter['trace_ids'];
    if (Array.isArray(tids)) {
      for (const t of tids) {
        if (typeof t === 'string' && t.length > 0) traceIds.push(t);
      }
    }
    items.push({
      sourceKind: 'research_artifact',
      sourceRef: relative(repoRoot, path),
      contentText: raw,
      traceIds,
    });
  });
  return items;
}

function walkMarkdown(dir: string, visit: (filePath: string) => void): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkMarkdown(full, visit);
    } else if (st.isFile() && entry.endsWith('.md')) {
      visit(full);
    }
  }
}

// ===========================================================================
// All-in-one
// ===========================================================================

/**
 * Run all four file-resident extractors against repoRoot. Used by the
 * embed-runner CLI bootstrap path + the eval harness seed builder.
 */
export function extractFullCorpus(repoRoot: string): ExtractedItem[] {
  const root = resolve(repoRoot);
  return [
    ...extractDecisions(root),
    ...extractBrdSections(root),
    ...extractPrdSections(root),
    ...extractResearchArtifacts(root),
  ];
}
