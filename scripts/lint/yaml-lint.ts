// YAML lint: parse every committed YAML file and surface syntax errors.
//
// Closes the M7 follow-up filed in PR #10's commit message. PR #10
// hot-fixed `.github/workflows/atelier-audit.yml` after a colon-in-step-name
// silently broke CI for several weeks (the workflow file failed to parse on
// the GitHub Actions side; pushes to main never ran the audit). The class
// of failure is general -- any YAML syntax error in a file the toolchain
// reads at runtime can ship without notice if the file isn't parsed in
// CI.
//
// What this catches:
//   - YAML 1.2 syntax errors (the colon-in-unquoted-step-name class
//     specifically; broader "is this parseable?" check generally)
//   - Files that exist but are empty (most YAML consumers treat empty
//     as null but it's almost always a mistake)
//   - Tab characters in YAML (forbidden by spec; some editors silently
//     insert them)
//
// What this does NOT catch (out of scope):
//   - Schema validation (e.g., does the file shape match what the
//     reader expects?). That belongs in the per-config validators
//     (e.g., the substrate's `loadConfig`).
//   - Style enforcement (line length, key ordering). The repo has no
//     opinion here yet.
//   - Strict YAML 1.1-vs-1.2 distinctions (e.g., `yes` as boolean).
//     The `yaml` package defaults to YAML 1.2 which is what GitHub
//     Actions, Supabase, and the substrate consume.
//
// Run:
//   npm run lint:yaml
//   # or directly:
//   npx tsx scripts/lint/yaml-lint.ts
//
// Exit code: 0 on clean, 1 on any error. CI uses the exit code as the gate.

import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parse, type YAMLParseError } from 'yaml';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// Files to lint. Globs are relative to REPO_ROOT.
//
// Note: this is an allowlist, not a denylist. New YAML surfaces (e.g.,
// dependabot config, codeowners-shaped files) get explicitly added here
// so the linter doesn't silently grow scope when an unrelated YAML file
// lands in the repo.
const TARGETS: readonly string[] = [
  '.github/workflows/*.yml',
  '.github/workflows/*.yaml',
  '.atelier/*.yaml',
  '.atelier/*.yml',
];

interface Finding {
  file: string;
  line?: number;
  col?: number;
  kind: 'parse_error' | 'empty_file' | 'tab_indent';
  message: string;
}

async function expandTargets(): Promise<readonly string[]> {
  const matches: string[] = [];
  for (const pattern of TARGETS) {
    for await (const entry of glob(pattern, { cwd: REPO_ROOT })) {
      matches.push(entry);
    }
  }
  // Stable order so the report reads the same across runs.
  return matches.sort();
}

function findingsForFile(relPath: string, body: string): Finding[] {
  const out: Finding[] = [];

  // Empty file check: an empty YAML file parses to undefined / null and
  // is almost always a mistake (someone created the file to track a
  // concern then forgot to populate it).
  if (body.trim().length === 0) {
    out.push({
      file: relPath,
      kind: 'empty_file',
      message: 'file is empty; YAML consumers will read null which is rarely intended',
    });
    return out;
  }

  // Tab-indent check: YAML forbids tabs for indentation. Some editors
  // silently insert them when the user holds Tab, producing files that
  // pass casual eyeballing but break parsers.
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    // Only flag tabs at start-of-line (indentation position). Tabs
    // inside a quoted string or comment are valid YAML.
    const leading = /^(\s*)/.exec(line)?.[1] ?? '';
    if (leading.includes('\t')) {
      out.push({
        file: relPath,
        line: i + 1,
        col: leading.indexOf('\t') + 1,
        kind: 'tab_indent',
        message: 'tab character in indentation (YAML forbids tabs; use spaces)',
      });
    }
  }

  // Parse check: this is the load-bearing one. The YAML 1.2 parser
  // throws YAMLParseError with line/col on syntax errors -- including
  // the colon-in-unquoted-value class that bit PR #10.
  try {
    parse(body, { strict: true });
  } catch (err) {
    const e = err as YAMLParseError;
    const pos = e.linePos?.[0];
    const finding: Finding = {
      file: relPath,
      kind: 'parse_error',
      message: e.message ?? String(err),
    };
    if (pos?.line !== undefined) finding.line = pos.line;
    if (pos?.col !== undefined) finding.col = pos.col;
    out.push(finding);
  }

  return out;
}

async function main(): Promise<void> {
  const targets = await expandTargets();
  if (targets.length === 0) {
    console.error('yaml-lint: no files matched any pattern in TARGETS');
    process.exit(2);
  }

  const allFindings: Finding[] = [];
  for (const relPath of targets) {
    const abs = join(REPO_ROOT, relPath);
    const body = await readFile(abs, 'utf8');
    const findings = findingsForFile(relPath, body);
    allFindings.push(...findings);
  }

  console.log(`yaml-lint: scanned ${targets.length} file(s); found ${allFindings.length} issue(s)`);
  for (const f of allFindings) {
    const loc = f.line !== undefined ? `:${f.line}${f.col !== undefined ? ':' + f.col : ''}` : '';
    console.log(`  ${f.file}${loc}  ${f.kind}: ${f.message}`);
  }

  if (allFindings.length > 0) {
    process.exit(1);
  }

  console.log('yaml-lint: PASS');
}

main().catch((err) => {
  console.error('yaml-lint: unexpected failure');
  console.error(err);
  process.exit(2);
});
