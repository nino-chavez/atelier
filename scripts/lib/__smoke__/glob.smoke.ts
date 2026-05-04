// Smoke for the consolidated glob primitive (X1 audit Q3a).
// Validates the contract both consumers (atelier review + the
// semantic-contradiction validator) rely on.

import { match, matchesAny } from '../glob.ts';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------
// match()
// ---------------------------------------------------------------------------

console.log('# 1. match() — supported pattern subset');

const cases: Array<{ path: string; pattern: string; want: boolean }> = [
  // ** matches anything
  { path: 'foo.md', pattern: '**', want: true },
  { path: 'docs/foo.md', pattern: '**', want: true },
  { path: 'a/b/c/d.md', pattern: '**', want: true },

  // docs/** matches anything under docs/
  { path: 'docs/foo.md', pattern: 'docs/**', want: true },
  { path: 'docs/architecture/decisions/ADR-042.md', pattern: 'docs/**', want: true },
  { path: 'src/foo.ts', pattern: 'docs/**', want: false },

  // **/route.ts matches route.ts at any depth
  { path: 'src/api/route.ts', pattern: '**/route.ts', want: true },
  { path: 'route.ts', pattern: '**/route.ts', want: true },
  { path: 'src/api/route.tsx', pattern: '**/route.ts', want: false },

  // *.md is single-segment wildcard
  { path: 'README.md', pattern: '*.md', want: true },
  { path: 'docs/README.md', pattern: '*.md', want: false },

  // ADR-*.md prefix + wildcard
  { path: 'docs/architecture/decisions/ADR-001-foo.md', pattern: 'docs/architecture/decisions/ADR-*.md', want: true },
  { path: 'docs/architecture/decisions/README.md', pattern: 'docs/architecture/decisions/ADR-*.md', want: false },

  // ? single-char wildcard (excluding /)
  { path: 'a.md', pattern: '?.md', want: true },
  { path: 'ab.md', pattern: '?.md', want: false },
  { path: 'a/b.md', pattern: '?/b.md', want: true },

  // Leading ./ normalization
  { path: './foo.md', pattern: '*.md', want: true },
  { path: 'foo.md', pattern: './*.md', want: true },

  // Literal segments still anchored
  { path: 'docs/strategic/NORTH-STAR.md', pattern: 'docs/strategic/NORTH-STAR.md', want: true },
  { path: 'docs/strategic/NORTH-STAR.md.bak', pattern: 'docs/strategic/NORTH-STAR.md', want: false },
];

for (const c of cases) {
  check(
    `${c.pattern} ${c.want ? 'matches' : 'does not match'} ${c.path}`,
    match(c.path, c.pattern) === c.want,
  );
}

// ---------------------------------------------------------------------------
// matchesAny()
// ---------------------------------------------------------------------------

console.log('# 2. matchesAny()');

check(
  'returns true when any pattern matches',
  matchesAny('docs/architecture/decisions/ADR-042.md', [
    'src/**',
    'docs/architecture/decisions/**',
  ]),
);
check(
  'returns false when no pattern matches',
  !matchesAny('lib/foo.ts', ['docs/**', 'src/**']),
);
check('returns false on empty patterns', !matchesAny('foo.md', []));

console.log('');
if (failures === 0) {
  console.log('glob smoke: PASS');
  process.exit(0);
}
console.log(`glob smoke: FAIL (${failures} failures)`);
process.exit(1);
