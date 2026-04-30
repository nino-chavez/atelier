#!/usr/bin/env -S npx tsx
//
// Build traceability.json by scanning canonical doc sources.
//
// Per scripts/README.md "Structure" + "Traceability registry: graph-ready
// from M1". Closes M1-exit audit follow-up F1: traceability.json's entries[]
// must include individual US-X.Y stories so the validator's trace_id_resolution
// check has something to resolve against, and so the validator's --per-pr
// mode can become a hard CI gate.
//
// Sources scanned:
//   docs/functional/BRD.md                       -> brd-epic + brd-story entries
//   docs/architecture/decisions/ADR-NNN-*.md     -> decision (D<N>) entries
//   docs/functional/BRD-OPEN-QUESTIONS.md        -> open-question entries
//
// Edges emitted (per scripts/README.md "Edge relations at v1"):
//   ADR.trace_id          -> implements          (ADR-N -> BRD:Epic-N or US-X.Y)
//   ADR.reverses          -> supersedes          (ADR-N -> ADR-M)
//   ADR body "Surfaced by ADR-NNN" -> derives_from   (ADR-N -> ADR-NNN; best-effort)
//
// CLI:
//   build-registry [--check]
//     (default)  Rewrite traceability.json with regenerated entries + edges
//     --check    Compare current traceability.json against a fresh build;
//                exit 1 if they differ. Suitable for CI gate.
//
// Drift discipline:
//   - Project metadata ($schema, project_id, project_name, template_version,
//     generated_at) is preserved from the existing file when present.
//   - If a hand-curated entry has a "note" or "status" field that this
//     generator does not derive, the field is preserved on the regenerated
//     entry so authors can attach context that survives rebuilds.
//   - The counts block is recomputed; the prior counts are not preserved.

import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// =========================================================================
// Types
// =========================================================================

interface RegistryEntry {
  id: string;
  label: string;
  kind: 'brd-epic' | 'brd-story' | 'decision' | 'open-question';
  docPath: string;
  docUrl: string;
  prototypePages: string[];
  adr?: string;
  source?: string;
  status?: string;
  note?: string;
}

interface Edge {
  from: string;
  to: string;
  rel: 'implements' | 'depends_on' | 'supersedes' | 'derives_from';
}

interface RegistryFile {
  $schema?: string;
  generated_at: string;
  project_id: string;
  project_name: string;
  template_version: string;
  counts: Record<string, number>;
  entries: RegistryEntry[];
  edges: Edge[];
}

interface AdrFrontmatter {
  id: string;
  trace_id?: string;
  category?: string;
  session?: string;
  composer?: string;
  timestamp?: string;
  reverses?: string;
}

// =========================================================================
// Path helpers
// =========================================================================

function repoRoot(): string {
  // Resolve relative to this file. The script lives at
  // <repo>/scripts/traceability/build-registry.ts, so two levels up.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..');
}

// =========================================================================
// BRD parsing (epics + stories)
// =========================================================================

interface BrdEpic {
  num: number;
  title: string;
  anchor: string;
}

interface BrdStory {
  id: string;       // "US-X.Y"
  title: string;
}

const EPIC_HEADING_RE = /^### Epic (\d+)\s+[—\-]\s+(.+?)\s*$/;
// **US-X.Y - Title** OR **US-X.Y — Title**
const STORY_HEADING_RE = /^\*\*(US-\d+\.\d+)\s+[—\-]\s+(.+?)\*\*\s*$/;

async function loadBrd(repo: string): Promise<{ epics: BrdEpic[]; stories: BrdStory[] }> {
  const path = join(repo, 'docs/functional/BRD.md');
  const raw = await fs.readFile(path, 'utf8');
  const lines = raw.split('\n');
  const epics: BrdEpic[] = [];
  const stories: BrdStory[] = [];
  for (const line of lines) {
    const epicMatch = line.match(EPIC_HEADING_RE);
    if (epicMatch) {
      const num = Number(epicMatch[1]);
      const title = epicMatch[2]!.trim();
      epics.push({ num, title, anchor: githubAnchor(`epic-${num}--${title}`) });
      continue;
    }
    const storyMatch = line.match(STORY_HEADING_RE);
    if (storyMatch) {
      stories.push({ id: storyMatch[1]!, title: storyMatch[2]!.trim() });
    }
  }
  return { epics, stories };
}

function githubAnchor(text: string): string {
  // Lowercase; replace [^a-z0-9-] with '-'; collapse multiple dashes; trim.
  // GitHub-Flavored Markdown anchor algorithm (close enough).
  return (
    '#' +
    text
      .toLowerCase()
      .replace(/[^a-z0-9-\s]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

// =========================================================================
// ADR parsing
// =========================================================================

interface AdrFile {
  id: string;                  // "ADR-NNN"
  num: number;
  filename: string;
  filepath: string;            // repo-relative
  frontmatter: AdrFrontmatter;
  bodyText: string;
  title: string;               // first H1 in body
}

async function loadAdrs(repo: string): Promise<AdrFile[]> {
  const dir = join(repo, 'docs/architecture/decisions');
  const entries = await fs.readdir(dir);
  const files: AdrFile[] = [];
  for (const name of entries) {
    if (!/^ADR-\d{3}-.+\.md$/.test(name)) continue;
    const filepath = join(dir, name);
    const raw = await fs.readFile(filepath, 'utf8');
    const fm = parseAdrFrontmatter(raw);
    if (!fm) continue;
    const num = Number(fm.id.replace(/^ADR-/, ''));
    const bodyText = stripFrontmatter(raw);
    files.push({
      id: fm.id,
      num,
      filename: name,
      filepath: `docs/architecture/decisions/${name}`,
      frontmatter: fm,
      bodyText,
      title: extractAdrTitle(bodyText),
    });
  }
  files.sort((a, b) => a.num - b.num);
  return files;
}

function parseAdrFrontmatter(raw: string): AdrFrontmatter | null {
  if (!raw.startsWith('---\n')) return null;
  const end = raw.indexOf('\n---\n', 4);
  if (end < 0) return null;
  const fmText = raw.slice(4, end);
  const parsed = parseYaml(fmText) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') return null;
  return parsed as unknown as AdrFrontmatter;
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---\n')) return raw;
  const end = raw.indexOf('\n---\n', 4);
  if (end < 0) return raw;
  return raw.slice(end + 5);
}

function extractAdrTitle(body: string): string {
  for (const line of body.split('\n')) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1]!;
  }
  return '(untitled)';
}

// =========================================================================
// BRD-OPEN-QUESTIONS parsing
// =========================================================================

interface OpenQuestion {
  num: number;
  title: string;
  status: 'OPEN' | 'RESOLVED';
}

async function loadOpenQuestions(repo: string): Promise<OpenQuestion[]> {
  const path = join(repo, 'docs/functional/BRD-OPEN-QUESTIONS.md');
  const raw = await fs.readFile(path, 'utf8');
  const lines = raw.split('\n');
  const out: OpenQuestion[] = [];
  let phase: 'OPEN' | 'RESOLVED' = 'OPEN';
  for (const line of lines) {
    if (line.match(/^## Open\b/)) { phase = 'OPEN'; continue; }
    if (line.match(/^## Resolved\b/)) { phase = 'RESOLVED'; continue; }
    // Heading shapes seen in this file:
    //   ### 19 - Plan-review checkpoint between claim and implementation
    //   ### 3 · Embedding-model default + swappability for find_similar
    const m = line.match(/^###\s+(\d+)\s+[\-·—]\s+(.+?)\s*$/);
    if (m) {
      out.push({ num: Number(m[1]), title: m[2]!.trim(), status: phase });
    }
  }
  out.sort((a, b) => a.num - b.num);
  return out;
}

// =========================================================================
// Existing-registry preservation
// =========================================================================

interface ExistingRegistry {
  $schema?: string;
  project_id?: string;
  project_name?: string;
  template_version?: string;
  entries?: Array<Partial<RegistryEntry> & { id: string }>;
}

async function loadExisting(repo: string): Promise<ExistingRegistry | null> {
  const path = join(repo, 'traceability.json');
  try {
    const raw = await fs.readFile(path, 'utf8');
    return JSON.parse(raw) as ExistingRegistry;
  } catch {
    return null;
  }
}

function preservedFields(
  id: string,
  existing: ExistingRegistry | null,
): Pick<RegistryEntry, 'prototypePages' | 'note' | 'status'> {
  const ent = existing?.entries?.find((e) => e.id === id);
  return {
    prototypePages: ent?.prototypePages ?? [],
    ...(ent?.note ? { note: ent.note } : {}),
    ...(ent?.status ? { status: ent.status } : {}),
  };
}

// =========================================================================
// Build entries + edges
// =========================================================================

function buildEntries(
  brd: { epics: BrdEpic[]; stories: BrdStory[] },
  adrs: AdrFile[],
  questions: OpenQuestion[],
  existing: ExistingRegistry | null,
): RegistryEntry[] {
  const entries: RegistryEntry[] = [];

  // BRD epics
  for (const epic of brd.epics) {
    const id = `BRD:Epic-${epic.num}`;
    entries.push({
      id,
      label: epic.title,
      kind: 'brd-epic',
      docPath: 'docs/functional/BRD.md',
      docUrl: epic.anchor,
      ...preservedFields(id, existing),
    });
  }

  // BRD stories
  for (const story of brd.stories) {
    entries.push({
      id: story.id,
      label: story.title,
      kind: 'brd-story',
      docPath: 'docs/functional/BRD.md',
      docUrl: githubAnchor(`${story.id} ${story.title}`),
      ...preservedFields(story.id, existing),
    });
  }

  // Decisions. The registry uses D<N> as the entry id with adr=ADR-NNN
  // (when there's a corresponding ADR file). The D-N sequence is NOT a
  // 1:1 with ADR-NNN -- it's the historical decision-discussion order.
  // Examples in the existing registry:
  //   - D1 -> ADR-001, D17 -> ADR-001 (both decisions covered by one ADR)
  //   - D24 -> no ADR (deferred decision; embedding-model default)
  // The build strategy:
  //   1. Preserve every existing decision entry verbatim (D-N -> ADR mapping
  //      and standalone non-ADR decisions).
  //   2. For any ADR file on disk that has NO existing D-N mapping, allocate
  //      the next D-N in the sequence and emit a new entry.
  // This preserves cross-document citations like "D40" (which maps to ADR-037
  // in the existing registry, NOT ADR-040) while still capturing newly-added
  // ADRs in the registry.
  const existingDecisions = (existing?.entries ?? []).filter((e) => e.kind === 'decision');
  const adrsWithDEntry = new Set<string>();
  for (const e of existingDecisions) {
    if (e.adr) adrsWithDEntry.add(e.adr);
  }
  // Pass 1: preserve existing decisions (in their existing order)
  for (const e of existingDecisions) {
    if (!e.id) continue;
    const adrFile = e.adr ? adrs.find((a) => a.id === e.adr) : undefined;
    entries.push({
      id: e.id,
      label: e.label ?? adrFile?.title ?? '(no label)',
      kind: 'decision',
      docPath: e.docPath ?? adrFile?.filepath ?? '',
      docUrl: e.docUrl ?? '',
      ...(e.adr ? { adr: e.adr } : {}),
      ...(e.source ? { source: e.source } : {}),
      ...(e.status ? { status: e.status } : { status: e.adr ? 'DECIDED' : 'OPEN' }),
      ...(e.note ? { note: e.note } : {}),
      prototypePages: e.prototypePages ?? [],
    });
  }
  // Pass 2: append new D-N entries for ADRs without a mapping
  let nextD = existingDecisions.reduce((max, e) => {
    const m = e.id?.match(/^D(\d+)$/);
    if (!m) return max;
    return Math.max(max, Number(m[1]));
  }, 0);
  for (const adr of adrs) {
    if (adrsWithDEntry.has(adr.id)) continue;
    nextD += 1;
    const dId = `D${nextD}`;
    entries.push({
      id: dId,
      label: adr.title,
      kind: 'decision',
      docPath: adr.filepath,
      docUrl: '',
      adr: adr.id,
      ...(adr.frontmatter.session ? { source: adr.frontmatter.session } : {}),
      status: 'DECIDED',
      ...preservedFields(dId, existing),
    });
  }

  // Open questions
  for (const q of questions) {
    const id = `BRD-OPEN-QUESTIONS:section-${q.num}`;
    entries.push({
      id,
      label: q.title,
      kind: 'open-question',
      docPath: 'docs/functional/BRD-OPEN-QUESTIONS.md',
      docUrl: githubAnchor(`${q.num} ${q.title}`),
      status: q.status,
      ...preservedFields(id, existing),
    });
  }

  return entries;
}

// "Surfaced by" / "Surfaced by ADR-NNN" / "audit ADR-NNN" detection in body.
const ADR_REF_IN_BODY = /\bADR-(\d{3})\b/g;
const SURFACED_BY_RE = /surfaced\s+by\s+(?:the\s+)?([^\.]+?)(?:\.|$)/gi;

function buildEdges(adrs: AdrFile[]): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  const push = (e: Edge): void => {
    const key = `${e.from}|${e.rel}|${e.to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(e);
  };

  for (const adr of adrs) {
    // implements: ADR -> trace_id (which is one of BRD:Epic-N or US-X.Y)
    if (adr.frontmatter.trace_id) {
      push({ from: adr.id, to: adr.frontmatter.trace_id, rel: 'implements' });
    }
    // supersedes: ADR -> ADR-N (the reversed one)
    if (adr.frontmatter.reverses) {
      push({ from: adr.id, to: adr.frontmatter.reverses, rel: 'supersedes' });
    }
    // derives_from: best-effort scan of body for "surfaced by ADR-NNN" /
    // "audit identified ADR-NNN" / explicit mentions of other ADRs in the
    // ADR's prose. We restrict to references that come from a "surfaced by"
    // clause to avoid false positives (any ADR body that mentions another
    // ADR for context would otherwise generate a derives_from edge).
    for (const surfacedMatch of adr.bodyText.matchAll(SURFACED_BY_RE)) {
      const fragment = surfacedMatch[1] ?? '';
      for (const refMatch of fragment.matchAll(ADR_REF_IN_BODY)) {
        const target = `ADR-${refMatch[1]}`;
        if (target === adr.id) continue;
        push({ from: adr.id, to: target, rel: 'derives_from' });
      }
    }
  }

  // Stable order: by from, then rel, then to
  edges.sort((a, b) =>
    a.from === b.from
      ? a.rel === b.rel
        ? a.to.localeCompare(b.to)
        : a.rel.localeCompare(b.rel)
      : a.from.localeCompare(b.from),
  );
  return edges;
}

// =========================================================================
// Counts (per the existing registry shape)
// =========================================================================

function buildCounts(
  brd: { epics: BrdEpic[]; stories: BrdStory[] },
  adrs: AdrFile[],
  questions: OpenQuestion[],
  decisionEntryCount: number,
): Record<string, number> {
  return {
    'brd-epics': brd.epics.length,
    'brd-stories': brd.stories.length,
    decisions: decisionEntryCount,
    'open-questions': questions.length,
    sections: 0,
    'prototype-slices': 0,
    adrs: adrs.length,
  };
}

// =========================================================================
// Output
// =========================================================================

function buildRegistry(
  brd: { epics: BrdEpic[]; stories: BrdStory[] },
  adrs: AdrFile[],
  questions: OpenQuestion[],
  existing: ExistingRegistry | null,
): RegistryFile {
  const entries = buildEntries(brd, adrs, questions, existing);
  const edges = buildEdges(adrs);
  const decisionEntryCount = entries.filter((e) => e.kind === 'decision').length;
  const counts = buildCounts(brd, adrs, questions, decisionEntryCount);
  return {
    $schema: existing?.$schema ?? './scripts/traceability/schema.json',
    generated_at: new Date().toISOString(),
    project_id: existing?.project_id ?? 'atelier-self',
    project_name: existing?.project_name ?? 'Atelier',
    template_version: existing?.template_version ?? '1.0',
    counts,
    entries,
    edges,
  };
}

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
  'id',
  'label',
  'kind',
  'docPath',
  'docUrl',
  'prototypePages',
  'adr',
  'source',
  'status',
  'note',
] as const;

const EDGE_KEY_ORDER = ['from', 'to', 'rel'] as const;

function orderObject<T extends Record<string, unknown>>(
  obj: T,
  keyOrder: ReadonlyArray<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keyOrder) {
    if (k in obj && obj[k] !== undefined) out[k] = obj[k];
  }
  // Append unknown keys (defensive; also preserves any future fields)
  for (const k of Object.keys(obj)) {
    if (!(k in out) && obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

function serialize(registry: RegistryFile): string {
  const ordered = orderObject(registry as unknown as Record<string, unknown>, TOP_LEVEL_KEY_ORDER) as RegistryFile & Record<string, unknown>;
  ordered.entries = registry.entries.map((e) =>
    orderObject(e as unknown as Record<string, unknown>, ENTRY_KEY_ORDER),
  ) as unknown as RegistryEntry[];
  ordered.edges = registry.edges.map((e) =>
    orderObject(e as unknown as Record<string, unknown>, EDGE_KEY_ORDER),
  ) as unknown as Edge[];
  return JSON.stringify(ordered, null, 2) + '\n';
}

// =========================================================================
// CLI
// =========================================================================

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const checkMode = args.has('--check');
  const repo = repoRoot();

  const [brd, adrs, questions, existing] = await Promise.all([
    loadBrd(repo),
    loadAdrs(repo),
    loadOpenQuestions(repo),
    loadExisting(repo),
  ]);

  const registry = buildRegistry(brd, adrs, questions, existing);
  // Stabilize generated_at in --check mode so a no-op rebuild is byte-equal.
  if (checkMode) {
    registry.generated_at = '<check-mode>';
  }
  const serialized = serialize(registry);

  if (checkMode) {
    const existingRaw = existing
      ? JSON.stringify(
          orderObject({ ...existing, generated_at: '<check-mode>' } as Record<string, unknown>, TOP_LEVEL_KEY_ORDER),
          null,
          2,
        ) + '\n'
      : '';
    if (existingRaw !== serialized) {
      console.error('traceability.json drift detected vs scanned sources.');
      console.error('Run: npx tsx scripts/traceability/build-registry.ts');
      process.exit(1);
    }
    console.log(`OK: traceability.json matches sources (${registry.entries.length} entries, ${registry.edges.length} edges)`);
    return;
  }

  const path = join(repo, 'traceability.json');
  await fs.writeFile(path, serialized, 'utf8');
  console.log(`wrote traceability.json: ${registry.entries.length} entries, ${registry.edges.length} edges`);
  console.log(`  brd-epics:      ${registry.counts['brd-epics']}`);
  console.log(`  brd-stories:    ${registry.counts['brd-stories']}`);
  console.log(`  decisions:      ${registry.counts.decisions}`);
  console.log(`  open-questions: ${registry.counts['open-questions']}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
