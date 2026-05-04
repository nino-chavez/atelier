// `atelier eval <subcommand>` (US-11.8; BUILD-SEQUENCE §9; ADR-006).
//
// v1 subcommands:
//   find_similar — thin wrapper around scripts/eval/find_similar/runner.ts

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

export const evalUsage = `atelier eval — run evaluation harnesses

Usage:
  atelier eval find_similar [-- script-args...]

Subcommands:
  find_similar   Measure precision/recall of the find_similar retrieval
                 against the project's seed set per ADR-006 + ADR-042 +
                 ADR-043 (advisory tier; informational per ADR-045).

Required env (per ADR-027 + ADR-041):
  POSTGRES_URL    Postgres connection string
  OPENAI_API_KEY  Or whichever .atelier/config.yaml find_similar.
                  embeddings.api_key_env names

Common forwarded options:
  --project <uuid>       Project ID to scope the eval to (required)
  --seed-file <path>     Override the default seeds-merged.yaml
  --json-out <path>      Write detailed last-run.json metrics

For external corpora (per ADR-047), use the dedicated runner:

  npx tsx scripts/eval/find_similar/external/runner.ts \\
    --corpus-dir atelier/eval/find_similar/external-corpora/<corpus> \\
    --project <uuid>
`;

export async function runEval(args: readonly string[]): Promise<number> {
  const sub = args[0];
  if (sub !== 'find_similar') {
    if (!sub) {
      console.error('atelier eval: <subcommand> is required');
    } else {
      console.error(`atelier eval: unknown subcommand "${sub}"`);
    }
    console.error('');
    console.error(evalUsage);
    return 2;
  }

  const sepIdx = args.indexOf('--');
  const forwarded = sepIdx === -1 ? args.slice(1) : args.slice(sepIdx + 1);

  return new Promise<number>((resolveExit) => {
    const proc = spawn(
      'npx',
      ['tsx', resolve(REPO_ROOT, 'scripts/eval/find_similar/runner.ts'), ...forwarded],
      { stdio: 'inherit', cwd: REPO_ROOT },
    );
    proc.on('exit', (code) => resolveExit(code ?? 1));
    proc.on('error', (err) => {
      console.error(`atelier eval find_similar: spawn failed: ${err.message}`);
      resolveExit(2);
    });
  });
}
