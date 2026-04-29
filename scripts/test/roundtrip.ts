#!/usr/bin/env -S npx tsx
//
// Round-trip integrity test (M1 exit gate).
//
// Per scripts/README.md "Round-trip integrity contract":
//   markdown -> datastore -> projector -> markdown is byte-identical for
//   the canonical doc classes, modulo permitted normalizations declared
//   per doc class.
//
// CLI:
//   roundtrip                       Run all doc classes against the repo root
//   roundtrip --classes <names>     Comma-separated subset (e.g., ADR,traceability)
//   roundtrip --root <path>         Override repo root (default: cwd)
//   roundtrip --json                Emit JSON instead of human-readable summary

import { resolve } from 'node:path';
import { adrHandler } from './handlers/adr.ts';
import { traceabilityHandler } from './handlers/traceability.ts';
import { territoriesHandler } from './handlers/territories.ts';
import { configHandler } from './handlers/config.ts';
import { brdHandler } from './handlers/brd.ts';
import { prdCompanionHandler } from './handlers/prd-companion.ts';
import type { DocClassHandler, RoundTripResult } from './lib/types.ts';

const ALL_HANDLERS: DocClassHandler[] = [
  adrHandler,
  traceabilityHandler,
  territoriesHandler,
  configHandler,
  brdHandler,
  prdCompanionHandler,
];

interface Args {
  classes: string[] | null;  // null = all
  root: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    classes: null,
    root: process.cwd(),
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--classes') args.classes = argv[++i]!.split(',').map((x) => x.trim());
    else if (a === '--root') args.root = resolve(argv[++i]!);
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: roundtrip [--classes <names>] [--root <path>] [--json]');
      console.log(`  Available classes: ${ALL_HANDLERS.map((h) => h.name).join(', ')}`);
      process.exit(0);
    }
  }
  return args;
}

interface ClassReport {
  name: string;
  pathPattern: string;
  results: RoundTripResult[];
  totalFiles: number;
  failures: number;
}

async function runClass(handler: DocClassHandler, root: string): Promise<ClassReport> {
  const files = await handler.enumerate(root);
  const results: RoundTripResult[] = [];
  for (const f of files) {
    try {
      results.push(await handler.roundTrip(f));
    } catch (err) {
      results.push({
        filePath: f,
        ok: false,
        diffs: [{
          offsetHex: '0x000000',
          expectedHex: '<n/a>',
          gotHex: '<exception>',
          context: String(err),
        }],
      });
    }
  }
  const failures = results.filter((r) => !r.ok && !r.skipped).length;
  return {
    name: handler.name,
    pathPattern: handler.pathPattern,
    results,
    totalFiles: files.length,
    failures,
  };
}

function renderHuman(reports: ClassReport[]): string {
  const lines: string[] = [];
  let total = 0;
  let totalFailures = 0;
  for (const report of reports) {
    total += report.totalFiles;
    totalFailures += report.failures;
    const status = report.failures === 0 ? 'OK' : 'FAIL';
    lines.push(
      `${status.padEnd(4)}  ${report.name.padEnd(16)} ${report.totalFiles} files  (${report.pathPattern})`,
    );
    if (report.totalFiles === 0) {
      lines.push(`        (no files matched; doc class is dormant in this repo state)`);
    }
    for (const r of report.results) {
      if (r.skipped) {
        lines.push(`        [SKIP] ${rel(r.filePath)} -- ${r.skipped}`);
      } else if (!r.ok) {
        lines.push(`        [FAIL] ${rel(r.filePath)}`);
        for (const d of r.diffs ?? []) {
          lines.push(`               ${d.offsetHex}  expected ${d.expectedHex}  got ${d.gotHex}`);
          lines.push(`               ${d.context}`);
        }
      }
    }
  }
  lines.push('');
  lines.push(
    totalFailures === 0
      ? `PASS: ${total} files across ${reports.length} doc classes round-tripped clean`
      : `FAIL: ${totalFailures} of ${total} files diverged`,
  );
  return lines.join('\n');
}

function rel(p: string): string {
  const cwd = process.cwd();
  return p.startsWith(cwd) ? p.slice(cwd.length + 1) : p;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const handlers = args.classes
    ? ALL_HANDLERS.filter((h) => args.classes!.includes(h.name))
    : ALL_HANDLERS;
  if (handlers.length === 0) {
    console.error(`error: no matching doc classes (available: ${ALL_HANDLERS.map((h) => h.name).join(', ')})`);
    process.exit(1);
  }

  const reports: ClassReport[] = [];
  for (const h of handlers) {
    reports.push(await runClass(h, args.root));
  }

  if (args.json) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    console.log(renderHuman(reports));
  }

  const totalFailures = reports.reduce((acc, r) => acc + r.failures, 0);
  process.exit(totalFailures === 0 ? 0 : 1);
}

if (process.argv[1]?.endsWith('roundtrip.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}

export { runClass, parseArgs, ALL_HANDLERS };
