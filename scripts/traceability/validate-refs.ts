#!/usr/bin/env -S npx tsx
//
// Extended traceability validator (M1 scope).
//
// Per scripts/README.md "Extended cross-doc consistency". Catches drift
// between citations and their canonical homes before it accumulates.
//
// CLI:
//   validate-refs [--per-pr | --milestone-exit | --diff | --staged] [--json]
//
// Check classes implemented at M1:
//   trace_id_resolution       Every cited trace ID resolves in traceability.json
//   adr_id_resolution         Every "ADR-NNN" reference resolves to a real file
//   frontmatter_validation    ADRs have required fields; `reverses` resolves
//   markdown_link_integrity   Every relative markdown link resolves
//   arch_section_resolution   Every "section X.Y" reference resolves to a heading
//   walk_fold_resolution      Every "folded into" reference resolves
//   traceability_coverage     Every BRD story has at least one ADR/contribution citing it
//   open_questions_hygiene    Lists OPEN entries (gap-vs-question is judgment; M1 reports)
//   adr_reeval_trigger_check  Lists ADRs with `Re-evaluation triggers` for architect review
//
// Mode -> check set:
//   --per-pr          trace_id, adr_id, frontmatter, markdown_link, arch_section,
//                     walk_fold (fast set; CI gate)
//   --milestone-exit  per-pr + traceability_coverage + open_questions_hygiene
//                     + adr_reeval_trigger_check
//   --diff / --staged subset scoped to changed files (M1 implementation: same
//                     check classes as --per-pr; scope filtering uses git)
//
// Out of scope at M1:
//   contract_name_resolution      Contracts surface lands at M2 / M2.5
//   operational_completeness      Requires .atelier/config.yaml: review.validator
//                                 .operational_completeness_map; not yet declared

import { promises as fs } from 'node:fs';
import { join, relative, dirname, resolve, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

// =========================================================================
// Types
// =========================================================================

interface CheckIssue {
  source: string;          // file path (or "-" if N/A)
  line?: number;
  message: string;
  suggestions?: string[];
}

interface CheckResult {
  name: string;
  status: 'OK' | 'FAIL' | 'INFO';
  count: number;            // checked count
  issues: CheckIssue[];
}

interface RegistryEntry {
  id: string;
  label: string;
  kind: string;
  docPath?: string;
  adr?: string;
}

interface AdrFrontmatter {
  id: string;
  trace_id: string;
  category: string;
  session: string;
  composer: string;
  timestamp: string;
  reverses?: string;
}

// =========================================================================
// Loaders
// =========================================================================

const REQUIRED_ADR_FIELDS = ['id', 'trace_id', 'category', 'session', 'composer', 'timestamp'] as const;

async function loadTraceability(repoRoot: string): Promise<{
  entries: RegistryEntry[];
  ids: Set<string>;
  adrEntries: Map<string, RegistryEntry>;  // keyed by adr_id (e.g. "ADR-001")
}> {
  const raw = await fs.readFile(join(repoRoot, 'traceability.json'), 'utf8');
  const parsed = JSON.parse(raw) as { entries: RegistryEntry[] };
  const ids = new Set(parsed.entries.map((e) => e.id));
  const adrEntries = new Map<string, RegistryEntry>();
  for (const entry of parsed.entries) {
    if (entry.adr) adrEntries.set(entry.adr, entry);
  }
  return { entries: parsed.entries, ids, adrEntries };
}

async function loadAdrFiles(repoRoot: string): Promise<Map<string, { path: string; frontmatter: AdrFrontmatter; raw: string }>> {
  const dir = join(repoRoot, 'docs/architecture/decisions');
  const entries = await fs.readdir(dir);
  const out = new Map<string, { path: string; frontmatter: AdrFrontmatter; raw: string }>();
  for (const e of entries) {
    if (!/^ADR-\d{3}-.+\.md$/.test(e)) continue;
    const path = join(dir, e);
    const raw = await fs.readFile(path, 'utf8');
    const fm = extractFrontmatter(raw);
    if (fm) out.set(fm.id, { path, frontmatter: fm, raw });
  }
  return out;
}

function extractFrontmatter(text: string): AdrFrontmatter | null {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return null;
  const fmText = text.slice(4, end);
  const parsed = parseYaml(fmText) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') return null;
  return parsed as unknown as AdrFrontmatter;
}

async function loadArchHeadings(repoRoot: string): Promise<Set<string>> {
  // Returns a set of section identifiers like "1", "1.1", "5.3", "6.2.2.1"
  const path = join(repoRoot, 'docs/architecture/ARCHITECTURE.md');
  const raw = await fs.readFile(path, 'utf8');
  const out = new Set<string>();
  for (const line of raw.split('\n')) {
    const m = line.match(/^#{1,6}\s+(\d+(?:\.\d+)*)\b/);
    if (m && m[1]) out.add(m[1]);
  }
  return out;
}

// =========================================================================
// Walker -- enumerate canonical doc files and extract per-file citations
// =========================================================================

interface FileCitations {
  path: string;
  traceIds: { id: string; line: number }[];
  adrRefs: { id: string; line: number }[];
  archSections: { section: string; line: number }[];
  walkFolds: { section: string; line: number }[];
  markdownLinks: { target: string; line: number }[];
}

const TRACE_ID_RE = /\b(?:US-\d+\.\d+|BRD:Epic-\d+|D\d+|NF-\d+)\b/g;
const ADR_REF_RE = /\bADR-(\d{3})\b/g;
// ARCH section refs require explicit ARCH context. Plain "section X.Y" without
// the ARCH/ARCHITECTURE word is ambiguous and frequently means METHODOLOGY,
// PRD, or BRD section X.Y. Per scripts/README.md "in a context that names ARCH".
const ARCH_SECTION_RE = /\bARCH(?:ITECTURE)?(?:\.md)?\s+(?:section\s+)?(\d+(?:\.\d+)+)\b/gi;
const WALK_FOLD_RE = /folded(?:\s+into)?\s+(?:ARCH\s+)?section\s+(\d+(?:\.\d+)+)/gi;
const MD_LINK_RE = /\[[^\]]+\]\(([^)]+)\)/g;

const WALK_DIRS = [
  'docs',
  'research',
  '.atelier',
];

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'supabase', 'scripts/test/__fixtures__',
]);

// Path-prefix exclusions applied even in --diff/--staged mode (where SKIP_DIRS
// doesn't fire because we walk the diff scope, not WALK_DIRS). Test fixtures
// + external corpora are committed for reproducibility but their content is
// authored elsewhere and shouldn't be subject to Atelier's canonical-doc
// validation rules (e.g., external corpora frequently link to provider doc
// sites with site-relative paths the validator can't resolve).
const SKIP_PATH_PREFIXES: readonly string[] = [
  'atelier/eval/find_similar/external-corpora/',
];

function shouldSkipPath(repoRelative: string): boolean {
  return SKIP_PATH_PREFIXES.some((prefix) => repoRelative.startsWith(prefix));
}

async function walkRepo(repoRoot: string, scope?: 'all' | string[]): Promise<FileCitations[]> {
  const out: FileCitations[] = [];

  if (Array.isArray(scope)) {
    for (const p of scope) {
      if (shouldSkipPath(p)) continue;
      const abs = resolve(repoRoot, p);
      if (!abs.endsWith('.md')) continue;
      try {
        await fs.access(abs);
        out.push(await extractCitations(abs, repoRoot));
      } catch { /* file removed in diff; skip */ }
    }
    return out;
  }

  for (const sub of WALK_DIRS) {
    const dir = join(repoRoot, sub);
    try {
      await visit(dir, repoRoot, out);
    } catch (err) {
      // Directory missing is fine for scoped repos; warn for diagnostics.
      if (process.env.DEBUG_VALIDATOR) console.error(`[validate-refs] skipping ${sub}: ${err}`);
    }
  }
  // Also include root-level markdown
  const rootEntries = await fs.readdir(repoRoot);
  for (const e of rootEntries) {
    if (e.endsWith('.md')) {
      out.push(await extractCitations(join(repoRoot, e), repoRoot));
    }
  }
  return out;
}

async function visit(dir: string, repoRoot: string, out: FileCitations[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const path = join(dir, e.name);
    const rel = relative(repoRoot, path);
    if (SKIP_DIRS.has(rel) || rel.split('/').some((seg) => SKIP_DIRS.has(seg))) continue;
    if (e.isDirectory()) {
      await visit(path, repoRoot, out);
    } else if (e.isFile() && (e.name.endsWith('.md') || e.name === 'CLAUDE.md')) {
      out.push(await extractCitations(path, repoRoot));
    }
  }
}

async function extractCitations(absPath: string, repoRoot: string): Promise<FileCitations> {
  const raw = await fs.readFile(absPath, 'utf8');
  const lines = raw.split('\n');
  const fc: FileCitations = {
    path: relative(repoRoot, absPath),
    traceIds: [],
    adrRefs: [],
    archSections: [],
    walkFolds: [],
    markdownLinks: [],
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineNo = i + 1;

    for (const m of line.matchAll(TRACE_ID_RE)) {
      fc.traceIds.push({ id: m[0], line: lineNo });
    }
    for (const m of line.matchAll(ADR_REF_RE)) {
      const id = `ADR-${m[1]}`;
      fc.adrRefs.push({ id, line: lineNo });
    }
    for (const m of line.matchAll(ARCH_SECTION_RE)) {
      fc.archSections.push({ section: m[1]!, line: lineNo });
    }
    for (const m of line.matchAll(WALK_FOLD_RE)) {
      fc.walkFolds.push({ section: m[1]!, line: lineNo });
    }
    for (const m of line.matchAll(MD_LINK_RE)) {
      const target = m[1]!;
      // Skip URLs and absolute paths; we only check relative-path links.
      if (/^([a-z][a-z0-9+.-]*):/i.test(target) || target.startsWith('#')) continue;
      fc.markdownLinks.push({ target, line: lineNo });
    }
  }

  return fc;
}

// =========================================================================
// Checks
// =========================================================================

function checkTraceIdResolution(citations: FileCitations[], known: Set<string>): CheckResult {
  const issues: CheckIssue[] = [];
  let count = 0;
  for (const fc of citations) {
    for (const t of fc.traceIds) {
      count += 1;
      if (!known.has(t.id)) {
        issues.push({
          source: fc.path,
          line: t.line,
          message: `Trace ID "${t.id}" does not resolve in traceability.json`,
        });
      }
    }
  }
  return { name: 'trace_id_resolution', status: issues.length === 0 ? 'OK' : 'FAIL', count, issues };
}

function checkAdrIdResolution(
  citations: FileCitations[],
  adrFiles: Map<string, unknown>,
): CheckResult {
  const issues: CheckIssue[] = [];
  let count = 0;
  for (const fc of citations) {
    for (const a of fc.adrRefs) {
      count += 1;
      if (!adrFiles.has(a.id)) {
        issues.push({
          source: fc.path,
          line: a.line,
          message: `${a.id} referenced but no file under docs/architecture/decisions/ matches`,
        });
      }
    }
  }
  return { name: 'adr_id_resolution', status: issues.length === 0 ? 'OK' : 'FAIL', count, issues };
}

function checkFrontmatterValidation(
  adrFiles: Map<string, { path: string; frontmatter: AdrFrontmatter }>,
): CheckResult {
  const issues: CheckIssue[] = [];
  let count = 0;
  for (const [id, { path, frontmatter }] of adrFiles) {
    count += 1;
    for (const field of REQUIRED_ADR_FIELDS) {
      if (!(field in frontmatter) || frontmatter[field as keyof AdrFrontmatter] === undefined || frontmatter[field as keyof AdrFrontmatter] === '') {
        issues.push({
          source: path,
          message: `${id} frontmatter missing required field "${field}"`,
        });
      }
    }
    if (frontmatter.id !== id) {
      issues.push({
        source: path,
        message: `frontmatter id="${frontmatter.id}" does not match filename ID "${id}"`,
      });
    }
    if (frontmatter.reverses && !adrFiles.has(frontmatter.reverses)) {
      issues.push({
        source: path,
        message: `${id} reverses="${frontmatter.reverses}" but that ADR file does not exist`,
        suggestions: [`Verify the reversed ADR id; it must match an existing ADR-NNN-*.md filename`],
      });
    }
  }
  return { name: 'frontmatter_validation', status: issues.length === 0 ? 'OK' : 'FAIL', count, issues };
}

function checkAdrIndexAlignment(
  adrFiles: Map<string, { path: string }>,
  adrEntries: Map<string, RegistryEntry>,
): CheckResult {
  // Bidirectional cross-check between ADR files on disk and the
  // traceability.json entries that claim adr=<ADR-NNN>.
  const issues: CheckIssue[] = [];
  let count = 0;

  // Files without index entry
  for (const [id, info] of adrFiles) {
    count += 1;
    if (!adrEntries.has(id)) {
      issues.push({
        source: info.path,
        message: `${id} file exists on disk but has no entry in traceability.json (no entry has adr="${id}")`,
        suggestions: ['Re-run scripts/traceability/build-registry to derive entries from ADR frontmatter'],
      });
    }
  }
  // Index entries without file
  for (const [adrId, entry] of adrEntries) {
    if (!adrFiles.has(adrId)) {
      issues.push({
        source: 'traceability.json',
        message: `entry "${entry.id}" references adr="${adrId}" but no ADR file with that id exists`,
        suggestions: ['Either restore the ADR file or remove the stale entry'],
      });
    }
  }

  return { name: 'adr_index_alignment', status: issues.length === 0 ? 'OK' : 'FAIL', count, issues };
}

function checkArchSectionResolution(
  citations: FileCitations[],
  archHeadings: Set<string>,
): CheckResult {
  const issues: CheckIssue[] = [];
  let count = 0;
  for (const fc of citations) {
    for (const s of fc.archSections) {
      count += 1;
      if (!archHeadings.has(s.section)) {
        issues.push({
          source: fc.path,
          line: s.line,
          message: `References ARCH section ${s.section} but ARCHITECTURE.md has no such heading`,
          suggestions: nearestHeadingSuggestion(s.section, archHeadings),
        });
      }
    }
  }
  return { name: 'arch_section_resolution', status: issues.length === 0 ? 'OK' : 'FAIL', count, issues };
}

function checkWalkFoldResolution(
  citations: FileCitations[],
  archHeadings: Set<string>,
): CheckResult {
  const issues: CheckIssue[] = [];
  let count = 0;
  for (const fc of citations) {
    if (!fc.path.includes('walks/')) continue;
    for (const s of fc.walkFolds) {
      count += 1;
      if (!archHeadings.has(s.section)) {
        issues.push({
          source: fc.path,
          line: s.line,
          message: `Walk references "folded into section ${s.section}" but no such ARCH heading exists`,
        });
      }
    }
  }
  return { name: 'walk_fold_resolution', status: issues.length === 0 ? 'OK' : 'FAIL', count, issues };
}

async function checkMarkdownLinkIntegrity(
  citations: FileCitations[],
  repoRoot: string,
): Promise<CheckResult> {
  const issues: CheckIssue[] = [];
  let count = 0;
  for (const fc of citations) {
    for (const link of fc.markdownLinks) {
      count += 1;
      const target = link.target.split('#')[0]; // strip anchor
      if (!target) continue;                    // pure anchor
      const fileDir = dirname(join(repoRoot, fc.path));
      const targetAbs = resolve(fileDir, target);
      try {
        await fs.access(targetAbs);
      } catch {
        issues.push({
          source: fc.path,
          line: link.line,
          message: `Relative link "${link.target}" does not resolve to an existing file`,
        });
      }
    }
  }
  return { name: 'markdown_link_integrity', status: issues.length === 0 ? 'OK' : 'FAIL', count, issues };
}

function checkTraceabilityCoverage(
  registry: { entries: RegistryEntry[] },
  citations: FileCitations[],
): CheckResult {
  // Every BRD story (kind=brd-story) must be cited by at least one ADR or
  // appear in some implementation reference. M1 implementation: a BRD
  // story is "covered" if any file (other than BRD.md itself) cites it.
  const stories = registry.entries.filter((e) => e.kind === 'brd-story');
  const cited = new Set<string>();
  for (const fc of citations) {
    if (fc.path === 'docs/functional/BRD.md') continue;
    for (const t of fc.traceIds) cited.add(t.id);
  }
  const issues: CheckIssue[] = [];
  for (const s of stories) {
    if (!cited.has(s.id)) {
      issues.push({
        source: s.docPath ?? '-',
        message: `${s.id} (${s.label}) has no resolution path: no ADR or other doc cites it`,
        suggestions: [`Either author an ADR/contribution that implements ${s.id}, or remove from scope if obsolete`],
      });
    }
  }
  // Coverage ratio for the report
  const ratio = stories.length === 0 ? 1 : (stories.length - issues.length) / stories.length;
  const threshold = 0.95;
  return {
    name: 'traceability_coverage',
    status: ratio >= threshold ? 'OK' : 'FAIL',
    count: stories.length,
    issues: ratio >= threshold ? [] : issues,
  };
}

async function checkOpenQuestionsHygiene(repoRoot: string): Promise<CheckResult> {
  // M1 implementation: list OPEN entries from BRD-OPEN-QUESTIONS for
  // architect review. The gap-vs-question test requires judgment and
  // is not automated.
  const path = join(repoRoot, 'docs/functional/BRD-OPEN-QUESTIONS.md');
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch {
    return { name: 'open_questions_hygiene', status: 'INFO', count: 0, issues: [] };
  }

  const headerIdx = raw.indexOf('## Resolved');
  const openSection = headerIdx >= 0 ? raw.slice(0, headerIdx) : raw;

  const issues: CheckIssue[] = [];
  const re = /^### (\d+)\s*[-·]/gm;
  for (const m of openSection.matchAll(re)) {
    const sectionNum = m[1];
    const lineNo = openSection.slice(0, m.index).split('\n').length;
    issues.push({
      source: 'docs/functional/BRD-OPEN-QUESTIONS.md',
      line: lineNo,
      message: `OPEN section ${sectionNum} -- review against the spec-gap-vs-real-question test (METHODOLOGY 6.1)`,
    });
  }

  return { name: 'open_questions_hygiene', status: 'INFO', count: issues.length, issues };
}

function checkAdrReevalTriggers(
  adrFiles: Map<string, { path: string; raw: string }>,
): CheckResult {
  // List-only at M1 per scripts/README.md "Implementation note on
  // adr_reeval_trigger_check": surface the list to the architect; automated
  // trigger detection is v1.x.
  const issues: CheckIssue[] = [];
  for (const [id, info] of adrFiles) {
    if (/Re-evaluation triggers/i.test(info.raw)) {
      issues.push({
        source: info.path,
        message: `${id} has a Re-evaluation triggers section -- review whether any have fired`,
      });
    }
  }
  return { name: 'adr_reeval_trigger_check', status: 'INFO', count: issues.length, issues };
}

// =========================================================================
// CLI + reporter
// =========================================================================

type Mode = 'per-pr' | 'milestone-exit' | 'diff' | 'staged';

interface Args {
  mode: Mode;
  json: boolean;
  repoRoot: string;
  base: string | null;       // for --diff against a base branch (e.g. origin/main)
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: 'per-pr', json: false, repoRoot: process.cwd(), base: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--per-pr') args.mode = 'per-pr';
    else if (a === '--milestone-exit') args.mode = 'milestone-exit';
    else if (a === '--diff') args.mode = 'diff';
    else if (a === '--staged') args.mode = 'staged';
    else if (a === '--json') args.json = true;
    else if (a === '--root') args.repoRoot = resolve(argv[++i]!);
    else if (a === '--base') args.base = argv[++i]!;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: validate-refs [--per-pr | --milestone-exit | --diff [--base REF] | --staged] [--json]');
      process.exit(0);
    }
  }
  return args;
}

function gitChangedFiles(mode: 'diff' | 'staged', base: string | null): string[] {
  let cmd: string;
  if (mode === 'staged') {
    cmd = 'git diff --cached --name-only --diff-filter=ACMR';
  } else if (base) {
    // PR-style three-dot diff against the merge base with `base`.
    cmd = `git diff --name-only --diff-filter=ACMR ${base}...HEAD`;
  } else {
    cmd = 'git diff --name-only --diff-filter=ACMR';
  }
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function reportHuman(results: CheckResult[]): string {
  const lines: string[] = [];
  let failures = 0;
  for (const r of results) {
    const tag = r.status === 'OK' ? 'OK  ' : r.status === 'INFO' ? 'INFO' : 'FAIL';
    lines.push(`${tag}  ${r.name.padEnd(28)} (${r.count} checked)`);
    if (r.status === 'FAIL') {
      failures += r.issues.length;
      for (const issue of r.issues.slice(0, 50)) {
        const loc = issue.line ? `${issue.source}:${issue.line}` : issue.source;
        lines.push(`      ${loc}`);
        lines.push(`        ${issue.message}`);
        if (issue.suggestions) {
          for (const s of issue.suggestions) lines.push(`        - ${s}`);
        }
      }
      if (r.issues.length > 50) {
        lines.push(`      ... ${r.issues.length - 50} more`);
      }
    }
    if (r.status === 'INFO' && r.issues.length > 0) {
      for (const issue of r.issues.slice(0, 20)) {
        const loc = issue.line ? `${issue.source}:${issue.line}` : issue.source;
        lines.push(`      ${loc}: ${issue.message}`);
      }
      if (r.issues.length > 20) {
        lines.push(`      ... ${r.issues.length - 20} more`);
      }
    }
  }
  lines.push('');
  lines.push(failures === 0
    ? `PASS: all enforcement checks succeeded`
    : `FAIL: ${failures} issue(s) across ${results.filter((r) => r.status === 'FAIL').length} check(s)`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = args.repoRoot;

  const [tracability, adrFiles, archHeadings] = await Promise.all([
    loadTraceability(root),
    loadAdrFiles(root),
    loadArchHeadings(root),
  ]);

  let scope: 'all' | string[];
  if (args.mode === 'diff' || args.mode === 'staged') {
    scope = gitChangedFiles(args.mode, args.base);
  } else {
    scope = 'all';
  }
  const citations = await walkRepo(root, scope === 'all' ? 'all' : (scope as string[]));

  const results: CheckResult[] = [];
  results.push(checkTraceIdResolution(citations, tracability.ids));
  results.push(checkAdrIdResolution(citations, adrFiles));
  results.push(checkFrontmatterValidation(adrFiles));
  results.push(checkAdrIndexAlignment(adrFiles, tracability.adrEntries));
  results.push(checkArchSectionResolution(citations, archHeadings));
  results.push(checkWalkFoldResolution(citations, archHeadings));
  results.push(await checkMarkdownLinkIntegrity(citations, root));

  if (args.mode === 'milestone-exit') {
    results.push(checkTraceabilityCoverage(tracability, citations));
    results.push(await checkOpenQuestionsHygiene(root));
    results.push(checkAdrReevalTriggers(adrFiles));
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(reportHuman(results));
  }

  const hasFailures = results.some((r) => r.status === 'FAIL');
  process.exit(hasFailures ? 1 : 0);
}

function nearestHeadingSuggestion(target: string, headings: Set<string>): string[] {
  const targetParts = target.split('.');
  // Suggest siblings (same parent) and parents
  const suggestions: string[] = [];
  for (const h of headings) {
    const hParts = h.split('.');
    if (hParts.length === targetParts.length && hParts.slice(0, -1).join('.') === targetParts.slice(0, -1).join('.')) {
      suggestions.push(`Did you mean section ${h}?`);
    }
  }
  return suggestions.slice(0, 3);
}

if (process.argv[1]?.endsWith('validate-refs.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}

export {
  parseArgs,
  walkRepo,
  loadTraceability,
  loadAdrFiles,
  loadArchHeadings,
  checkTraceIdResolution,
  checkAdrIdResolution,
  checkFrontmatterValidation,
  checkAdrIndexAlignment,
  checkArchSectionResolution,
  checkWalkFoldResolution,
  checkMarkdownLinkIntegrity,
  checkTraceabilityCoverage,
  checkOpenQuestionsHygiene,
  checkAdrReevalTriggers,
};
// Suppress unused-import warning from tsx
void basename;
