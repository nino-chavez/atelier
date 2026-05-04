// Per-seed probe: shows the top-10 fused results for every seed at the
// configured strategy. Used during M5-entry calibration to audit the seed
// set against actual retriever behavior.
import { Pool } from 'pg';
import { findSimilar } from '../../endpoint/lib/find-similar.ts';
import { loadFindSimilarConfig } from '../../coordination/lib/embed-config.ts';
import { createOpenAICompatibleEmbeddingsService } from '../../coordination/adapters/openai-compatible-embeddings.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

interface Seed { id: string; query: string; trace_id?: string; expected: string[] }

async function main(): Promise<void> {
  const projectId = process.argv[process.argv.indexOf('--project') + 1]!;
  const config = loadFindSimilarConfig(process.cwd());
  const seeds = (parseYaml(
    readFileSync(resolve(process.cwd(), config.evalSetPath, 'seeds.yaml'), 'utf8'),
  ) as { seeds: Seed[] }).seeds;
  const embedder = createOpenAICompatibleEmbeddingsService({
    baseUrl: config.yaml.embeddings.base_url,
    modelName: config.yaml.embeddings.model_name,
    dimensions: config.yaml.embeddings.dimensions,
    apiKeyEnv: config.yaml.embeddings.api_key_env,
  });
  const pool = new Pool({ connectionString: process.env['POSTGRES_URL']! });
  for (const seed of seeds) {
    const r = await findSimilar(
      projectId,
      { description: seed.query, ...(seed.trace_id ? { trace_id: seed.trace_id } : {}) },
      { pool, embedder, config: { ...config.thresholds, defaultThreshold: 0, weakSuggestionThreshold: 0, topKPerBand: 10 } },
    );
    console.log(`\n[${seed.id}] expected: ${seed.expected.map((e) => e.split('/').pop()!.slice(0, 30)).join(', ')}`);
    r.primary_matches.slice(0, 10).forEach((m, i) => {
      const tag = seed.expected.includes(m.source_ref) ? '★' : ' ';
      console.log(`  ${tag} #${(i + 1).toString().padStart(2)} ${m.score.toFixed(4)} ${m.source_ref.split('/').pop()!.slice(0, 60)}`);
    });
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
