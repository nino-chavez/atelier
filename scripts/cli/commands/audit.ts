// `atelier audit` — extended traceability + cross-doc consistency
// validation (US-11.11; BUILD-SEQUENCE §9).
//
// v1: thin wrapper around scripts/traceability/validate-refs.ts.
// Forwards mode flags (--per-pr, --milestone-exit, --diff, --staged,
// --json) per the validator's contract.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

export const auditUsage = `atelier audit — extended cross-doc consistency validator

Usage:
  atelier audit [--per-pr | --milestone-exit | --diff [--base REF] | --staged] [--json]

Modes (per scripts/README.md "Extended cross-doc consistency"):
  --per-pr           Trace ID + ARCH + ADR + walk-fold + markdown link +
                     frontmatter checks. ~10s. CI gate.
  --milestone-exit   Per-pr + traceability_coverage + open_questions_hygiene
                     + adr_reeval_trigger_check + operational_completeness.
                     Run by architect at milestone-status-to-Done transition.
  --diff [--base R]  Same checks as --per-pr scoped to uncommitted (or
                     staged via --staged) changes. Designed for pre-commit
                     hook use; ~2s.
  --staged           Same shape as --diff but scoped to git-staged changes.

Output:
  Default: human-readable per-check summary
  --json:  Structured JSON output (CI parseable)

Cross-references:
  scripts/README.md "Extended cross-doc consistency" -- full check class catalog
  METHODOLOGY 11.x -- per-PR + milestone + quarterly review cadences
`;

export async function runAudit(args: readonly string[]): Promise<number> {
  return new Promise<number>((resolveExit) => {
    const proc = spawn(
      'npx',
      ['tsx', resolve(REPO_ROOT, 'scripts/traceability/validate-refs.ts'), ...args],
      { stdio: 'inherit', cwd: REPO_ROOT },
    );
    proc.on('exit', (code) => resolveExit(code ?? 1));
    proc.on('error', (err) => {
      console.error(`atelier audit: spawn failed: ${err.message}`);
      resolveExit(2);
    });
  });
}
