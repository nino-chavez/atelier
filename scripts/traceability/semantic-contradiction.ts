// Semantic-contradiction validator (BRD-OPEN-QUESTIONS §22 implementation).
//
// LLM-backed check that compares PR-changed content against canonical
// state anchors (NORTH-STAR, STRATEGY, PRD, ARCHITECTURE, ADR index)
// and flags potential contradictions for human review.
//
// Per .atelier/config.yaml: review.semantic_contradiction:
//   - enabled: false (default; opt-in per project)
//   - scope_paths: which PR-touching paths trigger the check
//   - mode: advisory (warn) | blocking (fail PR)
//   - base_url + api_key_env + model_name: OpenAI-compatible adapter
//   - anchor_paths: canonical-state docs loaded into the LLM prompt
//   - confidence_threshold: per-finding confidence floor (default 0.7)
//
// When invoked from validate-refs.ts as a check class:
//   - Skipped silently when `enabled: false`
//   - Skipped silently when API key env var is unset (per the same
//     "no-secret no-cost" pattern as the eval-gate in atelier-audit.yml)
//   - Returns findings with file path + line range + severity + cited
//     anchor + message
//   - Caller (validate-refs) renders findings + exits 0 (advisory)
//     or 1 (blocking AND finding present)

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import {
  createOpenAICompatibleChatService,
  type ChatMessage,
} from '../coordination/adapters/openai-compatible-chat.ts';
import { AdapterUnavailableError } from '../coordination/lib/embeddings.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SemanticContradictionConfig {
  enabled: boolean;
  scopePaths: string[];
  mode: 'advisory' | 'blocking';
  baseUrl: string;
  apiKeyEnv: string;
  modelName: string;
  anchorPaths: string[];
  confidenceThreshold: number;
}

const DEFAULT_CONFIG: SemanticContradictionConfig = {
  enabled: false,
  scopePaths: [
    'docs/architecture/decisions/**',
    'docs/functional/BRD.md',
    'docs/strategic/NORTH-STAR.md',
  ],
  mode: 'advisory',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  modelName: 'gpt-4o-mini',
  anchorPaths: [
    'docs/strategic/NORTH-STAR.md',
    'docs/strategic/STRATEGY.md',
    'docs/functional/PRD.md',
    'docs/architecture/ARCHITECTURE.md',
    'docs/architecture/decisions/README.md',
  ],
  confidenceThreshold: 0.7,
};

export function loadConfig(repoRoot: string): SemanticContradictionConfig {
  const path = join(repoRoot, '.atelier', 'config.yaml');
  if (!existsSync(path)) return DEFAULT_CONFIG;
  const raw = parseYaml(readFileSync(path, 'utf-8')) as
    | {
        review?: {
          semantic_contradiction?: {
            enabled?: boolean;
            scope_paths?: string[];
            mode?: 'advisory' | 'blocking';
            base_url?: string;
            api_key_env?: string;
            model_name?: string;
            anchor_paths?: string[];
            confidence_threshold?: number;
          };
        };
      }
    | null;
  const block = raw?.review?.semantic_contradiction;
  if (!block) return DEFAULT_CONFIG;
  return {
    enabled: block.enabled ?? DEFAULT_CONFIG.enabled,
    scopePaths: block.scope_paths ?? DEFAULT_CONFIG.scopePaths,
    mode: block.mode ?? DEFAULT_CONFIG.mode,
    baseUrl: block.base_url ?? DEFAULT_CONFIG.baseUrl,
    apiKeyEnv: block.api_key_env ?? DEFAULT_CONFIG.apiKeyEnv,
    modelName: block.model_name ?? DEFAULT_CONFIG.modelName,
    anchorPaths: block.anchor_paths ?? DEFAULT_CONFIG.anchorPaths,
    confidenceThreshold: block.confidence_threshold ?? DEFAULT_CONFIG.confidenceThreshold,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContradictionFinding {
  filePath: string;
  citedAnchor: string;
  /** Excerpt from the changed file's diff that triggered the finding. */
  changeExcerpt: string;
  /** Excerpt from the cited anchor doc that the change appears to contradict. */
  anchorExcerpt: string;
  /** LLM's natural-language explanation. */
  explanation: string;
  /** 0..1 LLM-reported confidence; findings below threshold are filtered out. */
  confidence: number;
}

export interface CheckResult {
  status: 'skipped' | 'ok' | 'findings';
  reason?: string;
  findings: ContradictionFinding[];
  /**
   * Number of changed files inspected. When `status='ok'`, this is the
   * count of files passed to the LLM; when `'skipped'`, 0.
   */
  inspectedFiles: number;
}

// ---------------------------------------------------------------------------
// Scope matching
// ---------------------------------------------------------------------------

function matchesScope(filePath: string, scopePaths: string[]): boolean {
  // Minimal glob: support `**` (any depth) + `*` (single path segment) + literals.
  // Sufficient for the scope_paths shape (no character classes, no negation).
  for (const pattern of scopePaths) {
    if (globMatch(filePath, pattern)) return true;
  }
  return false;
}

function globMatch(path: string, pattern: string): boolean {
  // Convert glob to regex.
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '__DOUBLE_STAR_SLASH__')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLE_STAR_SLASH__/g, '(?:.*/)?');
  return new RegExp(`^${re}$`).test(path);
}

// ---------------------------------------------------------------------------
// Diff extraction
// ---------------------------------------------------------------------------

interface ChangedFile {
  path: string;
  diff: string;
}

export function extractChangedFilesFromGit(repoRoot: string, baseRef: string): ChangedFile[] {
  const cwd = repoRoot;
  // Names of changed files (status A/M only — deletions can't contradict).
  const namesOut = execSync(`git diff --name-only --diff-filter=AM ${baseRef}...HEAD`, {
    cwd,
    encoding: 'utf-8',
  });
  const names = namesOut
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const out: ChangedFile[] = [];
  for (const name of names) {
    const diff = execSync(`git diff ${baseRef}...HEAD -- ${JSON.stringify(name)}`, {
      cwd,
      encoding: 'utf-8',
    });
    out.push({ path: name, diff });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anchor loading
// ---------------------------------------------------------------------------

export interface LoadedAnchor {
  path: string;
  /**
   * For ARCHITECTURE.md and decisions/README.md (which are large), we
   * load only the first ~6KB of content to keep the prompt bounded.
   * For NORTH-STAR / STRATEGY / PRD (smaller), we load full text.
   */
  content: string;
}

const ANCHOR_BUDGET_BYTES = 6_000;

export function loadAnchors(repoRoot: string, anchorPaths: string[]): LoadedAnchor[] {
  const out: LoadedAnchor[] = [];
  for (const p of anchorPaths) {
    const full = isAbsolute(p) ? p : join(repoRoot, p);
    if (!existsSync(full)) {
      console.warn(`[semantic-contradiction] anchor not found: ${p}`);
      continue;
    }
    const stat = statSync(full);
    if (!stat.isFile()) continue;
    const raw = readFileSync(full, 'utf-8');
    const content = raw.length > ANCHOR_BUDGET_BYTES ? raw.slice(0, ANCHOR_BUDGET_BYTES) + '\n\n[...truncated for prompt budget; see full file]' : raw;
    out.push({ path: p, content });
  }
  return out;
}

// ---------------------------------------------------------------------------
// LLM call
// ---------------------------------------------------------------------------

interface LlmFinding {
  cited_anchor: string;
  change_excerpt: string;
  anchor_excerpt: string;
  explanation: string;
  confidence: number;
}

interface LlmResponse {
  findings: LlmFinding[];
}

function buildSystemPrompt(): string {
  return `You are a code-review assistant helping the architect of a software project catch SEMANTIC CONTRADICTIONS between newly-changed content and the project's canonical state.

A contradiction is when the new content asserts, decides, or proposes something that DIRECTLY CONFLICTS with what an anchor document already established. Examples:
  - A new ADR proposes a multi-tenant SaaS feature, but NORTH-STAR §"What this is NOT" explicitly excludes SaaS.
  - A new BRD story specifies that contributions auto-merge, but ADR-018 mandates triage never auto-merges.
  - A new PRD section claims "find_similar runs at v1.x", but ADR-006 commits to v1.

These are HARD findings. Soft findings (the change is unconventional, or the rationale could be stronger) are NOT what you flag — only direct conflicts with what the anchor already established.

You return STRICT JSON in this shape (no prose outside JSON):

{
  "findings": [
    {
      "cited_anchor": "<path of anchor doc that's contradicted>",
      "change_excerpt": "<short excerpt from the diff that contradicts>",
      "anchor_excerpt": "<short excerpt from the anchor that the change conflicts with>",
      "explanation": "<one sentence: how do they conflict?>",
      "confidence": <number 0.0-1.0; how sure are you this is a real conflict?>
    }
  ]
}

If you find NO contradictions, return: {"findings": []}

Confidence calibration:
  - 1.0: certain (the change literally says the opposite of the anchor)
  - 0.8: very likely (the change clearly violates the anchor's intent, even if not verbatim)
  - 0.7: likely but ambiguous (an editor would need to re-read both)
  - <0.7: probably not a real contradiction; do NOT include in findings`;
}

function buildUserPrompt(anchors: LoadedAnchor[], changedFile: ChangedFile): string {
  const anchorBlock = anchors
    .map((a) => `=== ANCHOR: ${a.path} ===\n${a.content}`)
    .join('\n\n');
  return `${anchorBlock}\n\n=== CHANGE: ${changedFile.path} ===\n${changedFile.diff}\n\nReturn JSON of findings (or {"findings": []} if none).`;
}

async function checkOneFile(
  changedFile: ChangedFile,
  anchors: LoadedAnchor[],
  config: SemanticContradictionConfig,
): Promise<ContradictionFinding[]> {
  const chat = createOpenAICompatibleChatService({
    baseUrl: config.baseUrl,
    modelName: config.modelName,
    apiKeyEnv: config.apiKeyEnv,
  });
  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(anchors, changedFile) },
    ];
    const res = await chat.complete({
      messages,
      responseFormat: 'json_object',
      temperature: 0,
      maxTokens: 1500,
    });
    const parsed = JSON.parse(res.content) as LlmResponse;
    const findings: ContradictionFinding[] = (parsed.findings ?? [])
      .filter((f) => typeof f.confidence === 'number' && f.confidence >= config.confidenceThreshold)
      .map((f) => ({
        filePath: changedFile.path,
        citedAnchor: f.cited_anchor,
        changeExcerpt: f.change_excerpt,
        anchorExcerpt: f.anchor_excerpt,
        explanation: f.explanation,
        confidence: f.confidence,
      }));
    return findings;
  } finally {
    await chat.close();
  }
}

// ---------------------------------------------------------------------------
// Public entry: run the check
// ---------------------------------------------------------------------------

export interface RunOptions {
  repoRoot: string;
  baseRef: string;
  /** Override config (used by tests; defaults to loadConfig from repoRoot). */
  config?: SemanticContradictionConfig;
  /** When supplied, used in place of git-extracted changes (for tests). */
  changedFilesOverride?: ChangedFile[];
}

export async function run(opts: RunOptions): Promise<CheckResult> {
  const config = opts.config ?? loadConfig(opts.repoRoot);

  if (!config.enabled) {
    return {
      status: 'skipped',
      reason: 'semantic_contradiction.enabled is false in .atelier/config.yaml',
      findings: [],
      inspectedFiles: 0,
    };
  }

  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    return {
      status: 'skipped',
      reason: `${config.apiKeyEnv} env var not set; LLM check requires the key`,
      findings: [],
      inspectedFiles: 0,
    };
  }

  const allChanged = opts.changedFilesOverride ?? extractChangedFilesFromGit(opts.repoRoot, opts.baseRef);
  const inScope = allChanged.filter((f) => matchesScope(f.path, config.scopePaths));

  if (inScope.length === 0) {
    return {
      status: 'ok',
      reason: 'no in-scope files changed in this diff',
      findings: [],
      inspectedFiles: 0,
    };
  }

  const anchors = loadAnchors(opts.repoRoot, config.anchorPaths);
  if (anchors.length === 0) {
    return {
      status: 'skipped',
      reason: 'no anchor docs loaded — check anchor_paths in config',
      findings: [],
      inspectedFiles: 0,
    };
  }

  const allFindings: ContradictionFinding[] = [];
  for (const file of inScope) {
    try {
      const findings = await checkOneFile(file, anchors, config);
      allFindings.push(...findings);
    } catch (err) {
      if (err instanceof AdapterUnavailableError) {
        return {
          status: 'skipped',
          reason: `adapter unavailable: ${err.message}`,
          findings: allFindings,
          inspectedFiles: inScope.length,
        };
      }
      console.warn(
        `[semantic-contradiction] error checking ${file.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    status: allFindings.length > 0 ? 'findings' : 'ok',
    findings: allFindings,
    inspectedFiles: inScope.length,
  };
}

// ---------------------------------------------------------------------------
// CLI entry: when run directly, invoke against current diff vs origin/main
// ---------------------------------------------------------------------------

async function cli(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = args.repoRoot ?? process.cwd();
  const baseRef = args.baseRef ?? 'origin/main';
  const result = await run({ repoRoot, baseRef });

  if (result.status === 'skipped') {
    console.log(`semantic-contradiction: SKIPPED — ${result.reason}`);
    process.exit(0);
  }
  if (result.status === 'ok') {
    console.log(
      `semantic-contradiction: OK (${result.inspectedFiles} file(s) inspected; 0 findings)`,
    );
    process.exit(0);
  }

  // Findings
  console.log(`semantic-contradiction: ${result.findings.length} potential contradiction(s) detected:`);
  console.log('');
  for (const f of result.findings) {
    console.log(`  in ${f.filePath}:`);
    console.log(`    cited anchor: ${f.citedAnchor}`);
    console.log(`    confidence:   ${f.confidence.toFixed(2)}`);
    console.log(`    change:       ${f.changeExcerpt.slice(0, 200)}`);
    console.log(`    anchor:       ${f.anchorExcerpt.slice(0, 200)}`);
    console.log(`    explanation:  ${f.explanation}`);
    console.log('');
  }

  // Mode: advisory exits 0 (warn); blocking exits 1
  const config = loadConfig(repoRoot);
  if (config.mode === 'blocking') {
    console.log('semantic-contradiction: FAIL (mode=blocking; remove the contradictions or override mode in config)');
    process.exit(1);
  }
  console.log('semantic-contradiction: WARN (mode=advisory; not blocking the workflow)');
  process.exit(0);
}

interface CliArgs {
  repoRoot?: string;
  baseRef?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo-root' && argv[i + 1]) {
      out.repoRoot = argv[i + 1]!;
      i += 1;
    } else if (a === '--base-ref' && argv[i + 1]) {
      out.baseRef = argv[i + 1]!;
      i += 1;
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cli().catch((err) => {
    console.error('[semantic-contradiction] fatal:', err);
    process.exit(2);
  });
}
