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
import { runInit, initUsage } from './commands/init.ts';
import { runDatastore, datastoreUsage } from './commands/datastore.ts';
import { runDeploy, deployUsage } from './commands/deploy.ts';
import { runInvite, inviteUsage } from './commands/invite.ts';
import { runTerritory, territoryUsage } from './commands/territory.ts';
import { runDoctor, doctorUsage } from './commands/doctor.ts';
import { runUpgrade, upgradeUsage } from './commands/upgrade.ts';
import { runSync, syncUsage } from './commands/sync.ts';
import { runReconcile, reconcileUsage } from './commands/reconcile.ts';
import { runEval, evalUsage } from './commands/eval.ts';
import { runAudit, auditUsage } from './commands/audit.ts';
import { runReview, reviewUsage } from './commands/review.ts';

type CommandStatus = 'working' | 'wrapper' | 'stub' | 'scope-deferred';

interface Command {
  name: string;
  description: string;
  status: CommandStatus;
  run: (args: readonly string[]) => Promise<number>;
  usage: string;
}

const COMMANDS: readonly Command[] = [
  // Adopter-readiness workflow (BUILD-SEQUENCE §9 + US-11.13).
  { name: 'dev', description: 'Bring up the local Atelier substrate', status: 'working', run: runDev, usage: devUsage },
  { name: 'init', description: 'Scaffold a new Atelier project', status: 'stub', run: runInit, usage: initUsage },
  { name: 'datastore', description: 'Manage the coordination datastore (init)', status: 'stub', run: runDatastore, usage: datastoreUsage },
  { name: 'deploy', description: 'Push prototype + endpoint to deploy target', status: 'stub', run: runDeploy, usage: deployUsage },
  { name: 'invite', description: 'Invite a remote-principal composer', status: 'stub', run: runInvite, usage: inviteUsage },
  { name: 'territory', description: 'Manage territory definitions (add)', status: 'stub', run: runTerritory, usage: territoryUsage },
  { name: 'doctor', description: 'Diagnose substrate health (ARCH 6.1.1 four-step)', status: 'stub', run: runDoctor, usage: doctorUsage },
  { name: 'upgrade', description: 'Pull new template version (v1.x scope)', status: 'scope-deferred', run: runUpgrade, usage: upgradeUsage },
  // Sync substrate.
  { name: 'sync', description: 'Manually invoke a sync substrate script', status: 'wrapper', run: runSync, usage: syncUsage },
  { name: 'reconcile', description: 'Detect repo / external-tracker drift', status: 'wrapper', run: runReconcile, usage: reconcileUsage },
  { name: 'eval', description: 'Run evaluation harnesses (find_similar)', status: 'wrapper', run: runEval, usage: evalUsage },
  // Process / governance.
  { name: 'audit', description: 'Cross-doc consistency validator', status: 'wrapper', run: runAudit, usage: auditUsage },
  { name: 'review', description: 'Compute required reviewers from territories.yaml', status: 'wrapper', run: runReview, usage: reviewUsage },
];

function statusLabel(s: CommandStatus): string {
  switch (s) {
    case 'working': return '';
    case 'wrapper': return '';
    case 'stub': return ' [v1.x]';
    case 'scope-deferred': return ' [v1.x*]';
  }
}

function topUsage(): string {
  const lines = [
    'atelier — coordination substrate CLI',
    '',
    'Commands:',
  ];
  for (const cmd of COMMANDS) {
    lines.push(`  ${cmd.name.padEnd(12)} ${cmd.description}${statusLabel(cmd.status)}`);
  }
  lines.push('');
  lines.push('Status legend:');
  lines.push('  (no marker)  Working at v1');
  lines.push('  [v1.x]       Pointer-stub: prints v1 raw equivalent and exits 0');
  lines.push('  [v1.x*]      Scope-deferred: capability not built at v1 (BRD-OPEN-QUESTIONS §29)');
  lines.push('');
  lines.push('Use `atelier <command> --help` for command-specific options + raw-form hints.');
  lines.push('');
  lines.push('12 v1 CLI commands per BUILD-SEQUENCE §9 ship as polished form at M7;');
  lines.push('`dev` is the 13th (US-11.13). Per Nino 2026-05-02: substrate-led adopter');
  lines.push('experience -- working commands cover the daily flow; pointer-stubs');
  lines.push('keep the surface complete and discoverable while the polished forms');
  lines.push('land in v1.x.');
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
