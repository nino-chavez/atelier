// Unit-level smoke for the per-project git committer (ARCH 7.8 / ADR-023).
//
// Exercises the committer in isolation against a temp git repo:
//   - File rendering (frontmatter shape per ADR-030 + ADR-037)
//   - Commit attribution (`<displayName> via Atelier <bot-email>` author +
//     `Co-Authored-By: <displayName> <composer email>` trailer)
//   - Concurrent commits serialize on the per-instance mutex
//   - Idempotency cache: same `(sessionId, idempotencyKey)` returns cached SHA
//   - Commit-fails rollback: missing working dir / git failure surfaces
//     INTERNAL with no orphaned file
//   - Slug edge cases: very long summary, special chars, multi-line
//
// Run:  npx tsx scripts/endpoint/__smoke__/committer.smoke.ts
//
// Does NOT require Postgres. Spawns `git` as a subprocess; CI already has
// it installed.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createGitCommitter,
  renderAdrFile,
  type AdrCommitPayload,
  type ComposerIdentity,
} from '../lib/committer.ts';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------
// Test repo fixtures
// ---------------------------------------------------------------------------

interface TempRepo {
  workingDir: string;
  remoteDir: string;
  cleanup(): Promise<void>;
}

async function newTempRepoPair(): Promise<TempRepo> {
  // remote/ is a bare repo serving as `origin`; working/ clones from it.
  const root = await mkdtemp(path.join(os.tmpdir(), 'atelier-committer-'));
  const remoteDir = path.join(root, 'remote.git');
  const workingDir = path.join(root, 'working');

  await runGit(['init', '--bare', remoteDir], root);
  await runGit(['clone', remoteDir, workingDir], root);
  await runGit(['config', 'user.email', 'bootstrap@smoke.invalid'], workingDir);
  await runGit(['config', 'user.name', 'bootstrap'], workingDir);
  // Empty seed commit so HEAD exists -- subsequent commits are non-orphans.
  await runGit(['commit', '--allow-empty', '-m', 'seed'], workingDir);
  await runGit(['branch', '-M', 'main'], workingDir);
  await runGit(['push', '-u', 'origin', 'main'], workingDir);

  return {
    workingDir,
    remoteDir,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.stderr.on('data', (c: Buffer) => err.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`git ${args.join(' ')} (exit ${code}): ${Buffer.concat(err).toString('utf8')}`));
    });
  });
}

const composer: ComposerIdentity = {
  composerId: '11111111-2222-3333-4444-555555555555',
  displayName: 'Smoke Tester',
  email: 'smoke-tester@example.invalid',
};

function payloadFor(adrNumber: number, opts: Partial<AdrCommitPayload> = {}): AdrCommitPayload {
  const adrId = `ADR-${String(adrNumber).padStart(3, '0')}`;
  const slug = opts.allocation?.slug ?? `committer-smoke-${adrNumber}`;
  return {
    allocation: opts.allocation ?? {
      adrId,
      slug,
      adrNumber,
      repoPath: `docs/architecture/decisions/${adrId}-${slug}.md`,
    },
    category: opts.category ?? 'architecture',
    summary: opts.summary ?? `Committer smoke ADR ${adrNumber}`,
    rationale: opts.rationale ?? 'A test rationale that proves the committer wires the file end-to-end.',
    traceIds: opts.traceIds ?? ['ADR-023'],
    reverses: opts.reverses ?? null,
    triggeredByContributionId: opts.triggeredByContributionId ?? null,
    composer: opts.composer ?? composer,
    sessionId: opts.sessionId ?? '99999999-aaaa-bbbb-cccc-dddddddddddd',
    projectId: opts.projectId ?? '88888888-1111-1111-1111-111111111111',
    idempotencyKey: opts.idempotencyKey ?? null,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // -------------------------------------------------------------------
  // [1] renderAdrFile produces ADR-030 + ADR-037 frontmatter shape
  // -------------------------------------------------------------------
  console.log('\n[1] renderAdrFile frontmatter (ADR-030 + ADR-037)');
  const rendered = renderAdrFile(payloadFor(141, {
    summary: 'Render check',
    reverses: 'ADR-099',
    triggeredByContributionId: 'aaaa1111-bbbb-2222-cccc-3333dddd4444',
  }));
  check('frontmatter starts with --- delimiter', rendered.startsWith('---\n'));
  check('frontmatter contains id field', /^id: ADR-141$/m.test(rendered));
  check('frontmatter contains category field', /^category: architecture$/m.test(rendered));
  check('frontmatter contains composer field', /^composer: Smoke Tester$/m.test(rendered));
  check('frontmatter contains reverses field', /^reverses: ADR-099$/m.test(rendered));
  check(
    'frontmatter contains triggered_by_contribution_id field',
    /^triggered_by_contribution_id: aaaa1111-/m.test(rendered),
  );
  check('frontmatter contains timestamp ISO', /^timestamp: \d{4}-\d{2}-\d{2}T/m.test(rendered));
  check('body contains H1 title from summary', /^# Render check$/m.test(rendered));
  check('body contains **Summary.** marker', /\*\*Summary\.\*\*/.test(rendered));
  check('body contains **Rationale.** marker', /\*\*Rationale\.\*\*/.test(rendered));

  // multi trace_id list
  const multi = renderAdrFile(payloadFor(142, { traceIds: ['ADR-023', 'BRD:Epic-16'] }));
  check('multi-trace renders YAML inline list', /^trace_id: \[ADR-023, BRD:Epic-16\]$/m.test(multi));

  // -------------------------------------------------------------------
  // [2] commit happy-path: file written, commit lands, push reaches remote
  // -------------------------------------------------------------------
  console.log('\n[2] commit() happy-path against temp repo');
  const happy = await newTempRepoPair();
  try {
    const c1 = createGitCommitter({
      workingDir: happy.workingDir,
      botIdentity: { email: 'atelier-bot@committer-smoke' },
    });
    const sha = await c1.commit(payloadFor(200));
    check('returns 40-char sha (git rev-parse HEAD)', /^[0-9a-f]{40}$/.test(sha), `got "${sha}"`);

    // File present on disk
    const filePath = path.join(happy.workingDir, payloadFor(200).allocation.repoPath);
    const fst = await stat(filePath);
    check('ADR file exists on disk', fst.isFile());

    // Commit author shape
    const authorLine = (await runGit(['log', '-1', '--pretty=%an <%ae>'], happy.workingDir)).trim();
    check(
      'author = "<displayName> via Atelier <bot-email>"',
      authorLine === 'Smoke Tester via Atelier <atelier-bot@committer-smoke>',
      authorLine,
    );

    // Co-Authored-By trailer
    const body = await runGit(['log', '-1', '--pretty=%B'], happy.workingDir);
    check(
      'commit body contains Co-Authored-By trailer',
      body.includes('Co-Authored-By: Smoke Tester <smoke-tester@example.invalid>'),
      body.trim(),
    );
    check('commit subject contains ADR-200', body.startsWith('ADR-200: Committer smoke ADR 200'));

    // Push reached the bare remote
    const remoteLog = (await runGit(['log', '--oneline', 'main'], happy.remoteDir)).split('\n');
    check('remote received the push (>= 2 commits)', remoteLog.length >= 2, `commits: ${remoteLog.length}`);
  } finally {
    await happy.cleanup();
  }

  // -------------------------------------------------------------------
  // [3] idempotency: same key returns cached SHA, no second commit
  // -------------------------------------------------------------------
  console.log('\n[3] idempotency cache replay');
  const idem = await newTempRepoPair();
  try {
    const c2 = createGitCommitter({
      workingDir: idem.workingDir,
      botIdentity: { email: 'atelier-bot@committer-smoke' },
    });
    const k = 'idem-key-1';
    const first = await c2.commit(payloadFor(300, { idempotencyKey: k }));
    const before = (await runGit(['log', '--oneline', 'main'], idem.workingDir)).split('\n').length;

    // Second call with the SAME key but DIFFERENT allocation (would land at a
    // different ADR-NNN in production). Cache must short-circuit and return
    // the original SHA without writing the second file.
    const second = await c2.commit(payloadFor(301, { idempotencyKey: k }));
    check('second call with same key returns cached sha', first === second, `first=${first} second=${second}`);

    const after = (await runGit(['log', '--oneline', 'main'], idem.workingDir)).split('\n').length;
    check('no additional commit produced on cache hit', before === after, `before=${before} after=${after}`);

    // Different key produces a fresh commit
    const third = await c2.commit(payloadFor(302, { idempotencyKey: 'idem-key-2' }));
    check('different idempotency key produces a different sha', third !== first);
  } finally {
    await idem.cleanup();
  }

  // -------------------------------------------------------------------
  // [4] concurrency: per-instance mutex serializes parallel commits
  // -------------------------------------------------------------------
  console.log('\n[4] concurrency: parallel commits serialize on the mutex');
  const conc = await newTempRepoPair();
  try {
    const c3 = createGitCommitter({
      workingDir: conc.workingDir,
      botIdentity: { email: 'atelier-bot@committer-smoke' },
    });
    const N = 5;
    const payloads = Array.from({ length: N }, (_, i) => payloadFor(400 + i));
    const shas = await Promise.all(payloads.map((p) => c3.commit(p)));
    check('all parallel commits produced a sha', shas.every((s) => /^[0-9a-f]{40}$/.test(s)));
    check('all parallel SHAs are distinct (linear history)', new Set(shas).size === N);
    const lines = (await runGit(['log', '--oneline', 'main'], conc.workingDir))
      .split('\n')
      .filter(Boolean);
    // seed + N commits.
    check(`linear log shows seed + ${N} commits`, lines.length === N + 1, `lines=${lines.length}`);

    // Each ADR file lands at its own path
    for (const p of payloads) {
      const fp = path.join(conc.workingDir, p.allocation.repoPath);
      const st = await stat(fp).catch(() => null);
      check(`ADR file present for ${p.allocation.adrId}`, st?.isFile() === true);
    }
  } finally {
    await conc.cleanup();
  }

  // -------------------------------------------------------------------
  // [5] commit-fails rollback: missing workingDir surfaces INTERNAL,
  //     committer doesn't leak file artifacts
  // -------------------------------------------------------------------
  console.log('\n[5] commit-fails rollback semantics');
  const fail = await newTempRepoPair();
  try {
    // Force a commit failure by clearing user.email in the working clone +
    // unsetting GIT_AUTHOR_NAME etc. -- easier: point at a non-git dir.
    const nonGit = await mkdtemp(path.join(os.tmpdir(), 'atelier-committer-nongit-'));
    try {
      const c4 = createGitCommitter({
        workingDir: nonGit,
        botIdentity: { email: 'atelier-bot@committer-smoke' },
        push: false,
      });
      let caught = false;
      let messageOk = false;
      try {
        await c4.commit(payloadFor(500));
      } catch (err) {
        caught = true;
        messageOk = (err as Error).message.includes('committer failed during commit');
      }
      check('commit against non-git workingDir throws', caught);
      check('error message names committer commit phase', messageOk);

      // The render still wrote the file -- the rollback removes it.
      const filePath = path.join(nonGit, payloadFor(500).allocation.repoPath);
      let exists = true;
      try {
        await stat(filePath);
      } catch {
        exists = false;
      }
      check('rolled back file is removed on commit failure', !exists);
    } finally {
      await rm(nonGit, { recursive: true, force: true });
    }
  } finally {
    await fail.cleanup();
  }

  // -------------------------------------------------------------------
  // [6] slug edge cases: long summary, special chars
  // -------------------------------------------------------------------
  console.log('\n[6] slug edge cases (long summary, special chars)');
  const slugs = await newTempRepoPair();
  try {
    const c5 = createGitCommitter({
      workingDir: slugs.workingDir,
      botIdentity: { email: 'atelier-bot@committer-smoke' },
    });
    // The committer accepts a slug from upstream (allocation); it does not
    // re-slug. Smoke covers the file path landing correctly with a long /
    // unusual slug so reviewers see the committer is slug-agnostic.
    const longSlug = 'a-' + 'b'.repeat(80);
    const longPath = `docs/architecture/decisions/ADR-601-${longSlug}.md`;
    const longSha = await c5.commit(payloadFor(601, {
      allocation: { adrId: 'ADR-601', slug: longSlug, adrNumber: 601, repoPath: longPath },
      summary: 'Long slug edge case: ' + 'x'.repeat(120),
    }));
    check('long-slug commit returns sha', /^[0-9a-f]{40}$/.test(longSha));
    const longExists = await stat(path.join(slugs.workingDir, longPath)).then(
      (s) => s.isFile(),
      () => false,
    );
    check('long-slug ADR file lands at expected path', longExists);

    // Special-char slug: hyphens + underscores + numbers (committer doesn't
    // touch the slug; this proves the path is honored verbatim).
    const oddSlug = 'mixed_case-and-Numbers-123';
    const oddPath = `docs/architecture/decisions/ADR-602-${oddSlug}.md`;
    await c5.commit(payloadFor(602, {
      allocation: { adrId: 'ADR-602', slug: oddSlug, adrNumber: 602, repoPath: oddPath },
      summary: 'Slug with underscores and "double quotes" inside summary',
    }));
    const oddExists = await stat(path.join(slugs.workingDir, oddPath)).then(
      (s) => s.isFile(),
      () => false,
    );
    check('odd-slug ADR file lands at expected path', oddExists);

    // Multi-trace_id renders correctly in the file
    const multiPath = 'docs/architecture/decisions/ADR-603-multi-trace.md';
    await c5.commit(payloadFor(603, {
      allocation: { adrId: 'ADR-603', slug: 'multi-trace', adrNumber: 603, repoPath: multiPath },
      traceIds: ['US-1.1', 'BRD:Epic-2', 'NF-3'],
    }));
    const multiBody = await readFile(path.join(slugs.workingDir, multiPath), 'utf8');
    check(
      'multi-trace ADR body has YAML inline list',
      /^trace_id: \[US-1\.1, BRD:Epic-2, NF-3\]$/m.test(multiBody),
      multiBody.split('\n').slice(0, 12).join(' | '),
    );
  } finally {
    await slugs.cleanup();
  }

  // -------------------------------------------------------------------
  // [7] push=false toggles off the push step (smoke uses bare remote already
  //     in [2]; this confirms the toggle works against a no-remote workdir)
  // -------------------------------------------------------------------
  console.log('\n[7] push=false skips the push step');
  const noPushRoot = await mkdtemp(path.join(os.tmpdir(), 'atelier-committer-nopush-'));
  try {
    await runGit(['init', '-q', noPushRoot], noPushRoot);
    await runGit(['config', 'user.email', 'bootstrap@smoke.invalid'], noPushRoot);
    await runGit(['config', 'user.name', 'bootstrap'], noPushRoot);
    await runGit(['commit', '--allow-empty', '-q', '-m', 'seed'], noPushRoot);
    await runGit(['branch', '-M', 'main'], noPushRoot);

    const c6 = createGitCommitter({
      workingDir: noPushRoot,
      botIdentity: { email: 'atelier-bot@committer-smoke' },
      push: false,
    });
    const sha = await c6.commit(payloadFor(700));
    check('push=false commit returns sha', /^[0-9a-f]{40}$/.test(sha));
    // No remote configured; if push had run it would have failed. The fact
    // that we got here proves push was skipped.
  } finally {
    await rm(noPushRoot, { recursive: true, force: true });
  }

  console.log('');
  if (failures > 0) {
    console.log(`=========================================`);
    console.log(`FAIL: ${failures} assertion(s) failed`);
    console.log(`=========================================`);
    process.exit(1);
  }
  console.log(`=========================================`);
  console.log(`ALL COMMITTER SMOKE CHECKS PASSED`);
  console.log(`=========================================`);
}

main().catch((err) => {
  console.error('COMMITTER SMOKE TEST CRASHED:', err);
  process.exit(2);
});
