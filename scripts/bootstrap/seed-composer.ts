// Local-bootstrap helper: seed a Supabase Auth user + matching Atelier
// composer row (and the canonical atelier-self project, if missing).
//
// Per docs/user/tutorials/local-bootstrap.md step 3. The substantive flow
// is identical to scripts/endpoint/__smoke__/real-client.smoke.ts -- this
// script just packages the seed pattern as a small CLI so the runbook
// doesn't ask operators to read the smoke and copy bits out of it.
//
// Idempotent: re-running with the same email is a no-op for the auth user
// (returns the existing user.id) and a no-op for the composer row
// (UPSERT on (project_id, email)). The project row is upserted on `name`.
//
// Run:
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
//   npx tsx scripts/bootstrap/seed-composer.ts \
//     --email you@example.com \
//     --password <strong throwaway pwd> \
//     --discipline architect \
//     --access-level admin

import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

interface Args {
  email: string;
  password: string;
  discipline: string;
  accessLevel: string;
  projectName: string;
  databaseUrl: string;
}

function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = next;
      i += 1;
    }
  }
  const email = out.email;
  const password = out.password;
  if (!email) throw new Error('--email is required');
  if (!password) throw new Error('--password is required');
  return {
    email,
    password,
    discipline: out.discipline ?? 'architect',
    accessLevel: out['access-level'] ?? 'admin',
    projectName: out['project-name'] ?? 'atelier-self',
    databaseUrl:
      out['database-url'] ??
      process.env.POSTGRES_URL ??
      process.env.ATELIER_DATASTORE_URL ??
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) throw new Error('SUPABASE_URL env var required');
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY env var required');

  console.log(`[seed] api      ${supabaseUrl}`);
  console.log(`[seed] email    ${args.email}`);
  console.log(`[seed] project  ${args.projectName}`);

  // -------------------------------------------------------------------
  // Supabase Auth user
  // -------------------------------------------------------------------
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let userId: string;
  const created = await admin.auth.admin.createUser({
    email: args.email,
    password: args.password,
    email_confirm: true,
  });
  if (created.error) {
    // If the user already exists, look them up via listUsers (no
    // direct getUserByEmail in admin SDK). The createUser error message
    // contains "already been registered" on the dup path.
    const message = created.error.message ?? '';
    const isDup = /already.*registered|exists/i.test(message);
    if (!isDup) {
      throw new Error(`admin.createUser failed: ${message}`);
    }
    const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (list.error) throw new Error(`admin.listUsers failed: ${list.error.message}`);
    const existing = list.data.users.find((u) => u.email === args.email);
    if (!existing) {
      throw new Error(
        `createUser said duplicate but listUsers does not surface ${args.email}; rerun with a different email`,
      );
    }
    userId = existing.id;
    console.log(`[seed] auth user already existed; user.id = ${userId}`);
  } else if (!created.data.user) {
    throw new Error('createUser returned no error but no user');
  } else {
    userId = created.data.user.id;
    console.log(`[seed] auth user created;       user.id = ${userId}`);
  }

  // -------------------------------------------------------------------
  // Project + composer rows
  // -------------------------------------------------------------------
  const pg = new Client({ connectionString: args.databaseUrl });
  await pg.connect();
  try {
    // projects.name has no unique constraint at the schema level (per
    // M1 schema), so we can't ON CONFLICT here -- the conflict target
    // doesn't exist and ON CONFLICT DO NOTHING without a target only
    // catches actual constraint violations, which never fires for name.
    // SELECT-then-INSERT is the idempotent shape that works.
    const existingProject = await pg.query<{ id: string }>(
      `SELECT id FROM projects WHERE name = $1 LIMIT 1`,
      [args.projectName],
    );
    let projectId: string;
    if (existingProject.rows[0]) {
      projectId = existingProject.rows[0].id;
      console.log(`[seed] project already existed; project.id = ${projectId}`);
    } else {
      const inserted = await pg.query<{ id: string }>(
        `INSERT INTO projects (name, repo_url, template_version)
         VALUES ($1, $2, '1.0')
         RETURNING id`,
        [args.projectName, `local://${args.projectName}`],
      );
      const newId = inserted.rows[0]?.id;
      if (!newId) throw new Error('project insert returned no id');
      projectId = newId;
      console.log(`[seed] project created;        project.id = ${projectId}`);
    }

    const composerRes = await pg.query<{ id: string }>(
      `INSERT INTO composers (project_id, email, display_name, discipline, access_level, identity_subject)
       VALUES ($1, $2, $3, $4::composer_discipline, $5::composer_access_level, $6)
       ON CONFLICT (project_id, email) DO UPDATE
         SET identity_subject = EXCLUDED.identity_subject,
             discipline       = EXCLUDED.discipline,
             access_level     = EXCLUDED.access_level
       RETURNING id`,
      [
        projectId,
        args.email,
        args.email.split('@')[0] ?? args.email,
        args.discipline,
        args.accessLevel,
        userId,
      ],
    );
    const composerId = composerRes.rows[0]?.id;
    if (!composerId) throw new Error('composer upsert returned no id');
    console.log(`[seed] composer upserted;       composer.id = ${composerId}`);

    // Seed at least one territory so /atelier panels render real data.
    await pg.query(
      `INSERT INTO territories (project_id, name, owner_role, scope_kind, scope_pattern)
       VALUES ($1, 'bootstrap', $2::composer_discipline, 'files', ARRAY['**'])
       ON CONFLICT (project_id, name) DO NOTHING`,
      [projectId, args.discipline],
    );

    console.log('');
    console.log('[seed] DONE. Next steps:');
    console.log('  1. Issue a bearer token:');
    console.log(`     SUPABASE_URL=${supabaseUrl} \\`);
    console.log('     SUPABASE_ANON_KEY=<anon key> \\');
    console.log(`     npx tsx scripts/bootstrap/issue-bearer.ts --email ${args.email} --password '<password>'`);
    console.log('  2. Start the prototype dev server (runbook step 5).');
    console.log('  3. Configure your MCP client (runbook step 6).');
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error('SEED FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
