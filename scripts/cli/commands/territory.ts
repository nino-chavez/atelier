// `atelier territory <subcommand>` (US-11.5; BUILD-SEQUENCE §9).
//
// v1 subcommands:
//   add — pointer-stub (interactive prompt + validation deferred to v1.x;
//         v1 raw form is a manual edit of .atelier/territories.yaml).

import { emitStub } from '../lib/stub.ts';

export const territoryUsage = `atelier territory — manage territory definitions

Usage:
  atelier territory add     Add a new territory entry (v1: manual yaml edit)

v1 status: pointer-stub (timeline-deferred). The territories config
ships at v1 (.atelier/territories.yaml is canonical). Polished
interactive add (with scope-pattern validation, role-completeness
check, contracts-published roundtrip) lands in v1.x.
`;

export async function runTerritory(args: readonly string[]): Promise<number> {
  const sub = args[0];
  if (sub === 'add') {
    return emitStub({
      command: 'atelier territory add',
      rationale: 'timeline',
      rawForm: 'edit .atelier/territories.yaml',
      rawFormBlock: [
        '# Open .atelier/territories.yaml and add a new entry following the',
        '# header schema. Required fields per ADR-014 + ADR-038:',
        '#',
        '#   - name: <slug>',
        '#     owner_role: <discipline>          # analyst | dev | pm | designer | architect',
        '#     review_role: <discipline | null>  # nullable = same as owner_role',
        '#     scope_kind: <kind>                # files | doc_region | research_artifact | design_component | slice_config',
        '#     scope_pattern: <glob | path>',
        '#     contracts_published: []',
        '#     contracts_consumed: []',
        '#     description: <free text>',
        '#     requires_plan_review: false       # ADR-039 (default false)',
      ].join('\n'),
      notes: [
        'After saving, the M1 territories-mirror sync script propagates the',
        'change to the datastore on the next sync cycle (or run the sync',
        'manually via `atelier sync publish-delivery`).',
      ],
    });
  }
  console.error(`atelier territory: unknown subcommand "${sub ?? ''}"`);
  console.error('');
  console.error(territoryUsage);
  return 2;
}
