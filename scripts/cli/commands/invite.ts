// `atelier invite` (US-11.4; BUILD-SEQUENCE §9; D4 polished form).
//
// Invite a remote-principal composer (per ADR-009). Creates the Supabase
// Auth user, the composer row (status=active per schema default), and either
// dispatches Supabase's invitation email (default) or returns a magic-link
// URL the operator shares manually (--no-send-email, for SMTP-not-configured
// deploys).
//
// Couples with D7 (magic-link sign-in at /sign-in -> /auth/confirm).
// The invitee receives the link, clicks it, lands at /auth/confirm, the
// token-hash verifier seats a Supabase Auth session cookie, the lens UI at
// /atelier renders. Agent-onboarding is unchanged: agents authenticate
// to /oauth/api/mcp via OAuth 2.1 (D7 covers humans only).
//
// Per ADR-018 (trust model): invite is operator-driven; no public sign-up
// surface ships at v1. Per ADR-029: the @supabase/supabase-js admin SDK
// stays in scripts/bootstrap/* (this CLI command imports the
// `inviteComposer` helper rather than the SDK directly).
//
// A1 hardening (BRD-OPEN-QUESTIONS §31, X1 audit close-out): the magic-link
// URL is REDACTED from default text output; opt-in via --print-link to emit
// it on stdout. JSON output keeps the link as a structured field but flags
// `warning: "magic_link_in_output"` so the JSON consumer is on notice. The
// redaction prevents accidental link exposure in shared terminal screenshots,
// screen-share recordings, and CI logs.
//
// Mode detection (auto):
//   - LOCAL when ATELIER_DATASTORE_URL points at localhost (or is unset)
//     AND --remote is not passed.
//   - CLOUD when ATELIER_DATASTORE_URL points at a non-localhost host,
//     OR --remote is passed.
//
// What `invite` does:
//   1. Validate flags (email format, discipline + access-level enums).
//   2. Resolve project_id (explicit --project-id, or single project in
//      datastore; error on zero or multiple without --project-id).
//   3. Detect duplicates (email already invited; --reinvite resends a
//      fresh magic link without creating a new row).
//   4. Build the supabase client config (service role key required;
//      pulled from env or, in local mode, from `supabase status -o env`).
//   5. Create Auth user + insert composer row via the bootstrap helper.
//   6. Print actionable next-step (email-sent vs manual-share, with
//      magic-link redaction by default).
//
// Safe-by-default: --dry-run renders the plan without mutating anything.

import { spawnSync } from 'node:child_process';

import {
  inviteComposer,
  DISCIPLINES,
  ACCESS_LEVELS,
  type Discipline,
  type AccessLevel,
} from '../../bootstrap/invite-composer.ts';

export const SUPPRESSED_LINK_MARKER =
  '<magic-link suppressed; re-run with --print-link to emit>';

export const inviteUsage = `atelier invite — invite a remote-principal composer

Usage:
  atelier invite --email <addr> --discipline <role> [options]

Required:
  --email <addr>             Invitee's email address.
  --discipline <role>        One of: ${DISCIPLINES.join(' | ')} (per ADR-038).

Optional:
  --access-level <level>     One of: ${ACCESS_LEVELS.join(' | ')}.
                             Default: member.
  --project-id <uuid>        Target project. When omitted, resolves to the
                             single project in the datastore (errors if zero
                             or multiple).
  --display-name <string>    Default: derived from the email local-part.
  --no-send-email            Do not dispatch Supabase's invitation email;
                             record the magic-link URL for manual sharing.
                             Use in deploys without SMTP configured.
  --reinvite                 The email must already exist as a composer;
                             returns a fresh magic link without creating a
                             new row. Implies --no-send-email semantics
                             (the URL is always recorded).
  --print-link               Emit the magic-link URL on stdout (text mode).
                             Default: redact to "${SUPPRESSED_LINK_MARKER}".
                             Opt-in to prevent accidental link exposure in
                             shared terminal output, screenshots, and logs
                             (BRD-OPEN-QUESTIONS §31 / X1 audit A1).
  --site-url <url>           Public URL of the deploy. Default:
                             ATELIER_PUBLIC_URL env, then localhost:3000.
                             Used to build the magic-link redirect target
                             (\`<site>/auth/confirm?next=/atelier\`).
  --remote                   Force cloud mode regardless of env detection.
  --local                    Force local mode regardless of env detection.
  --dry-run                  Preview the invite without mutating anything.
  --json                     Emit machine-readable JSON output. The magicLink
                             field is included; a top-level warning of
                             "magic_link_in_output" flags the sensitive value.
  -h, --help                 Show this help.

Behavior contract:
  Exits 0 on success; 1 on Supabase / Postgres failure;
  2 on argument or precondition error (missing flag, invalid enum,
  duplicate without --reinvite, project ambiguity, missing service role).

Couples with D7 (magic-link sign-in at /sign-in). The invitee receives
the link, clicks it, lands at /auth/confirm, the token-hash verifier
seats a Supabase Auth session cookie, the /atelier lens UI renders.

Cross-references:
  - ADR-009 (remote-principal actor class)
  - ADR-028 (Supabase Auth as default identity provider)
  - ADR-038 (composer discipline + access_level enums)
  - BRD-OPEN-QUESTIONS §31 (X1 audit A1 magic-link redaction)
  - scripts/bootstrap/invite-composer.ts (the substrate helper)
  - scripts/bootstrap/issue-bearer.ts (headless bearer for CI / agents)
  - docs/user/guides/invite-composers.md (operator guide)
`;

interface ParsedArgs {
  email?: string;
  discipline?: string;
  accessLevel?: string;
  projectId?: string;
  displayName?: string;
  sendEmail: boolean;
  reinvite: boolean;
  printLink: boolean;
  siteUrl?: string;
  remote: boolean;
  local: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    sendEmail: true,
    reinvite: false,
    printLink: false,
    remote: false,
    local: false,
    dryRun: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    const next = (): string => {
      const v = args[i + 1];
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
      case '--print-link': out.printLink = true; break;
      case '--site-url': out.siteUrl = next(); break;
      case '--remote': out.remote = true; break;
      case '--local': out.local = true; break;
      case '--dry-run': out.dryRun = true; break;
      case '--json': out.json = true; break;
      case '--help':
      case '-h': out.help = true; break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  if (out.remote && out.local) {
    throw new Error('--remote and --local are mutually exclusive');
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ValidationError {
  field: string;
  message: string;
}

function validate(parsed: ParsedArgs): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!parsed.email) {
    errors.push({ field: 'email', message: 'is required (--email <addr>)' });
  } else if (!EMAIL_RE.test(parsed.email)) {
    errors.push({
      field: 'email',
      message: `does not look like an email address (got "${parsed.email}")`,
    });
  }
  if (!parsed.discipline) {
    errors.push({
      field: 'discipline',
      message: `is required (--discipline ${DISCIPLINES.join('|')})`,
    });
  } else if (!DISCIPLINES.includes(parsed.discipline as Discipline)) {
    errors.push({
      field: 'discipline',
      message: `must be one of ${DISCIPLINES.join(' | ')} (got "${parsed.discipline}")`,
    });
  }
  const accessLevel = parsed.accessLevel ?? 'member';
  if (!ACCESS_LEVELS.includes(accessLevel as AccessLevel)) {
    errors.push({
      field: 'access-level',
      message: `must be one of ${ACCESS_LEVELS.join(' | ')} (got "${parsed.accessLevel}")`,
    });
  }
  return errors;
}

type Mode = 'local' | 'cloud';

interface ModeDecision {
  mode: Mode;
  reason: string;
  databaseUrl: string;
}

function isLocalhost(connStr: string): boolean {
  try {
    const u = new URL(connStr);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1';
  } catch {
    return false;
  }
}

function redactHost(connStr: string): string {
  try {
    const u = new URL(connStr);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return '<unparseable connection string>';
  }
}

const DEFAULT_LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function decideMode(parsed: ParsedArgs): ModeDecision {
  // Canonical POSTGRES_URL (Vercel-provisioned by the native Supabase
  // integration); legacy ATELIER_DATASTORE_URL kept as fallback.
  const envUrl =
    process.env.POSTGRES_URL ??
    process.env.ATELIER_DATASTORE_URL ??
    process.env.DATABASE_URL;
  if (parsed.local) {
    return {
      mode: 'local',
      reason: '--local flag forced local mode',
      databaseUrl: envUrl && isLocalhost(envUrl) ? envUrl : DEFAULT_LOCAL_DB_URL,
    };
  }
  if (parsed.remote) {
    if (!envUrl) {
      throw new Error(
        '--remote requires POSTGRES_URL (or legacy ATELIER_DATASTORE_URL / DATABASE_URL) to be set',
      );
    }
    return {
      mode: 'cloud',
      reason: '--remote flag forced cloud mode',
      databaseUrl: envUrl,
    };
  }
  if (envUrl && !isLocalhost(envUrl)) {
    return {
      mode: 'cloud',
      reason: `POSTGRES_URL points at ${redactHost(envUrl)} (non-localhost)`,
      databaseUrl: envUrl,
    };
  }
  return {
    mode: 'local',
    reason: envUrl
      ? `POSTGRES_URL points at localhost (${redactHost(envUrl)})`
      : 'no POSTGRES_URL / ATELIER_DATASTORE_URL set; defaulting to local Supabase',
    databaseUrl: envUrl ?? DEFAULT_LOCAL_DB_URL,
  };
}

interface SupabaseEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  source: 'env' | 'supabase-status';
}

function loadSupabaseEnv(mode: Mode): SupabaseEnv {
  const envUrl = process.env.SUPABASE_URL;
  const envKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (envUrl && envKey) {
    return { supabaseUrl: envUrl, serviceRoleKey: envKey, source: 'env' };
  }
  if (mode === 'local') {
    const status = spawnSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
    if (status.status === 0 && status.stdout) {
      let url: string | undefined;
      let key: string | undefined;
      for (const line of status.stdout.split('\n')) {
        const m = /^([A-Z_]+)="(.*)"$/.exec(line.trim());
        if (!m) continue;
        const [, k, v] = m;
        if (k === 'API_URL') url = v;
        if (k === 'SERVICE_ROLE_KEY') key = v;
      }
      if (url && key) {
        return { supabaseUrl: url, serviceRoleKey: key, source: 'supabase-status' };
      }
    }
  }
  throw new Error(
    mode === 'cloud'
      ? 'cloud mode requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars (per first-deploy.md Step 4)'
      : 'failed to read SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env or `supabase status -o env`; is the local stack running?',
  );
}

interface RenderInput {
  mode: ModeDecision;
  email: string;
  discipline: Discipline;
  accessLevel: AccessLevel;
  projectId: string | undefined;
  displayName: string | undefined;
  sendEmail: boolean;
  reinvite: boolean;
  printLink: boolean;
  siteUrl: string | undefined;
  dryRun: boolean;
}

function renderPlan(input: RenderInput): string {
  const lines: string[] = [];
  lines.push(`atelier invite -- ${input.dryRun ? 'PLAN (dry-run)' : 'PLAN'}`);
  lines.push('');
  lines.push(`  mode             ${input.mode.mode} (${input.mode.reason})`);
  lines.push(`  datastore        ${redactHost(input.mode.databaseUrl)}`);
  lines.push(`  email            ${input.email}`);
  lines.push(`  discipline       ${input.discipline}`);
  lines.push(`  access_level     ${input.accessLevel}`);
  lines.push(`  project_id       ${input.projectId ?? '<auto-resolve>'}`);
  lines.push(`  display_name     ${input.displayName ?? '<derive from email>'}`);
  lines.push(`  send_email       ${input.sendEmail}`);
  lines.push(`  reinvite         ${input.reinvite}`);
  lines.push(`  print_link       ${input.printLink}`);
  lines.push(`  site_url         ${input.siteUrl ?? '<env or localhost:3000>'}`);
  return lines.join('\n');
}

export async function runInvite(args: readonly string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    console.error(`atelier invite: ${err instanceof Error ? err.message : err}`);
    console.error('');
    console.error(inviteUsage);
    return 2;
  }

  if (parsed.help) {
    console.log(inviteUsage);
    return 0;
  }

  const errors = validate(parsed);
  if (errors.length > 0) {
    if (parsed.json) {
      console.log(JSON.stringify({ ok: false, errors }, null, 2));
    } else {
      console.error('atelier invite: validation failed');
      for (const e of errors) {
        console.error(`  ${e.field}: ${e.message}`);
      }
      console.error('');
      console.error(inviteUsage);
    }
    return 2;
  }

  const email = parsed.email!;
  const discipline = parsed.discipline as Discipline;
  const accessLevel = (parsed.accessLevel ?? 'member') as AccessLevel;

  let mode: ModeDecision;
  try {
    mode = decideMode(parsed);
  } catch (err) {
    console.error(`atelier invite: ${err instanceof Error ? err.message : err}`);
    return 2;
  }

  const planInput: RenderInput = {
    mode,
    email,
    discipline,
    accessLevel,
    projectId: parsed.projectId,
    displayName: parsed.displayName,
    sendEmail: parsed.sendEmail && !parsed.reinvite,
    reinvite: parsed.reinvite,
    printLink: parsed.printLink,
    siteUrl: parsed.siteUrl,
    dryRun: parsed.dryRun,
  };

  if (parsed.dryRun) {
    if (parsed.json) {
      console.log(JSON.stringify({ ok: true, dryRun: true, plan: planInput }, null, 2));
    } else {
      console.log(renderPlan(planInput));
      console.log('');
      console.log('No mutations performed. Re-run without --dry-run to apply.');
    }
    return 0;
  }

  if (!parsed.json) {
    console.log(renderPlan(planInput));
    console.log('');
  }

  let supa: SupabaseEnv;
  try {
    supa = loadSupabaseEnv(mode.mode);
  } catch (err) {
    console.error(`atelier invite: ${err instanceof Error ? err.message : err}`);
    return 2;
  }

  try {
    const result = await inviteComposer({
      email,
      discipline,
      accessLevel,
      projectId: parsed.projectId,
      displayName: parsed.displayName,
      sendEmail: parsed.sendEmail && !parsed.reinvite,
      reinvite: parsed.reinvite,
      siteUrl: parsed.siteUrl,
      databaseUrl: mode.databaseUrl,
      supabaseUrl: supa.supabaseUrl,
      serviceRoleKey: supa.serviceRoleKey,
    });

    if (parsed.json) {
      // JSON output keeps magicLink as a structured field; the top-level
      // warning flags the sensitive value so a JSON consumer sees the
      // notice even before piping to jq (A1 hardening / BRD-OQ §31).
      const payload: Record<string, unknown> = { ok: true, ...result };
      if (result.magicLink) {
        payload.warning = 'magic_link_in_output';
      }
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    }

    console.log('atelier invite -- DONE');
    console.log('');
    console.log(`  composer.id      ${result.composerId}`);
    console.log(`  user.id          ${result.userId}`);
    console.log(`  email            ${result.email}`);
    console.log(`  display_name     ${result.displayName}`);
    console.log(`  discipline       ${result.discipline}`);
    console.log(`  access_level     ${result.accessLevel}`);
    console.log(`  project          ${result.projectName} (${result.projectId})`);
    console.log(`  redirect_to      ${result.redirectTo}`);
    console.log('');

    if (result.magicLink) {
      const verb = result.reinvited ? 'Re-invitation' : 'Manual share required';
      console.log(`${verb}. Magic link valid for 1 hour:`);
      console.log('');
      if (parsed.printLink) {
        console.log(`  ${result.magicLink}`);
      } else {
        // A1 redaction default (BRD-OPEN-QUESTIONS §31). Operators must opt
        // in to printing the link on stdout.
        console.log(`  ${SUPPRESSED_LINK_MARKER}`);
      }
      console.log('');
      if (!parsed.printLink) {
        console.log('Re-run with --print-link to emit the URL on stdout, OR pipe');
        console.log("--json output to jq -r '.magicLink' for scripted retrieval.");
        console.log('');
      }
      console.log('Share securely (1Password, encrypted email, Slack DM).');
    } else {
      console.log(`Invitation sent to ${result.email}.`);
      console.log(
        'They will receive a magic link valid for 1 hour at the address above.',
      );
      console.log('');
      console.log(
        'If the email does not arrive: the deploy may not have SMTP configured.',
      );
      console.log(
        'Re-run with --reinvite (and optionally --print-link) to obtain',
      );
      console.log('the magic-link URL for manual sharing.');
    }
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (parsed.json) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.error('atelier invite -- FAILED');
      console.error(`  ${msg}`);
    }
    // Argument/precondition errors return 2; substrate failures return 1.
    if (
      /already invited|--reinvite requires|not found in datastore|multiple projects|no projects/i.test(
        msg,
      )
    ) {
      return 2;
    }
    return 1;
  }
}
