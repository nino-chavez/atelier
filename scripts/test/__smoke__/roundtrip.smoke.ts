#!/usr/bin/env -S npx tsx
//
// Negative-case smoke test for the round-trip harness.
//
// The corpus-pass-rate test (run with `npx tsx scripts/test/roundtrip.ts`)
// validates that real files round-trip clean. This smoke validates the
// inverse: that the harness REPORTS drift when fed a deliberately non-
// canonical fixture. Without this, a regression where the harness silently
// passes everything could ship undetected.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { adrHandler } from '../handlers/adr.ts';
import { traceabilityHandler } from '../handlers/traceability.ts';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixtureRoot = resolve(here, '..', '__fixtures__', 'adr-non-canonical');

  console.log('\n[1] ADR handler detects non-canonical frontmatter key order');
  const adrFiles = await adrHandler.enumerate(fixtureRoot);
  check('fixture file enumerated', adrFiles.length === 1);
  const adrResult = await adrHandler.roundTrip(adrFiles[0]!);
  check('non-canonical ADR rejected (ok=false)', adrResult.ok === false);
  check('rejection has byte diffs', (adrResult.diffs ?? []).length > 0);
  check('first diff has hex offset', (adrResult.diffs?.[0]?.offsetHex ?? '').startsWith('0x'));

  console.log('\n[2] Synthetic non-canonical traceability rejected');
  // Build a tiny in-memory fixture by writing then reading.
  const tmpDir = await import('node:fs').then((m) => m.promises.mkdtemp('/tmp/atelier-rt-'));
  await import('node:fs').then((m) => m.promises.writeFile(`${tmpDir}/traceability.json`, JSON.stringify({
    $schema: './scripts/traceability/schema.json',
    generated_at: '2026-04-28T00:00:00Z',
    project_id: 'fixture',
    project_name: 'Fixture',
    template_version: '1.0',
    counts: {},
    entries: [
      // Non-canonical: status before docPath (should be after prototypePages)
      { id: 'X1', label: 'wrong order', kind: 'decision', status: 'DECIDED', docPath: 'a.md', docUrl: '', prototypePages: [] },
    ],
  }, null, 2) + '\n'));
  const traceFiles = await traceabilityHandler.enumerate(tmpDir);
  check('traceability file enumerated', traceFiles.length === 1);
  const traceResult = await traceabilityHandler.roundTrip(traceFiles[0]!);
  check('non-canonical traceability rejected', traceResult.ok === false);
  check('rejection has byte diffs', (traceResult.diffs ?? []).length > 0);
  await import('node:fs').then((m) => m.promises.rm(tmpDir, { recursive: true, force: true }));

  console.log('\n=========================================');
  if (failures === 0) console.log('ALL ROUND-TRIP NEGATIVE-CASE CHECKS PASSED');
  else console.log(`${failures} CHECK(S) FAILED`);
  console.log('=========================================');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SMOKE CRASHED:', err);
  process.exit(2);
});
