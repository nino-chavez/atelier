// Configuration loader for the find_similar substrate.
//
// Reads .atelier/config.yaml and produces typed shapes the embed pipeline
// + find_similar handler can consume. Single source of truth for parsing
// the find_similar block; all callers (embed-runner, eval harness, smoke
// tests, dispatcher startup) go through this module.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { type FindSimilarConfig, DEFAULT_FIND_SIMILAR_CONFIG } from '../../endpoint/lib/find-similar.ts';

export interface GateBlock {
  /** 'advisory' | 'blocking' per ADR-043. Default 'advisory'. */
  tier?: 'advisory' | 'blocking';
  advisory_precision?: number;
  advisory_recall?: number;
  blocking_precision?: number;
  blocking_recall?: number;
}

export interface FindSimilarYamlBlock {
  embeddings: {
    adapter: string;
    base_url: string;
    model_name: string;
    dimensions: number;
    api_key_env: string;
  };
  default_threshold: number;
  weak_suggestion_threshold: number;
  eval_set_path: string;
  eval_seed_file?: string;
  ci_precision_gate?: number;
  ci_recall_gate?: number;
  top_k_per_band?: number;
  /** ADR-042: 'vector' | 'hybrid'; default 'hybrid' per calibrated M5-entry data. */
  strategy?: 'vector' | 'hybrid';
  /** ADR-042: Reciprocal Rank Fusion constant k; default 60. */
  rrf_k?: number;
  /** ADR-043: gate tier split. */
  gate?: GateBlock;
}

export interface LoadedFindSimilarConfig {
  yaml: FindSimilarYamlBlock;
  thresholds: FindSimilarConfig;
  evalSetPath: string;
  evalSeedFile: string;
  gateTier: 'advisory' | 'blocking';
  ciPrecisionGate: number;
  ciRecallGate: number;
}

/**
 * Read .atelier/config.yaml and produce the typed find_similar config.
 * Throws on missing file or missing find_similar block (deploy
 * misconfiguration, fail closed).
 */
export function loadFindSimilarConfig(repoRoot: string): LoadedFindSimilarConfig {
  const configPath = join(repoRoot, '.atelier', 'config.yaml');
  if (!existsSync(configPath)) {
    throw new Error(`.atelier/config.yaml not found at ${configPath}`);
  }
  const raw = readFileSync(configPath, 'utf8');
  const parsed = parseYaml(raw) as { find_similar?: FindSimilarYamlBlock } | null;
  const block = parsed?.find_similar;
  if (!block) {
    throw new Error('.atelier/config.yaml is missing the find_similar block (ADR-041)');
  }
  if (!block.embeddings) {
    throw new Error('.atelier/config.yaml find_similar.embeddings is missing (ADR-041)');
  }
  // Gate-tier resolution per ADR-043. If a `gate` block is present and a
  // tier is selected, derive ci_precision_gate / ci_recall_gate from the
  // tier values. Explicit ci_precision_gate / ci_recall_gate override the
  // tier-derived values for ad-hoc experiments (the legacy-keys path).
  const gate = (block as FindSimilarYamlBlock & { gate?: GateBlock }).gate;
  const tier = gate?.tier ?? 'advisory';
  const tieredP =
    gate && tier === 'blocking'
      ? (gate.blocking_precision ?? 0.85)
      : (gate?.advisory_precision ?? 0.6);
  const tieredR =
    gate && tier === 'blocking'
      ? (gate.blocking_recall ?? 0.7)
      : (gate?.advisory_recall ?? 0.6);

  return {
    yaml: block,
    thresholds: {
      defaultThreshold: block.default_threshold ?? DEFAULT_FIND_SIMILAR_CONFIG.defaultThreshold,
      weakSuggestionThreshold:
        block.weak_suggestion_threshold ?? DEFAULT_FIND_SIMILAR_CONFIG.weakSuggestionThreshold,
      topKPerBand: block.top_k_per_band ?? DEFAULT_FIND_SIMILAR_CONFIG.topKPerBand,
      strategy: block.strategy ?? DEFAULT_FIND_SIMILAR_CONFIG.strategy,
      rrfK: block.rrf_k ?? DEFAULT_FIND_SIMILAR_CONFIG.rrfK,
    },
    evalSetPath: block.eval_set_path ?? 'atelier/eval/find_similar',
    evalSeedFile: block.eval_seed_file ?? 'seeds-merged.yaml',
    gateTier: tier,
    ciPrecisionGate: block.ci_precision_gate ?? tieredP,
    ciRecallGate: block.ci_recall_gate ?? tieredR,
  };
}
