// Invite a remote-principal composer (D4 substrate; couples with D7 sign-in).
//
// Creates the Supabase Auth user (or looks up the existing one when --reinvite),
// inserts the composers row, and returns either:
//   - a magic-link URL the operator shares manually (sendEmail=false), or
//   - confirmation that Supabase dispatched its invitation email (sendEmail=true).
//
// Per ADR-028 (Supabase Auth identity provider) + ADR-029 (proprietary helpers
// stay in scripts/bootstrap/* / scripts/coordination/adapters/*) + ADR-038
// (composer discipline + access_level enums) + ADR-009 (remote-principal
// actor class).
//
// Two surfaces:
//   1. `inviteComposer(opts)` exported function -- called by
//      scripts/cli/commands/invite.ts so the polished CLI command does not
//      itself import @supabase/supabase-js (per ADR-029).
//   2. Standalone runnable: `npx tsx scripts/bootstrap/invite-composer.ts ...`
//      for operators preferring the raw form, mirrored on seed-composer.ts.
//
// Idempotent in shape: --reinvite resends a fresh magic link without
// duplicating the composer row.

import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';

export const DISCIPLINES = ['analyst', 'dev', 'pm', 'designer', 'architect'] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const ACCESS_LEVELS = ['member', 'admin', 'stakeholder'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export interface InviteOptions {
  email: string;
  discipline: Discipline;
  accessLevel: AccessLevel;
  sendEmail: boolean;
  reinvite: boolean;
  /** When omitted, the helper resolves a single project from the datastore. */
  projectId?: string | undefined;
  /** When omitted, derived from the email local-part. */
  displayName?: string | undefined;
  /** Where the magic link lands the user after PKCE exchange. Defaults to
   *  `<siteUrl>/sign-in/callback?redirect=/atelier`. */
  redirectTo?: string | undefined;
  /** Public URL of the deploy. Falls back to ATELIER_PUBLIC_URL or
   *  http://localhost:3000. Used to build redirectTo when not supplied. */
  siteUrl?: string | undefined;
  /** Postgres connection string. Falls back to ATELIER_DATASTORE_URL,
   *  DATABASE_URL, or the Supabase CLI local default. */
  databaseUrl?: string | undefined;
  /** Supabase project URL (cloud or local). Falls back to SUPABASE_URL env. */
  supabaseUrl?: string | undefined;
  /** Supabase service role key. Falls back to SUPABASE_SERVICE_ROLE_KEY env. */
  serviceRoleKey?: string | undefined;
}

export interface InviteResult {
  composerId: string;
  userId: string;
  email: string;
  displayName: string;
  discipline: Discipline;
  accessLevel: AccessLevel;
  projectId: string;
  projectName: string;
  /** Set when sendEmail=false OR reinvite=true; the URL the operator shares. */
  magicLink: string | null;
  /** True when --reinvite ran against an existing composer row. */
  reinvited: boolean;
  redirectTo: string;
}

const DEFAULT_LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function buildRedirectTo(opts: InviteOptions): string {
  if (opts.redirectTo) return opts.redirectTo;
  const site =
    opts.siteUrl ??
    process.env.ATELIER_PUBLIC_URL ??
    process.env.ATELIER_ENDPOINT_URL ??
    'http://localhost:3000';
  const base = site.replace(/\/+$/, '');
  return `${base}/sign-in/callback?redirect=/atelier`;
}

function deriveDisplayName(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local || email;
}

function isDuplicateUserError(message: string): boolean {
  return /already.*registered|already.*exists|user.*exists/i.test(message);
}

async function findUserIdByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  // The admin SDK paginates listUsers; for invite flows the population is
  // small, but we still page defensively. Stop at the first match.
  const perPage = 200;
  for (let page = 1; page <= 50; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage });
    if (result.error) {
      throw new Error(`admin.listUsers failed: ${result.error.message}`);
    }
    const match = result.data.users.find(
      (u) => (u.email ?? '').toLowerCase() === email.toLowerCase(),
    );
    if (match) return match.id;
    if (result.data.users.length < perPage) return null;
  }
  return null;
}

async function resolveProjectId(
  pg: Client,
  explicit: string | undefined,
): Promise<{ id: string; name: string }> {
  if (explicit) {
    const { rows } = await pg.query<{ id: string; name: string }>(
      'SELECT id, name FROM projects WHERE id = $1',
      [explicit],
    );
    const row = rows[0];
    if (!row) {
      throw new Error(`projects.id=${explicit} not found in datastore`);
    }
    return row;
  }
  const { rows } = await pg.query<{ id: string; name: string }>(
    'SELECT id, name FROM projects ORDER BY created_at LIMIT 2',
  );
  if (rows.length === 0) {
    throw new Error(
      'no projects in datastore; run `atelier datastore init --seed` or `seed-composer.ts` first',
    );
  }
  if (rows.length > 1) {
    throw new Error(
      'multiple projects in datastore; pass --project-id <uuid> to disambiguate',
    );
  }
  return rows[0]!;
}

export async function inviteComposer(opts: InviteOptions): Promise<InviteResult> {
  const supabaseUrl = opts.supabaseUrl ?? process.env.SUPABASE_URL;
  const serviceRoleKey = opts.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL env (or supabaseUrl option) is required');
  }
  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY env (or serviceRoleKey option) is required',
    );
  }

  const databaseUrl =
    opts.databaseUrl ??
    process.env.ATELIER_DATASTORE_URL ??
    process.env.DATABASE_URL ??
    DEFAULT_LOCAL_DB_URL;

  const redirectTo = buildRedirectTo(opts);
  const displayName = opts.displayName ?? deriveDisplayName(opts.email);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try {
    const project = await resolveProjectId(pg, opts.projectId);

    const existingComposer = await pg.query<{ id: string; identity_subject: string | null }>(
      `SELECT id, identity_subject FROM composers
        WHERE project_id = $1 AND lower(email) = lower($2)
        LIMIT 1`,
      [project.id, opts.email],
    );

    if (existingComposer.rows.length > 0 && !opts.reinvite) {
      throw new Error(
        `email ${opts.email} already invited (composer.id=${existingComposer.rows[0]!.id}); pass --reinvite to resend a fresh magic link`,
      );
    }
    if (existingComposer.rows.length === 0 && opts.reinvite) {
      throw new Error(
        `--reinvite requires an existing composer for ${opts.email} in project ${project.name}; not found`,
      );
    }

    let userId: string;
    let magicLink: string | null = null;

    if (opts.reinvite) {
      const existingUserId = existingComposer.rows[0]?.identity_subject ?? null;
      const lookedUpId =
        existingUserId ?? (await findUserIdByEmail(admin, opts.email));
      if (!lookedUpId) {
        throw new Error(
          `Auth user not found for ${opts.email}; cannot reinvite without an existing user`,
        );
      }
      userId = lookedUpId;
      const linked = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: opts.email,
        options: { redirectTo },
      });
      if (linked.error) {
        throw new Error(`admin.generateLink failed: ${linked.error.message}`);
      }
      magicLink = linked.data.properties?.action_link ?? null;
    } else if (opts.sendEmail) {
      const invited = await admin.auth.admin.inviteUserByEmail(opts.email, {
        redirectTo,
        data: { display_name: displayName },
      });
      if (invited.error) {
        const msg = invited.error.message ?? '';
        if (!isDuplicateUserError(msg)) {
          throw new Error(`admin.inviteUserByEmail failed: ${msg}`);
        }
        const lookedUp = await findUserIdByEmail(admin, opts.email);
        if (!lookedUp) {
          throw new Error(
            `inviteUserByEmail said duplicate but listUsers does not surface ${opts.email}`,
          );
        }
        userId = lookedUp;
      } else {
        const user = invited.data.user;
        if (!user) {
          throw new Error('inviteUserByEmail returned neither error nor user');
        }
        userId = user.id;
      }
    } else {
      const created = await admin.auth.admin.createUser({
        email: opts.email,
        email_confirm: false,
        user_metadata: { display_name: displayName },
      });
      if (created.error) {
        const msg = created.error.message ?? '';
        if (!isDuplicateUserError(msg)) {
          throw new Error(`admin.createUser failed: ${msg}`);
        }
        const lookedUp = await findUserIdByEmail(admin, opts.email);
        if (!lookedUp) {
          throw new Error(
            `createUser said duplicate but listUsers does not surface ${opts.email}`,
          );
        }
        userId = lookedUp;
      } else if (!created.data.user) {
        throw new Error('createUser returned neither error nor user');
      } else {
        userId = created.data.user.id;
      }
      const linked = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: opts.email,
        options: { redirectTo },
      });
      if (linked.error) {
        throw new Error(`admin.generateLink failed: ${linked.error.message}`);
      }
      magicLink = linked.data.properties?.action_link ?? null;
    }

    let composerId: string;
    if (opts.reinvite) {
      composerId = existingComposer.rows[0]!.id;
      // Re-anchor identity_subject in case the Auth user was rotated.
      await pg.query(
        `UPDATE composers
            SET identity_subject = $1
          WHERE id = $2`,
        [userId, composerId],
      );
    } else {
      const inserted = await pg.query<{ id: string }>(
        `INSERT INTO composers
           (project_id, email, display_name, discipline, access_level, identity_subject)
         VALUES ($1, $2, $3, $4::composer_discipline, $5::composer_access_level, $6)
         ON CONFLICT (project_id, email) DO UPDATE
           SET identity_subject = EXCLUDED.identity_subject,
               display_name     = EXCLUDED.display_name,
               discipline       = EXCLUDED.discipline,
               access_level     = EXCLUDED.access_level
         RETURNING id`,
        [
          project.id,
          opts.email,
          displayName,
          opts.discipline,
          opts.accessLevel,
          userId,
        ],
      );
      const newId = inserted.rows[0]?.id;
      if (!newId) throw new Error('composer insert returned no id');
      composerId = newId;
    }

    return {
      composerId,
      userId,
      email: opts.email,
      displayName,
      discipline: opts.discipline,
      accessLevel: opts.accessLevel,
      projectId: project.id,
      projectName: project.name,
      magicLink,
      reinvited: opts.reinvite,
      redirectTo,
    };
  } finally {
    await pg.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Standalone CLI entrypoint (raw form; mirrors seed-composer.ts shape)
// ---------------------------------------------------------------------------

interface RawArgs {
  email?: string;
  discipline?: string;
  accessLevel?: string;
  projectId?: string;
  displayName?: string;
  sendEmail: boolean;
  reinvite: boolean;
  siteUrl?: string;
}

function parseRawArgs(argv: readonly string[]): RawArgs {
  const out: RawArgs = { sendEmail: true, reinvite: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`flag ${a} requires a value`);
      i += 1;
      return v;
    };
    switch (a) {
      case '--email': out.email = next(); break;
      case '--discipline': out.discipline = next(); break;
      case '--access-level': out.accessLevel = next(); break;
      case '--project-id': out.projectId = next(); break;
      case '--display-name': out.displayName = next(); break;
      case '--send-email': out.sendEmail = true; break;
      case '--no-send-email': out.sendEmail = false; break;
      case '--reinvite': out.reinvite = true; break;
      case '--site-url': out.siteUrl = next(); break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

async function rawCli(): Promise<void> {
  const args = parseRawArgs(process.argv.slice(2));
  if (!args.email) throw new Error('--email is required');
  if (!args.discipline) throw new Error('--discipline is required');
  if (!DISCIPLINES.includes(args.discipline as Discipline)) {
    throw new Error(`--discipline must be one of ${DISCIPLINES.join(', ')}`);
  }
  const accessLevel = (args.accessLevel ?? 'member') as AccessLevel;
  if (!ACCESS_LEVELS.includes(accessLevel)) {
    throw new Error(`--access-level must be one of ${ACCESS_LEVELS.join(', ')}`);
  }

  const result = await inviteComposer({
    email: args.email,
    discipline: args.discipline as Discipline,
    accessLevel,
    projectId: args.projectId,
    displayName: args.displayName,
    sendEmail: args.sendEmail,
    reinvite: args.reinvite,
    siteUrl: args.siteUrl,
  });

  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  rawCli().catch((err: unknown) => {
    console.error('INVITE FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
