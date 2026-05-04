// Glob matching primitive shared by:
//   - scripts/cli/commands/review.ts (territories.yaml scope_pattern matching)
//   - scripts/traceability/semantic-contradiction.ts (review.scope_paths matching)
//
// Supersedes the per-consumer hand-rolls (minimatch-shim.ts; the inline
// globMatch in semantic-contradiction.ts) so both consumers agree on
// edge cases.
//
// Supported pattern subset:
//   "**"                  match anything
//   "docs/**"             match anything under docs/ (any depth)
//   "**/route.ts"         match route.ts anywhere
//   "src/**/route.ts"     ** spans path segments; * does not
//   "*.md"                single-level wildcard
//   "ADR-*.md"            literal prefix + wildcard
//   "?"                   single character (excluding /)
//
// NOT supported:
//   - Brace expansion: {a,b}                  (no consumer uses it)
//   - Negation: !pattern                      (filter at the caller)
//   - Character classes: [abc]                (unused at v1)
//
// If a future scope_pattern needs richer syntax, swap to a real minimatch
// dep + this file becomes a thin wrapper.

export function match(filename: string, pattern: string): boolean {
  // Normalize: strip leading "./" on either side.
  const file = filename.startsWith('./') ? filename.slice(2) : filename;
  const pat = pattern.startsWith('./') ? pattern.slice(2) : pattern;

  const PLACEHOLDER_DOUBLE_STAR_SLASH = ' DSS ';
  const PLACEHOLDER_DOUBLE_STAR = ' DOUBLE ';
  const PLACEHOLDER_STAR = ' STAR ';
  const PLACEHOLDER_QMARK = ' Q ';

  const withPlaceholders = pat
    // Order matters: **/ before ** before *.
    .replace(/\*\*\//g, PLACEHOLDER_DOUBLE_STAR_SLASH)
    .replace(/\*\*/g, PLACEHOLDER_DOUBLE_STAR)
    .replace(/\*/g, PLACEHOLDER_STAR)
    .replace(/\?/g, PLACEHOLDER_QMARK);

  const escaped = withPlaceholders.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  const regexBody = escaped
    .replace(new RegExp(PLACEHOLDER_DOUBLE_STAR_SLASH, 'g'), '(?:.*/)?') // **/ = optional path-prefix
    .replace(new RegExp(PLACEHOLDER_DOUBLE_STAR, 'g'), '.*')             // ** = anything including /
    .replace(new RegExp(PLACEHOLDER_STAR, 'g'), '[^/]*')                 // *  = anything except /
    .replace(new RegExp(PLACEHOLDER_QMARK, 'g'), '[^/]');                // ?  = single char except /

  return new RegExp(`^${regexBody}$`).test(file);
}

/**
 * Convenience: true if `path` matches any of the supplied patterns.
 */
export function matchesAny(path: string, patterns: readonly string[]): boolean {
  for (const p of patterns) {
    if (match(path, p)) return true;
  }
  return false;
}
