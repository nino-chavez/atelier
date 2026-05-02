// `atelier doctor` — self-verification flow per ARCH 6.1.1
// (US-11.9; BUILD-SEQUENCE §9).
//
// v1: pointer-stub. The substrate self-verification path ships at v1
// via scripts/endpoint/__smoke__/real-client.smoke.ts (the four-step
// register / heartbeat / get_context / deregister sequence per
// ARCH 6.1.1). The polished CLI form (single-command symptom-to-cause
// mapping + actionable remediation hints) lands in v1.x.

import { emitStub } from '../lib/stub.ts';

export const doctorUsage = `atelier doctor — diagnose substrate health

Usage:
  atelier doctor

v1 status: pointer-stub (timeline-deferred). The four-step
self-verification (register / heartbeat / get_context / deregister)
ships at v1 via the real-client smoke; polished doctor UX with
symptom-to-cause mapping per ARCH 6.1.1 lands in v1.x.

Per the 2026-04-28 expert review: in self-hosted, connectivity issues
are the dominant support-volume class. Doctor's polished form is the
adopter's first-line tool for substrate triage.

For v1, run the real-client smoke directly:

  # Local Supabase + endpoint (covers steps 1-4 of ARCH 6.1.1):
  supabase start
  eval "$(supabase status -o env)"
  SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY \\
    SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \\
    npx tsx scripts/endpoint/__smoke__/real-client.smoke.ts

The smoke spawns its own MCP server on a random port + runs the
four-step end-to-end + reports per-step status. Failure modes map
to the symptom-to-cause table in ARCH 6.1.1.
`;

export async function runDoctor(_args: readonly string[]): Promise<number> {
  return emitStub({
    command: 'atelier doctor',
    rationale: 'timeline',
    rawForm: 'see block below',
    rawFormBlock: [
      'supabase start',
      'eval "$(supabase status -o env)"',
      'SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY \\',
      '  SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \\',
      '  npx tsx scripts/endpoint/__smoke__/real-client.smoke.ts',
    ].join('\n'),
    notes: [
      'Failure modes map to the symptom-to-cause table in ARCH 6.1.1.',
      'For local-stack pre-flight checks (docker, supabase running,',
      'port :3030, bearer expiry), see `atelier dev --preflight-only`.',
    ],
  });
}
