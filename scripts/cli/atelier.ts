#!/usr/bin/env -S npx tsx
//
// `atelier` CLI entry point. Dispatches subcommands to scripts/cli/commands/.
//
// At v1 the polished CLI surface is 12 commands per BUILD-SEQUENCE §9 plus
// `atelier dev` (US-11.13) added at M7 Track 1 as the highest-leverage
// adoption-readiness move. This entry point is a thin dispatcher so each
// command lives in its own file for clean ownership and testing.
//
// Per the M7 kickoff: `atelier dev` is the 13th v1 CLI command (CLI surface
// only; does NOT touch the ADR-013/040 12-tool MCP surface lock).
//
// Each subcommand exports a `runDev(args)` (or analogous `runX(args)`) async
// function + a `usage` string. The dispatcher routes argv[2] to the matching
// command.
//
// Run:
//   npx tsx scripts/cli/atelier.ts <command> [args]
//   # or via the npm bin once 'atelier' is in package.json's "bin" field:
//   atelier <command> [args]

import { runDev, devUsage } from './commands/dev.ts';

interface Command {
  name: string;
  description: string;
  run: (args: readonly string[]) => Promise<number>;
  usage: string;
}

const COMMANDS: readonly Command[] = [
  {
    name: 'dev',
    description: 'Bring up the local Atelier substrate (Supabase + dev server + bearer)',
    run: runDev,
    usage: devUsage,
  },
];

function topUsage(): string {
  const lines = [
    'atelier — coordination substrate CLI',
    '',
    'Commands:',
  ];
  for (const cmd of COMMANDS) {
    lines.push(`  ${cmd.name.padEnd(12)} ${cmd.description}`);
  }
  lines.push('');
  lines.push('Use `atelier <command> --help` for command-specific options.');
  lines.push('');
  lines.push('Note: 12 v1 commands per BUILD-SEQUENCE §9 land at M7 polish (init,');
  lines.push('datastore init, deploy, invite, territory add, doctor, upgrade, sync,');
  lines.push('reconcile, eval find_similar, audit, review). `dev` is the 13th (M7');
  lines.push('Track 1 / US-11.13). Pre-polish raw forms still work via direct');
  lines.push('script invocation per scripts/README.md.');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sub = argv[0];

  if (!sub || sub === '--help' || sub === '-h') {
    console.log(topUsage());
    process.exit(0);
  }

  const command = COMMANDS.find((c) => c.name === sub);
  if (!command) {
    console.error(`atelier: unknown command "${sub}"`);
    console.error('');
    console.error(topUsage());
    process.exit(2);
  }

  if (argv[1] === '--help' || argv[1] === '-h') {
    console.log(command.usage);
    process.exit(0);
  }

  const exitCode = await command.run(argv.slice(1));
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('atelier: unexpected failure');
  console.error(err);
  process.exit(2);
});
