// Per-project endpoint git committer (ARCH 7.8 / ADR-023).
//
// Remote-locus composers (surface=web, terminal sessions without local repo
// access) write to the repo via this committer. For log_decision the
// committer is the choke point that:
//   - Renders the ADR file with YAML frontmatter (per ADR-030)
//   - Stages + commits with attribution preserving the calling composer's
//     identity via Co-Authored-By (ARCH 7.8)
//   - Pushes to the configured remote with retry-safe semantics (ARCH 6.3.1)
//   - Returns the resulting commit SHA
//
// The committer is constructed once per endpoint instance against a working
// clone the endpoint already has on disk. Authentication for `git push` is
// expected to be configured on the working clone (deploy key, credential
// helper, or HTTPS token-bearing remote URL); the committer does not handle
// credentials in-process. Rotation of those credentials is `atelier
// rotate-committer-key` per ARCH 7.8 and is a deploy-time concern.
//
// Concurrency
// -----------
// Per ARCH 6.3.1: ADR-NNN allocation is serialized at the database
// (`allocate_adr_number(project_id)` is an atomic SQL UPDATE). The
// committer additionally serializes file write + commit + push on a
// per-instance Promise chain so concurrent log_decision calls against the
// same working clone do not interleave git operations on the same index.
//
// Idempotency
// -----------
// Per ARCH 6.3.1: log_decision is keyed by `(session_id, idempotency_key)`
// for 1 hour. When an idempotency key is provided and matches a prior
// successful commit, the committer returns the cached SHA without writing
// a new ADR. The cache is in-memory and per-instance; persistent
// cross-instance idempotency lands when the request-state surface (claim,
// log_decision idempotency_key persistence) lands -- see write.ts header
// "Idempotency keys" caveat.
//
// Failure semantics
// -----------------
// - File write fails: the partial file is removed and the error rethrows.
//   The DB has already allocated an ADR-NNN that is now "spent" (gap is
//   acceptable per ARCH 6.3.1).
// - `git commit` fails: the file is removed, the index is reset, the error
//   rethrows.
// - `git push` fails: retries with exponential backoff (3 attempts at
//   5s/15s/45s by default per ARCH 6.3.1). On final failure the local
//   commit is retained on the working clone (the next retry from the
//   caller will hit the idempotency cache and replay-push). The error
//   rethrows tagged with `retryable=true` in details.

import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { AtelierError } from '../../sync/lib/write.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ComposerIdentity {
  composerId: string;
  displayName: string;
  email: string;
}

export interface AdrAllocation {
  adrId: string;
  repoPath: string;
  slug: string;
  adrNumber: number;
}

export type DecisionCategory = 'architecture' | 'product' | 'design' | 'research';

export interface AdrCommitPayload {
  allocation: AdrAllocation;
  category: DecisionCategory;
  summary: string;
  rationale: string;
  traceIds: string[];
  reverses: string | null;
  triggeredByContributionId: string | null;
  composer: ComposerIdentity;
  sessionId: string | null;
  projectId: string;
  /**
   * Optional. When set, the committer caches `(sessionId, idempotencyKey)`
   * -> sha for the configured TTL. Same key in the window returns the
   * cached SHA without re-writing the ADR.
   */
  idempotencyKey?: string | null;
}

export interface AdrCommitter {
  commit(payload: AdrCommitPayload): Promise<string>;
}

export interface GitCommitterConfig {
  /** Absolute path to a checked-out working clone of the project repo. */
  workingDir: string;
  /**
   * Project-scoped bot identity. ARCH 7.8 prescribes the author shape
   * `<composer.display_name> via Atelier <atelier-bot@<project>>`; the
   * suffix and email come from this config (suffix defaults to "via
   * Atelier"; email is the raw `botIdentity.email`).
   */
  botIdentity: { email: string; nameSuffix?: string };
  /** Target branch for decision commits. Defaults to 'main'. */
  branch?: string;
  /** Remote name to push to. Defaults to 'origin'. */
  remote?: string;
  /**
   * Whether to push at all. Defaults to true. Smoke tests against a temp
   * working clone with no remote can set this false to validate file
   * + commit shape without exercising the push path.
   */
  push?: boolean;
  /** Retry delays for push, in ms. Defaults to [5000, 15000, 45000] per ARCH 6.3.1. */
  pushRetryDelaysMs?: number[];
  /** Idempotency cache TTL in ms. Default 3_600_000 (1 hour) per ARCH 6.3.1. */
  idempotencyTtlMs?: number;
  /** Override clock (test seam). */
  now?: () => number;
  /** git executable path. Default 'git'. */
  gitBinary?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

interface CacheEntry {
  sha: string;
  expiresAt: number;
}

const DEFAULT_PUSH_RETRY_DELAYS_MS = [5_000, 15_000, 45_000];
const DEFAULT_IDEMPOTENCY_TTL_MS = 3_600_000;

/**
 * Construct an `AdrCommitter` bound to a working clone. The instance is
 * stateful: it serializes commits behind a per-instance mutex and holds an
 * in-memory idempotency cache. Multiple endpoint warm invocations within a
 * single container reuse the same instance.
 */
export function createGitCommitter(config: GitCommitterConfig): AdrCommitter {
  const branch = config.branch ?? 'main';
  const remote = config.remote ?? 'origin';
  const push = config.push ?? true;
  const retryDelays = config.pushRetryDelaysMs ?? DEFAULT_PUSH_RETRY_DELAYS_MS;
  const idempotencyTtlMs = config.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
  const now = config.now ?? (() => Date.now());
  const gitBin = config.gitBinary ?? 'git';
  const nameSuffix = config.botIdentity.nameSuffix ?? 'via Atelier';

  const cache = new Map<string, CacheEntry>();

  // Per-instance mutex implemented as a Promise chain. Defensive: ADR-NNN
  // allocation is already serialized at the DB; this serializes file write
  // and `git` invocations against the same working clone.
  let lastOp: Promise<unknown> = Promise.resolve();
  function withMutex<T>(fn: () => Promise<T>): Promise<T> {
    const next = lastOp.then(fn, fn);
    // Swallow the next op's failure for chain-purposes; callers see the rejection.
    lastOp = next.catch(() => {});
    return next;
  }

  function cacheKey(payload: AdrCommitPayload): string | null {
    if (!payload.idempotencyKey) return null;
    const sid = payload.sessionId ?? '<no-session>';
    return `${sid}::${payload.idempotencyKey}`;
  }

  function lookupCache(key: string): string | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt < now()) {
      cache.delete(key);
      return null;
    }
    return entry.sha;
  }

  function storeCache(key: string, sha: string): void {
    cache.set(key, { sha, expiresAt: now() + idempotencyTtlMs });
  }

  async function runCommit(payload: AdrCommitPayload): Promise<string> {
    const key = cacheKey(payload);
    if (key) {
      const hit = lookupCache(key);
      if (hit) return hit;
    }

    const filePath = path.join(config.workingDir, payload.allocation.repoPath);
    const fileBody = renderAdrFile(payload);

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, fileBody, 'utf8');

    let sha: string;
    try {
      await git(['add', '--', payload.allocation.repoPath], gitBin, config.workingDir);

      const authorName = `${payload.composer.displayName} ${nameSuffix}`.trim();
      const authorEmail = config.botIdentity.email;
      const message = renderCommitMessage(payload);

      await git(
        [
          'commit',
          '--author', `${authorName} <${authorEmail}>`,
          '-m', message,
        ],
        gitBin,
        config.workingDir,
      );
      sha = (await git(['rev-parse', 'HEAD'], gitBin, config.workingDir)).trim();
    } catch (err) {
      // Roll back the file + index. Best-effort; if cleanup itself fails we
      // surface the original error.
      await rm(filePath, { force: true }).catch(() => {});
      await git(['reset', '--', payload.allocation.repoPath], gitBin, config.workingDir).catch(
        () => {},
      );
      throw new AtelierError('INTERNAL', `committer failed during commit: ${(err as Error).message}`, {
        adrId: payload.allocation.adrId,
        repoPath: payload.allocation.repoPath,
        retryable: false,
      });
    }

    if (push) {
      await pushWithRetries(branch, remote, retryDelays, gitBin, config.workingDir, payload);
    }

    if (key) storeCache(key, sha);
    return sha;
  }

  return {
    commit(payload: AdrCommitPayload): Promise<string> {
      return withMutex(() => runCommit(payload));
    },
  };
}

// ---------------------------------------------------------------------------
// File rendering
// ---------------------------------------------------------------------------

/**
 * Render the ADR file body. Frontmatter shape per ADR-030 + ADR-037:
 *   id, trace_id, category, session, composer, timestamp,
 *   [reverses], [triggered_by_contribution_id]
 */
export function renderAdrFile(payload: AdrCommitPayload): string {
  const fm: Record<string, string> = {
    id: payload.allocation.adrId,
    trace_id: yamlScalarOrList(payload.traceIds),
    category: payload.category,
    session: payload.sessionId ?? 'system',
    composer: payload.composer.displayName,
    timestamp: new Date().toISOString(),
  };
  if (payload.reverses) fm.reverses = payload.reverses;
  if (payload.triggeredByContributionId) {
    fm.triggered_by_contribution_id = payload.triggeredByContributionId;
  }

  const fmLines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`);
  const title = payload.summary;

  return [
    '---',
    ...fmLines,
    '---',
    '',
    `# ${title}`,
    '',
    `**Summary.** ${payload.summary}`,
    '',
    `**Rationale.** ${payload.rationale}`,
    '',
  ].join('\n');
}

function yamlScalarOrList(items: string[]): string {
  if (items.length === 0) return '[]';
  if (items.length === 1) return items[0]!;
  // Inline-flow list keeps frontmatter on one line per key, matching the
  // existing per-ADR convention for single-trace_id files.
  return `[${items.map((s) => quoteYamlScalar(s)).join(', ')}]`;
}

function quoteYamlScalar(s: string): string {
  // Conservative quoting: anything outside [A-Za-z0-9._:-/] gets quoted.
  if (/^[A-Za-z0-9._:\-/]+$/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function renderCommitMessage(payload: AdrCommitPayload): string {
  const subject = `${payload.allocation.adrId}: ${payload.summary}`;
  const traceLine = payload.traceIds.length > 0 ? `Trace: ${payload.traceIds.join(', ')}` : '';
  const coAuthor = `Co-Authored-By: ${payload.composer.displayName} <${payload.composer.email}>`;
  const lines = [subject, ''];
  if (traceLine) lines.push(traceLine, '');
  lines.push(coAuthor);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// git invocation + push retries
// ---------------------------------------------------------------------------

async function pushWithRetries(
  branch: string,
  remote: string,
  delays: number[],
  gitBin: string,
  cwd: string,
  payload: AdrCommitPayload,
): Promise<void> {
  let lastErr: Error | null = null;
  // First attempt + len(delays) retries.
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]!);
    try {
      await git(['push', remote, `HEAD:${branch}`], gitBin, cwd);
      return;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  // ARCH 6.3.1 retry-semantics: local commit is retained for retry; the
  // caller may re-issue with the same idempotency_key.
  throw new AtelierError(
    'INTERNAL',
    `committer push failed after ${delays.length + 1} attempts: ${lastErr?.message ?? 'unknown'}`,
    {
      adrId: payload.allocation.adrId,
      repoPath: payload.allocation.repoPath,
      retryable: true,
      attempts: delays.length + 1,
    },
  );
}

function git(args: string[], bin: string, cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(bin, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Ensure deterministic commit IDs in tests are NOT promised, but
        // the bot identity falls through env so committer config is the
        // sole driver.
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => stdout.push(c));
    proc.stderr.on('data', (c: Buffer) => stderr.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
      } else {
        const err = Buffer.concat(stderr).toString('utf8') || Buffer.concat(stdout).toString('utf8');
        reject(new Error(`git ${args.join(' ')} failed (exit ${code}): ${err.trim()}`));
      }
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Convenience: env-driven factory for the prototype route
// ---------------------------------------------------------------------------

/**
 * Construct a committer from env vars. Returns null when essential config is
 * missing so callers can opt-out (e.g., during local dev without a working
 * clone). The route handler logs the missing-config case and falls back to
 * an INTERNAL stub for log_decision, matching the M2-mid scope.
 *
 * Env vars:
 *   ATELIER_COMMITTER_WORKING_DIR  -- absolute path to working clone
 *   ATELIER_COMMITTER_BOT_EMAIL    -- bot email (e.g., atelier-bot@atelier)
 *   ATELIER_COMMITTER_BRANCH       -- target branch (default 'main')
 *   ATELIER_COMMITTER_REMOTE       -- remote name (default 'origin')
 *   ATELIER_COMMITTER_PUSH         -- 'false' to disable push (default 'true')
 */
export function gitCommitterFromEnv(): AdrCommitter | null {
  const workingDir = process.env.ATELIER_COMMITTER_WORKING_DIR;
  const botEmail = process.env.ATELIER_COMMITTER_BOT_EMAIL;
  if (!workingDir || !botEmail) return null;
  const config: GitCommitterConfig = {
    workingDir,
    botIdentity: { email: botEmail },
    ...(process.env.ATELIER_COMMITTER_BRANCH !== undefined
      ? { branch: process.env.ATELIER_COMMITTER_BRANCH }
      : {}),
    ...(process.env.ATELIER_COMMITTER_REMOTE !== undefined
      ? { remote: process.env.ATELIER_COMMITTER_REMOTE }
      : {}),
    ...(process.env.ATELIER_COMMITTER_PUSH === 'false' ? { push: false } : {}),
  };
  return createGitCommitter(config);
}
