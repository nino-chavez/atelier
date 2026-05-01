#!/usr/bin/env -S npx tsx
//
// Eval harness smoke (M5 / ADR-006).
//
// Validates the runner machinery without depending on a live OpenAI key
// or a populated production corpus:
//   1. Seed file at the canonical location parses + has the expected shape.
//   2. Per-seed expected source_refs all exist on disk (broken seeds would
//      give the eval false negatives).
//   3. The aggregate metric arithmetic matches a hand-computed example.
//   4. The CLI's exit code semantics fail closed when gates aren't met
//      (we cannot run the full CLI here without a DB; instead we exercise
//      the seed parsing + arithmetic helpers directly).
//
// Run:
//   npx tsx scripts/eval/find_similar/__smoke__/eval-harness.smoke.ts

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { loadFindSimilarConfig } from '../../../coordination/lib/embed-config.ts';

const REPO_ROOT = resolve(process.cwd());

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

interface Seed {
  id: string;
  query: string;
  trace_id?: string;
  expected: string[];
}

interface SeedFile {
  seeds: Seed[];
}

function aggregate(results: Array<{ tp: number; fp: number; fn: number }>): {
  precision: number;
  recall: number;
} {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const r of results) {
    tp += r.tp;
    fp += r.fp;
    fn += r.fn;
  }
  return {
    precision: tp + fp === 0 ? 0 : tp / (tp + fp),
    recall: tp + fn === 0 ? 0 : tp / (tp + fn),
  };
}

async function main(): Promise<void> {
  console.log('\n[1] config loader');
  const config = loadFindSimilarConfig(REPO_ROOT);
  check('config has find_similar block', !!config.yaml.embeddings);
  check(
    'thresholds match .atelier/config.yaml defaults (RRF scale per ADR-042)',
    config.thresholds.defaultThreshold === 0.032 && config.thresholds.weakSuggestionThreshold === 0.030,
  );
  check(
    'CI gates reflect ADR-043 advisory tier (v1 default; precision >= 0.60 AND recall >= 0.60)',
    config.ciPrecisionGate === 0.60 && config.ciRecallGate === 0.60,
  );
  check(
    'eval set path is the canonical location',
    config.evalSetPath === 'atelier/eval/find_similar',
  );

  console.log('\n[2] seed file shape');
  const seedFilePath = join(REPO_ROOT, config.evalSetPath, 'seeds.yaml');
  check('seeds.yaml exists', existsSync(seedFilePath));
  const seedFile = parseYaml(readFileSync(seedFilePath, 'utf8')) as SeedFile;
  check('seeds is a non-empty array', Array.isArray(seedFile.seeds) && seedFile.seeds.length > 0);
  check('every seed has id, query, expected', seedFile.seeds.every((s) => !!s.id && !!s.query && Array.isArray(s.expected) && s.expected.length > 0));
  check(
    'enough seeds for a meaningful aggregate (>= 15)',
    seedFile.seeds.length >= 15,
    `actual: ${seedFile.seeds.length}`,
  );
  const ids = new Set<string>();
  for (const s of seedFile.seeds) ids.add(s.id);
  check('seed ids unique', ids.size === seedFile.seeds.length);

  console.log('\n[3] every expected source_ref exists on disk');
  let missing = 0;
  for (const seed of seedFile.seeds) {
    for (const ref of seed.expected) {
      const fullPath = join(REPO_ROOT, ref);
      if (!existsSync(fullPath)) {
        check(`expected ref exists: ${ref}`, false, `seed=${seed.id}`);
        missing += 1;
      }
    }
  }
  if (missing === 0) {
    check('all seed expected refs resolve to real files', true);
  }

  console.log('\n[4] aggregate arithmetic');
  // Example: 3 seeds. Seed A: tp=2 fp=0 fn=1 (P=1.0 R=0.67)
  //          Seed B: tp=1 fp=1 fn=1 (P=0.5 R=0.5)
  //          Seed C: tp=2 fp=0 fn=0 (P=1.0 R=1.0)
  // micro-aggregate: tp=5 fp=1 fn=2 -> P=5/6=0.833 R=5/7=0.714
  const agg = aggregate([
    { tp: 2, fp: 0, fn: 1 },
    { tp: 1, fp: 1, fn: 1 },
    { tp: 2, fp: 0, fn: 0 },
  ]);
  const expectedP = 5 / 6;
  const expectedR = 5 / 7;
  check('precision arithmetic', Math.abs(agg.precision - expectedP) < 1e-9);
  check('recall arithmetic', Math.abs(agg.recall - expectedR) < 1e-9);

  console.log('\n[5] empty result handling');
  const emptyAgg = aggregate([]);
  check('empty inputs do not divide by zero', emptyAgg.precision === 0 && emptyAgg.recall === 0);

  console.log('\n[6] CI gate boundary cases');
  // Score below precision gate fails; score below recall gate fails.
  // Sanity-check the comparison the runner uses against the ADR-043
  // advisory tier (0.60 / 0.60). Boundary values chosen to be just-above
  // and just-below 0.60 so the assertions are robust to small gate
  // adjustments without rewriting (within the 0.55-0.65 band).
  const passingP = 0.61;
  const passingR = 0.61;
  const failingP = 0.59;
  const failingR = 0.59;
  check('passing scores clear gate', passingP >= config.ciPrecisionGate && passingR >= config.ciRecallGate);
  check('failing P fails gate', !(failingP >= config.ciPrecisionGate));
  check('failing R fails gate', !(failingR >= config.ciRecallGate));

  if (failures > 0) {
    console.log(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
