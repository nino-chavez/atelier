// `atelier datastore <subcommand>` (US-11.2; BUILD-SEQUENCE §9).
//
// v1 subcommands:
//   init — pointer-stub (apply the schema migrations to a Postgres + pgvector instance)

import { emitStub } from '../lib/stub.ts';

export const datastoreUsage = `atelier datastore — manage the coordination datastore

Usage:
  atelier datastore init     Apply schema migrations to a Postgres + pgvector instance

v1 status: pointer-stubs (timeline-deferred). The polished forms land in
v1.x with progress reporting and idempotency confirmation.

For v1, use the raw forms below.
`;

export async function runDatastore(args: readonly string[]): Promise<number> {
  const sub = args[0];
  if (sub === 'init') {
    return emitStub({
      command: 'atelier datastore init',
      rationale: 'timeline',
      rawForm: 'see options below',
      rawFormBlock: [
        '# Cloud Supabase:',
        'supabase link --project-ref <project-ref>',
        'supabase db push',
        '',
        '# Local Supabase (auto-applies migrations on bring-up):',
        'supabase start',
      ].join('\n'),
      notes: [
        'Per docs/user/tutorials/first-deploy.md Step 2 + docs/user/tutorials/local-bootstrap.md Step 1.',
      ],
    });
  }
  console.error(`atelier datastore: unknown subcommand "${sub ?? ''}"`);
  console.error('');
  console.error(datastoreUsage);
  return 2;
}
