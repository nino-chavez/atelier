// `atelier init` — scaffold a new Atelier project (US-11.1; BUILD-SEQUENCE §9).
//
// v1: pointer-stub. The substrate capability "scaffold a fresh project from
// the Atelier template" exists at v1 (this repo IS the template), but the
// guided handshake protocol per US-1.8 (credential-handover surface for
// AI-driven setup) and the polished init flow land in v1.x.

import { emitStub } from '../lib/stub.ts';

export const initUsage = `atelier init — scaffold a new Atelier project

Usage:
  atelier init [project-name]

v1 status: pointer-stub (timeline-deferred). The polished init flow lands
in v1.x with the guided handshake protocol per US-1.8.

For v1, clone the Atelier reference repo as your template:

  git clone https://github.com/Signal-x-Studio-LLC/atelier.git my-project
  cd my-project
  rm -rf .git
  git init

Then follow docs/user/tutorials/local-bootstrap.md to bring up the substrate.
`;

export async function runInit(_args: readonly string[]): Promise<number> {
  return emitStub({
    command: 'atelier init',
    rationale: 'timeline',
    rawForm: 'git clone https://github.com/Signal-x-Studio-LLC/atelier.git my-project && cd my-project && rm -rf .git && git init',
    notes: [
      'Then follow docs/user/tutorials/local-bootstrap.md to bring up the local substrate,',
      'or docs/user/tutorials/first-deploy.md to land a cloud deploy.',
    ],
  });
}
