// `atelier reconcile` — bidirectional drift detector
// (US-11.7; BUILD-SEQUENCE §9; ADR-008).
//
// v1: thin wrapper. Equivalent to `atelier sync reconcile`; exposed as a
// top-level command for discoverability per the BRD US-11.7 framing.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

export const reconcileUsage = `atelier reconcile — detect repo / external-tracker drift

Usage:
  atelier reconcile [-- script-args...]

Reports drift between the project's repo state and external trackers
(GitHub Issues, Jira, Linear). Default: report-only (no writes).

Common options (forwarded after \`--\`):
  --apply                          Write the detected fixes (default: dry-run)
  --reap-branches --apply          Enable branch reaping (default off per
                                   BRD-OPEN-QUESTIONS §24; gated by
                                   ATELIER_RECONCILE_BRANCH_REAPING_ENABLED)

Equivalent to \`atelier sync reconcile [-- script-args...]\`. Exposed as
a top-level command for discoverability per BRD US-11.7.
`;

export async function runReconcile(args: readonly string[]): Promise<number> {
  return new Promise<number>((resolveExit) => {
    const proc = spawn(
      'npx',
      ['tsx', resolve(REPO_ROOT, 'scripts/sync/reconcile.ts'), ...args],
      { stdio: 'inherit', cwd: REPO_ROOT },
    );
    proc.on('exit', (code) => resolveExit(code ?? 1));
    proc.on('error', (err) => {
      console.error(`atelier reconcile: spawn failed: ${err.message}`);
      resolveExit(2);
    });
  });
}
