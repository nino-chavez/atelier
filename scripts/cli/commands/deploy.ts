// `atelier deploy` — push the prototype + endpoint to the deploy target
// (US-11.3; BUILD-SEQUENCE §9).
//
// v1: pointer-stub. The substrate capability ships at v1 (per ADR-046:
// Vercel + Supabase Cloud + rootDirectory=prototype is the canonical deploy
// shape). The polished CLI form (deploy + verify + connection summary)
// lands in v1.x.

import { emitStub } from '../lib/stub.ts';

export const deployUsage = `atelier deploy — push prototype + endpoint to deploy target

Usage:
  atelier deploy [--prod]

v1 status: pointer-stub (timeline-deferred). The substrate ships at v1
per ADR-046 (Vercel + Supabase Cloud); polished CLI deploy lands in v1.x.

For v1, deploy via Vercel directly:

  vercel deploy --prod

Per docs/user/tutorials/first-deploy.md for the full first-deploy sequence
(cloud Supabase setup + Vercel project linkage + env vars + verification).
`;

export async function runDeploy(_args: readonly string[]): Promise<number> {
  return emitStub({
    command: 'atelier deploy',
    rationale: 'timeline',
    rawForm: 'vercel deploy --prod',
    notes: [
      'Per docs/user/tutorials/first-deploy.md for the full first-deploy sequence',
      '(cloud Supabase setup + Vercel project linkage + env vars + verification).',
      '',
      'For automatic deploy on push-to-main, see',
      'docs/user/guides/enable-auto-deploy.md.',
    ],
  });
}
