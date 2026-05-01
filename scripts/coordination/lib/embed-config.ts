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
  ci_precision_gate: number;
  ci_recall_gate: number;
  top_k_per_band?: number;
}

export interface LoadedFindSimilarConfig {
  yaml: FindSimilarYamlBlock;
  thresholds: FindSimilarConfig;
  evalSetPath: string;
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
  return {
    yaml: block,
    thresholds: {
      defaultThreshold: block.default_threshold ?? DEFAULT_FIND_SIMILAR_CONFIG.defaultThreshold,
      weakSuggestionThreshold:
        block.weak_suggestion_threshold ?? DEFAULT_FIND_SIMILAR_CONFIG.weakSuggestionThreshold,
      topKPerBand: block.top_k_per_band ?? DEFAULT_FIND_SIMILAR_CONFIG.topKPerBand,
    },
    evalSetPath: block.eval_set_path ?? 'atelier/eval/find_similar',
    ciPrecisionGate: block.ci_precision_gate ?? 0.75,
    ciRecallGate: block.ci_recall_gate ?? 0.6,
  };
}
