// `atelier sync <target>` — invoke a sync substrate script
// (US-11.6; BUILD-SEQUENCE §9; ADR-008).
//
// v1: thin wrapper. Delegates to one of the 5 sync substrate scripts
// per ADR-008. Validates the target name + dispatches; the script
// itself is the implementation.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

const TARGETS = {
  'publish-docs': 'scripts/sync/publish-docs.ts',
  'publish-delivery': 'scripts/sync/publish-delivery.ts',
  'mirror-delivery': 'scripts/sync/mirror-delivery.ts',
  reconcile: 'scripts/sync/reconcile.ts',
  triage: 'scripts/sync/triage/route-proposal.ts',
} as const;

export const syncUsage = `atelier sync — manually invoke a sync substrate script

Usage:
  atelier sync <target> [-- script-args...]

Targets (per ADR-008):
  publish-docs       Project repo doc -> published-doc system (full overwrite + banner)
  publish-delivery   Contribution state -> delivery tracker (Jira / Linear / etc.)
  mirror-delivery    Delivery tracker -> registry (nightly reconciliation)
  reconcile          Bidirectional drift detector (reports only by default;
                     --apply for write-side; ATELIER_RECONCILE_BRANCH_REAPING_ENABLED
                     env var to opt into branch reaping per BRD-OPEN-QUESTIONS §24)
  triage             External comments (e.g., GitHub Issues) -> proposal contributions

Args after \`--\` are forwarded to the underlying script. Example:

  atelier sync reconcile -- --apply
  atelier sync triage -- --comment-id <id>

Each target's full options list is documented in scripts/README.md.
`;

export async function runSync(args: readonly string[]): Promise<number> {
  const target = args[0];
  if (!target) {
    console.error('atelier sync: <target> is required');
    console.error('');
    console.error(syncUsage);
    return 2;
  }
  const script = TARGETS[target as keyof typeof TARGETS];
  if (!script) {
    console.error(`atelier sync: unknown target "${target}"`);
    console.error(`atelier sync: valid targets are ${Object.keys(TARGETS).join(', ')}`);
    return 2;
  }

  // Forward args after the optional "--" separator. With no separator,
  // forward all args after the target.
  const sepIdx = args.indexOf('--');
  const forwarded = sepIdx === -1 ? args.slice(1) : args.slice(sepIdx + 1);

  return new Promise<number>((resolveExit) => {
    const proc = spawn('npx', ['tsx', resolve(REPO_ROOT, script), ...forwarded], {
      stdio: 'inherit',
      cwd: REPO_ROOT,
    });
    proc.on('exit', (code) => resolveExit(code ?? 1));
    proc.on('error', (err) => {
      console.error(`atelier sync: spawn failed: ${err.message}`);
      resolveExit(2);
    });
  });
}
