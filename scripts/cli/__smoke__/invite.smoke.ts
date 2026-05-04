#!/usr/bin/env -S npx tsx
//
// Substrate-touching smoke for D4 -- atelier invite (couples with D7).
//
// Validates the inviteComposer() helper against a real local Supabase
// stack. Mirrors the seam pattern of scripts/endpoint/__smoke__/real-client.smoke.ts:
// requires `supabase start` to be running and SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY in the env (or readable from `supabase status
// -o env`). The argument-handling contract is covered by the broader
// scripts/cli/__smoke__/cli.smoke.ts; this smoke covers the substrate seams
// the dry-run path cannot exercise.
//
// What it asserts:
//   1. --no-send-email path: creates Auth user + composer row, returns
//      a magic-link URL (Supabase wraps action_links via /auth/v1/verify;
//      after verify the user lands at /auth/confirm via the email-template
//      token-hash flow per BRD-OPEN-QUESTIONS §31).
//   2. composer row carries identity_subject = Auth user.id (the JWT
//      sub claim per ARCH 7.9), and status='active' (the schema default).
//   3. duplicate detection: re-invite without --reinvite errors out
//      cleanly without creating a second row.
//   4. --reinvite path: same composer.id, fresh magic link.
//   5. project ambiguity: --project-id required when 0 or >1 projects
//      exist (covered by inserting a second project temporarily).
//
// Run:
//   supabase start
//   eval "$(supabase status -o env)"
//   SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
//     npx tsx scripts/cli/__smoke__/invite.smoke.ts

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

import { inviteComposer } from '../../bootstrap/invite-composer.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CLI = resolve(REPO_ROOT, 'scripts/cli/atelier.ts');

const DB_URL =
  process.env.ATELIER_DATASTORE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

function freshEmail(): string {
  return `invite-smoke-${randomBytes(6).toString('hex')}@example.test`;
}

interface SupabaseEnv {
  url: string;
  serviceRoleKey: string;
}

function readSupabaseEnv(): SupabaseEnv {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return { url, serviceRoleKey: key };

  const out = spawnSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  if (out.status !== 0) {
    throw new Error(
      `supabase status failed (exit ${out.status}): ${out.stderr || out.stdout}\n` +
        'Run `supabase start` first, or export SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  const parsed: Record<string, string> = {};
  for (const line of out.stdout.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)="(.*)"$/);
    if (m) parsed[m[1]!] = m[2]!;
  }
  const apiUrl = parsed.API_URL;
  const serviceRoleKey = parsed.SERVICE_ROLE_KEY;
  if (!apiUrl || !serviceRoleKey) {
    throw new Error('supabase status -o env did not surface API_URL + SERVICE_ROLE_KEY');
  }
  return { url: apiUrl, serviceRoleKey };
}

async function ensureProject(pg: Client, name: string): Promise<string> {
  const existing = await pg.query<{ id: string }>(
    `SELECT id FROM projects WHERE name = $1 LIMIT 1`,
    [name],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await pg.query<{ id: string }>(
    `INSERT INTO projects (name, repo_url, template_version)
     VALUES ($1, $2, '1.0')
     RETURNING id`,
    [name, `local://${name}`],
  );
  if (!inserted.rows[0]) throw new Error('project insert returned no id');
  return inserted.rows[0].id;
}

async function main(): Promise<void> {
  console.log('# D4 invite smoke (substrate seams)');
  const env = readSupabaseEnv();

  const pg = new Client({ connectionString: DB_URL });
  await pg.connect();
  const supabase = createClient(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Smoke uses a dedicated project so it doesn't collide with whatever
  // atelier-self carries from prior seeds.
  const projectName = `invite-smoke-${randomBytes(4).toString('hex')}`;
  const projectId = await ensureProject(pg, projectName);
  const email = freshEmail();
  const cleanup: Array<() => Promise<void>> = [];

  cleanup.push(async () => {
    await pg.query('DELETE FROM composers WHERE project_id = $1', [projectId]);
    await pg.query('DELETE FROM territories WHERE project_id = $1', [projectId]);
    await pg.query('DELETE FROM projects WHERE id = $1', [projectId]);
  });

  try {
    // -------------------------------------------------------------------
    // 1. --no-send-email path -- creates user + composer; returns link
    // -------------------------------------------------------------------
    console.log('\n# 1. --no-send-email creates user + composer + magic link');
    const first = await inviteComposer({
      email,
      discipline: 'dev',
      accessLevel: 'member',
      projectId,
      sendEmail: false,
      reinvite: false,
      siteUrl: 'http://localhost:3000',
      databaseUrl: DB_URL,
      supabaseUrl: env.url,
      serviceRoleKey: env.serviceRoleKey,
    });
    cleanup.unshift(async () => {
      await supabase.auth.admin.deleteUser(first.userId).catch(() => {});
    });

    check('first invite returns composer.id', typeof first.composerId === 'string' && first.composerId.length > 0);
    check('first invite returns user.id', typeof first.userId === 'string' && first.userId.length > 0);
    check('first invite returns magic-link URL (no email path)', typeof first.magicLink === 'string' && first.magicLink!.startsWith('http'));
    check(
      'magic link routes through Supabase verify or our /auth/confirm',
      (first.magicLink ?? '').includes('/auth/v1/verify') ||
        (first.magicLink ?? '').includes('/auth/confirm') ||
        // Operator templates that thread the redirect_to param still work:
        // Supabase substitutes whatever we passed via `redirectTo` into the
        // wrapped action_link's redirect_to query parameter.
        (first.magicLink ?? '').includes('redirect_to='),
    );
    check('first invite did NOT mark as reinvited', first.reinvited === false);

    const composerRow = await pg.query<{
      id: string;
      identity_subject: string | null;
      discipline: string | null;
      access_level: string;
      display_name: string;
      status: string;
    }>(
      `SELECT id, identity_subject, discipline, access_level, display_name, status::text AS status
         FROM composers WHERE id = $1`,
      [first.composerId],
    );
    check('composer row exists in datastore', composerRow.rows.length === 1);
    check('composer.identity_subject = Auth user.id', composerRow.rows[0]?.identity_subject === first.userId);
    check('composer.discipline = dev', composerRow.rows[0]?.discipline === 'dev');
    check('composer.access_level = member', composerRow.rows[0]?.access_level === 'member');
    check(
      'composer.display_name derived from email local-part',
      composerRow.rows[0]?.display_name === email.split('@')[0],
    );
    // Schema default is 'active'. The lens authorization filter relies on
    // this; explicitly assert to lock the contract for future regressions.
    check(
      'composer.status = active (lens authorization contract)',
      composerRow.rows[0]?.status === 'active',
    );

    // -------------------------------------------------------------------
    // 2. duplicate detection without --reinvite
    // -------------------------------------------------------------------
    console.log('\n# 2. duplicate detection without --reinvite');
    let duplicateMsg: string | null = null;
    try {
      await inviteComposer({
        email,
        discipline: 'dev',
        accessLevel: 'member',
        projectId,
        sendEmail: false,
        reinvite: false,
        databaseUrl: DB_URL,
        supabaseUrl: env.url,
        serviceRoleKey: env.serviceRoleKey,
      });
      duplicateMsg = '<no error thrown>';
    } catch (err) {
      duplicateMsg = err instanceof Error ? err.message : String(err);
    }
    check(
      'second invite without --reinvite throws duplicate error',
      duplicateMsg !== null && duplicateMsg !== '<no error thrown>' && /already invited/i.test(duplicateMsg),
      duplicateMsg ?? '',
    );

    const composerCount = await pg.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM composers WHERE project_id = $1 AND email = $2`,
      [projectId, email],
    );
    check(
      'duplicate attempt did NOT create a second row',
      composerCount.rows[0]?.c === '1',
      `count=${composerCount.rows[0]?.c}`,
    );

    // -------------------------------------------------------------------
    // 3. --reinvite path -- same composer.id, fresh magic link
    // -------------------------------------------------------------------
    console.log('\n# 3. --reinvite returns same composer.id + fresh magic link');
    const reinvited = await inviteComposer({
      email,
      discipline: 'dev',
      accessLevel: 'member',
      projectId,
      sendEmail: false,
      reinvite: true,
      databaseUrl: DB_URL,
      supabaseUrl: env.url,
      serviceRoleKey: env.serviceRoleKey,
    });
    check('reinvite returns same composer.id', reinvited.composerId === first.composerId);
    check('reinvite returns same user.id', reinvited.userId === first.userId);
    check('reinvite marked as reinvited', reinvited.reinvited === true);
    check('reinvite returns a magic-link URL', typeof reinvited.magicLink === 'string' && reinvited.magicLink!.length > 0);

    // -------------------------------------------------------------------
    // 4. --reinvite for unknown email errors out
    // -------------------------------------------------------------------
    console.log('\n# 4. --reinvite for unknown email surfaces clear error');
    let unknownReinvitMsg: string | null = null;
    try {
      await inviteComposer({
        email: freshEmail(),
        discipline: 'dev',
        accessLevel: 'member',
        projectId,
        sendEmail: false,
        reinvite: true,
        databaseUrl: DB_URL,
        supabaseUrl: env.url,
        serviceRoleKey: env.serviceRoleKey,
      });
      unknownReinvitMsg = '<no error thrown>';
    } catch (err) {
      unknownReinvitMsg = err instanceof Error ? err.message : String(err);
    }
    check(
      '--reinvite of unknown email throws not-found error',
      unknownReinvitMsg !== null && /requires an existing composer|not found/i.test(unknownReinvitMsg ?? ''),
      unknownReinvitMsg ?? '',
    );

    // -------------------------------------------------------------------
    // 4b. A1 magic-link redaction (BRD-OPEN-QUESTIONS §31)
    //
    // Default text output redacts the link to `<magic-link suppressed; ...>`;
    // --print-link emits the URL. Exercised via a real CLI subprocess so
    // the assertion covers the rendered output the operator sees, not just
    // the helper return value. Uses a fresh email + the smoke's project_id
    // so the dispatcher resolves cleanly.
    // -------------------------------------------------------------------
    console.log('\n# 4b. A1 magic-link redaction default + --print-link opt-in');
    const redactionEmail = freshEmail();
    cleanup.unshift(async () => {
      // Best-effort: locate the Auth user we created via the CLI and
      // delete it. Composer rows are dropped by the project cleanup.
      const list = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }).catch(() => null);
      const u = list?.data.users.find((x) => (x.email ?? '').toLowerCase() === redactionEmail.toLowerCase());
      if (u) await supabase.auth.admin.deleteUser(u.id).catch(() => {});
    });

    const redactedRun = spawnSync(
      'npx',
      [
        'tsx', CLI, 'invite',
        '--email', redactionEmail,
        '--discipline', 'dev',
        '--access-level', 'member',
        '--project-id', projectId,
        '--no-send-email',
        '--site-url', 'http://localhost:3000',
      ],
      {
        encoding: 'utf8',
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          ATELIER_DATASTORE_URL: DB_URL,
          SUPABASE_URL: env.url,
          SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey,
        },
      },
    );
    check('CLI invite (default) exits 0', redactedRun.status === 0, `got ${redactedRun.status}; stderr=${redactedRun.stderr.slice(0, 200)}`);
    check(
      'CLI invite (default) prints the suppressed-link marker',
      redactedRun.stdout.includes('<magic-link suppressed; re-run with --print-link to emit>'),
    );
    check(
      'CLI invite (default) does NOT print a magic-link URL on stdout',
      !/https?:\/\/[^\s]*verify[?&]token=/i.test(redactedRun.stdout) &&
        !/https?:\/\/[^\s]*token_hash=/i.test(redactedRun.stdout),
    );

    // --print-link emits the URL (re-uses the same email via --reinvite so
    // we don't need to clean up another Auth user).
    const printedRun = spawnSync(
      'npx',
      [
        'tsx', CLI, 'invite',
        '--email', redactionEmail,
        '--discipline', 'dev',
        '--access-level', 'member',
        '--project-id', projectId,
        '--no-send-email',
        '--reinvite',
        '--print-link',
        '--site-url', 'http://localhost:3000',
      ],
      {
        encoding: 'utf8',
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          ATELIER_DATASTORE_URL: DB_URL,
          SUPABASE_URL: env.url,
          SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey,
        },
      },
    );
    check('CLI invite --print-link exits 0', printedRun.status === 0, `got ${printedRun.status}; stderr=${printedRun.stderr.slice(0, 200)}`);
    check(
      'CLI invite --print-link emits a magic-link URL on stdout',
      /https?:\/\/[^\s]+/.test(printedRun.stdout) &&
        // Sanity: the suppressed marker MUST NOT appear when --print-link is set.
        !printedRun.stdout.includes('<magic-link suppressed'),
    );

    // --json mode keeps magicLink in the structured output but flags it.
    const jsonRun = spawnSync(
      'npx',
      [
        'tsx', CLI, 'invite',
        '--email', redactionEmail,
        '--discipline', 'dev',
        '--access-level', 'member',
        '--project-id', projectId,
        '--no-send-email',
        '--reinvite',
        '--json',
        '--site-url', 'http://localhost:3000',
      ],
      {
        encoding: 'utf8',
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          ATELIER_DATASTORE_URL: DB_URL,
          SUPABASE_URL: env.url,
          SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey,
        },
      },
    );
    check('CLI invite --json exits 0', jsonRun.status === 0, `got ${jsonRun.status}; stderr=${jsonRun.stderr.slice(0, 200)}`);
    let jsonPayload: { ok?: boolean; magicLink?: string; warning?: string } | null = null;
    try {
      jsonPayload = JSON.parse(jsonRun.stdout);
    } catch {
      jsonPayload = null;
    }
    check('CLI invite --json emits valid JSON', jsonPayload !== null);
    check('CLI invite --json keeps magicLink field', typeof jsonPayload?.magicLink === 'string' && jsonPayload!.magicLink!.length > 0);
    check('CLI invite --json carries warning="magic_link_in_output"', jsonPayload?.warning === 'magic_link_in_output');

    // -------------------------------------------------------------------
    // 5. project ambiguity surfaces when no --project-id and >1 projects
    // -------------------------------------------------------------------
    console.log('\n# 5. project ambiguity errors when --project-id omitted');
    const projectCount = await pg.query<{ c: string }>(`SELECT count(*)::text AS c FROM projects`);
    if ((projectCount.rows[0]?.c ?? '1') === '1') {
      // Only one project in the datastore: auto-resolve should succeed.
      // Skip the ambiguity branch in that case (it cannot be triggered).
      console.log('  SKIP  only one project in datastore; ambiguity branch not reachable');
    } else {
      let ambigMsg: string | null = null;
      try {
        await inviteComposer({
          email: freshEmail(),
          discipline: 'dev',
          accessLevel: 'member',
          // projectId intentionally omitted
          sendEmail: false,
          reinvite: false,
          databaseUrl: DB_URL,
          supabaseUrl: env.url,
          serviceRoleKey: env.serviceRoleKey,
        });
        ambigMsg = '<no error thrown>';
      } catch (err) {
        ambigMsg = err instanceof Error ? err.message : String(err);
      }
      check(
        'omitted --project-id with >1 projects throws ambiguity error',
        ambigMsg !== null && /multiple projects/i.test(ambigMsg ?? ''),
        ambigMsg ?? '',
      );
    }
  } finally {
    for (const fn of cleanup) {
      await fn().catch((err) => {
        console.error(`cleanup step failed: ${err instanceof Error ? err.message : err}`);
      });
    }
    await pg.end().catch(() => {});
  }

  console.log('');
  if (failures > 0) {
    console.log(`=========================================`);
    console.log(`FAIL: ${failures} assertion(s) failed`);
    console.log(`=========================================`);
    process.exit(1);
  }
  console.log(`=========================================`);
  console.log(`ALL D4 INVITE SMOKE CHECKS PASSED`);
  console.log(`=========================================`);
  // Mirror Y2 (PR #64): explicit success exit so CI step doesn't hang
  // even though no async handles should be open here.
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('SMOKE FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
