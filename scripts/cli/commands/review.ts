// `atelier review` — compute required reviewers from territories.yaml
// for a given file scope (US-11.12; BUILD-SEQUENCE §9; ADR-025).
//
// v1: thin inline implementation. Reads .atelier/territories.yaml,
// matches each territory's scope_pattern against the input file list,
// emits the union of review_role values per matched territory.
//
// Implementation stays under ~50 LOC per Nino's 2026-05-02 gate; if
// it grows past ~100 LOC (e.g., adding DB lookup to resolve review_role
// → composer roster), demote to a pointer-stub per the kickoff.
//
// Out of scope at v1 (filed as v1.x if signal surfaces):
//   - Resolving review_role (a discipline) to specific composer rows
//     (would need DB access; the current emission tells operators which
//     discipline to find, not which person)
//   - .atelier/config.yaml: review.per_pr.territory_overrides (if present,
//     overrides not yet honored; manual cross-reference required)
//   - PR-changed-files mode (currently file-list-only; PR mode would
//     shell out to git diff)

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { minimatch } from './minimatch-shim.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

interface Territory {
  name: string;
  owner_role: string;
  review_role?: string | null;
  scope_kind: string;
  scope_pattern: string | string[];
  description?: string;
}

interface TerritoriesFile {
  territories: Territory[];
}

export const reviewUsage = `atelier review — compute required reviewers for a file scope

Usage:
  atelier review <file> [<file> ...]

Reads .atelier/territories.yaml, matches each territory's scope_pattern
against the supplied file list, and emits the union of review_role
values (per ADR-025) for matched territories.

Example:
  atelier review prototype/src/lib/atelier/mcp.ts docs/architecture/ARCHITECTURE.md

Output:
  Per-territory: review_role (effective), matched files, scope_pattern.
  Unmatched files reported as "no territory matches" (operator decides
  whether that's a coverage gap or genuinely unscoped).

v1 limitations (deferred to v1.x if signal surfaces):
  - Emits the discipline name (analyst | dev | pm | designer | architect)
    from review_role, not specific composer rows. Operators look up the
    composer roster separately.
  - .atelier/config.yaml: review.per_pr.territory_overrides not honored;
    manual cross-reference required.
  - --pr <number> mode (auto-derive file list from a PR diff) deferred.
`;

export async function runReview(args: readonly string[]): Promise<number> {
  if (args.length === 0) {
    console.error('atelier review: <file> [<file> ...] is required');
    console.error('');
    console.error(reviewUsage);
    return 2;
  }

  const territoriesPath = resolve(REPO_ROOT, '.atelier/territories.yaml');
  if (!existsSync(territoriesPath)) {
    console.error(`atelier review: ${territoriesPath} not found`);
    return 2;
  }
  const parsed = parseYaml(readFileSync(territoriesPath, 'utf8')) as TerritoriesFile;
  const territories = parsed.territories ?? [];

  // Match each input file against each territory's scope_pattern (which
  // may be a single glob or an array of globs).
  interface Match {
    territory: Territory;
    files: string[];
  }
  const matches = new Map<string, Match>();
  const unmatched: string[] = [];

  for (const file of args) {
    let any = false;
    for (const t of territories) {
      const patterns = Array.isArray(t.scope_pattern) ? t.scope_pattern : [t.scope_pattern];
      // Normalize scope_pattern shapes:
      //  - "files" scope: standard glob (matched against full repo-relative path)
      //  - "doc_region" scope: anchor-style "FILE.md#...", strip the anchor part
      //    and match the basename against any path ending with the same name.
      //    The territories.yaml convention uses just the file basename for
      //    doc_region scopes, so a file like docs/architecture/ARCHITECTURE.md
      //    matches the pattern "ARCHITECTURE.md#*" (anchor stripped).
      //  - Other scope_kinds (research_artifact, design_component, slice_config)
      //    are not file-addressable; skip them silently.
      const matched = patterns.some((p) => {
        if (t.scope_kind === 'doc_region') {
          const baseFromPattern = p.split('#')[0]?.trim();
          if (!baseFromPattern) return false;
          // Match by suffix: file path ends with the basename pattern.
          return file === baseFromPattern || file.endsWith(`/${baseFromPattern}`);
        }
        if (t.scope_kind === 'files') {
          return minimatch(file, p);
        }
        // Other scope_kinds: not file-addressable from this surface.
        return false;
      });
      if (matched) {
        any = true;
        const existing = matches.get(t.name) ?? { territory: t, files: [] };
        existing.files.push(file);
        matches.set(t.name, existing);
      }
    }
    if (!any) unmatched.push(file);
  }

  if (matches.size === 0) {
    console.log('No territory matches the supplied file list.');
    if (unmatched.length > 0) {
      console.log('');
      console.log('Unmatched files (no territory has a matching scope_pattern):');
      for (const f of unmatched) console.log(`  ${f}`);
    }
    return 0;
  }

  console.log('Required reviewers (per ADR-025; review_role from territories.yaml):');
  console.log('');
  for (const [name, m] of matches) {
    const effective = m.territory.review_role ?? m.territory.owner_role;
    console.log(`  Territory: ${name}`);
    console.log(`    review_role: ${effective}${m.territory.review_role ? '' : ' (defaulted from owner_role)'}`);
    console.log(`    scope_pattern: ${JSON.stringify(m.territory.scope_pattern)}`);
    console.log(`    matched files:`);
    for (const f of m.files) console.log(`      - ${f}`);
    console.log('');
  }

  if (unmatched.length > 0) {
    console.log('Unmatched files (no territory has a matching scope_pattern):');
    for (const f of unmatched) console.log(`  ${f}`);
    console.log('');
    console.log('If unmatched files are coverage gaps, file an issue or extend territories.yaml.');
  }
  return 0;
}
