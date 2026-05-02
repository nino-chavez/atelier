// `atelier invite` — issue an invitation for a remote-principal composer
// (US-11.4; BUILD-SEQUENCE §9; ADR-009).
//
// v1: pointer-stub. The substrate capabilities (composer seeding +
// bearer issuance) ship at v1 via scripts/bootstrap/. The polished CLI
// form (single-command "send invite + email + token shortlink") lands
// in v1.x.

import { emitStub } from '../lib/stub.ts';

export const inviteUsage = `atelier invite — invite a remote-principal composer

Usage:
  atelier invite <email> --role <discipline> [--access-level <level>]

v1 status: pointer-stub (timeline-deferred). The seed + bearer-issue
substrate ships at v1 via scripts/bootstrap; polished invite UX
(single-command + email delivery + token shortlink) lands in v1.x.

For v1, run the seed + bearer-issue scripts directly:

  # Step 1: create the composer + seed an auth user
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \\
    npx tsx scripts/bootstrap/seed-composer.ts \\
      --email <invitee> --password <strong> \\
      --discipline <analyst|dev|pm|designer|architect> \\
      --access-level <member|admin|stakeholder>

  # Step 2: issue the invitee a bearer token to share securely
  SUPABASE_URL=... SUPABASE_ANON_KEY=... \\
    npx tsx scripts/bootstrap/issue-bearer.ts \\
      --email <invitee> --password <strong>

The invitee uses the bearer with their MCP client (per the appropriate
docs/user/connectors/<client>.md runbook).
`;

export async function runInvite(_args: readonly string[]): Promise<number> {
  return emitStub({
    command: 'atelier invite',
    rationale: 'timeline',
    rawForm: 'see two-step block below',
    rawFormBlock: [
      '# 1. Seed the composer + auth user (admin runs this):',
      'SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \\',
      '  npx tsx scripts/bootstrap/seed-composer.ts \\',
      '    --email <invitee> --password <strong> \\',
      '    --discipline <analyst|dev|pm|designer|architect> \\',
      '    --access-level <member|admin|stakeholder>',
      '',
      '# 2. Issue a bearer token for the invitee:',
      'SUPABASE_URL=... SUPABASE_ANON_KEY=... \\',
      '  npx tsx scripts/bootstrap/issue-bearer.ts \\',
      '    --email <invitee> --password <strong>',
    ].join('\n'),
    notes: [
      'Share the bearer with the invitee securely (1Password, encrypted email).',
      'The invitee configures their MCP client per docs/user/connectors/<client>.md.',
    ],
  });
}
