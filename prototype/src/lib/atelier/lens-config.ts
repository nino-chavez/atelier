// Lens configuration per ADR-017 + NORTH-STAR section 4 + ARCH 6.7.
//
// Each lens is a default-view configuration of the same canonical state.
// The five lenses exist at v1: analyst, dev, pm, designer, stakeholder.
// Routing per prototype/README.md is path-segment: /atelier/<lens>.
//
// Depth defaults mirror ARCH 6.7 lens_defaults YAML. Per-project overrides
// land via .atelier/config.yaml: get_context.lens_defaults at M3-late
// (deferred until the first project actually overrides; the bundled defaults
// are the v1 contract).

export type LensId = 'analyst' | 'dev' | 'pm' | 'designer' | 'stakeholder';

export const LENS_IDS: readonly LensId[] = [
  'analyst',
  'dev',
  'pm',
  'designer',
  'stakeholder',
] as const;

export type ContributionKindWeight = Record<'implementation' | 'research' | 'design', number>;

export type PanelId =
  | 'presence'
  | 'find_similar'
  | 'review_queue'
  | 'contributions'
  | 'locks'
  | 'contracts'
  | 'feedback_queue'
  | 'recent_decisions'
  | 'territories'
  | 'charter';

export interface LensAffordances {
  /** Whether write surfaces (claim, log_decision, propose_contract_change) render. False for stakeholder. */
  canWrite: boolean;
  /** Whether the triage / feedback queue surfaces. True only when the lens routes inbound triage (designer, pm). */
  canTriage: boolean;
}

export interface LensDepth {
  /** Per-band cap for recent_decisions (ARCH 6.7 lens_defaults.recent_decisions_per_band_limit). */
  recentDecisionsPerBandLimit: number;
  /** Active contributions list cap (ARCH 6.7 lens_defaults.contributions_active_limit). */
  contributionsActiveLimit: number;
  /** Per-kind weights for active contributions ranking (ARCH 6.7 lens_defaults.contributions_kind_weights). */
  contributionsKindWeights: ContributionKindWeight;
  /** Traceability slice cap (ARCH 6.7 lens_defaults.traceability_entries_limit). */
  traceabilityEntriesLimit: number;
  /** charter_excerpts opt-in (default false; PM/stakeholder true). */
  charterExcerpts: boolean;
}

export interface LensConfig {
  id: LensId;
  label: string;
  /** Shown as orientation subtitle on lens entry. */
  description: string;
  /** Panels rendered top-to-bottom. The same canonical state, ordered by lens priority. */
  panels: readonly PanelId[];
  affordances: LensAffordances;
  depth: LensDepth;
}

const ANALYST: LensConfig = {
  id: 'analyst',
  label: 'Analyst',
  description:
    'Strategy contributions, research artifacts, proposals needing review, decisions affecting strategy.',
  panels: [
    'presence',
    'find_similar',
    'review_queue',
    'contributions',
    'recent_decisions',
    'territories',
    'charter',
  ],
  affordances: { canWrite: true, canTriage: false },
  depth: {
    recentDecisionsPerBandLimit: 15,
    contributionsActiveLimit: 10,
    contributionsKindWeights: { research: 3, implementation: 1, design: 1 },
    traceabilityEntriesLimit: 60,
    charterExcerpts: false,
  },
};

const DEV: LensConfig = {
  id: 'dev',
  label: 'Dev',
  description:
    'Contributions in territory, active locks, recent implementation decisions, contract changes from other territories.',
  panels: [
    'presence',
    'contributions',
    'locks',
    'contracts',
    'recent_decisions',
    'territories',
    'charter',
  ],
  affordances: { canWrite: true, canTriage: false },
  depth: {
    recentDecisionsPerBandLimit: 10,
    contributionsActiveLimit: 30,
    contributionsKindWeights: { implementation: 3, research: 1, design: 1 },
    traceabilityEntriesLimit: 30,
    charterExcerpts: false,
  },
};

const PM: LensConfig = {
  id: 'pm',
  label: 'PM',
  description:
    'Phase progress, priority flow, story states, owner-approval queue, delivery mirror.',
  panels: [
    'presence',
    'review_queue',
    'contributions',
    'recent_decisions',
    'territories',
    'charter',
  ],
  affordances: { canWrite: true, canTriage: true },
  depth: {
    recentDecisionsPerBandLimit: 10,
    contributionsActiveLimit: 40,
    contributionsKindWeights: { implementation: 1, research: 1, design: 1 },
    traceabilityEntriesLimit: 80,
    charterExcerpts: true,
  },
};

const DESIGNER: LensConfig = {
  id: 'designer',
  label: 'Designer',
  description:
    'Design components in review, visual contracts, feedback queue from design tool.',
  panels: [
    'presence',
    'feedback_queue',
    'contributions',
    'contracts',
    'recent_decisions',
    'territories',
    'charter',
  ],
  affordances: { canWrite: true, canTriage: true },
  depth: {
    recentDecisionsPerBandLimit: 10,
    contributionsActiveLimit: 15,
    contributionsKindWeights: { design: 3, research: 1, implementation: 1 },
    traceabilityEntriesLimit: 30,
    charterExcerpts: false,
  },
};

const STAKEHOLDER: LensConfig = {
  id: 'stakeholder',
  label: 'Stakeholder',
  description:
    'Read-only view: public decisions, contribution counts, project orientation. No authoring affordances.',
  panels: ['recent_decisions', 'contributions', 'territories', 'charter'],
  affordances: { canWrite: false, canTriage: false },
  depth: {
    recentDecisionsPerBandLimit: 10,
    contributionsActiveLimit: 10,
    contributionsKindWeights: { implementation: 1, research: 1, design: 1 },
    traceabilityEntriesLimit: 50,
    charterExcerpts: true,
  },
};

export const LENS_CONFIGS: Record<LensId, LensConfig> = {
  analyst: ANALYST,
  dev: DEV,
  pm: PM,
  designer: DESIGNER,
  stakeholder: STAKEHOLDER,
};

export function isLensId(value: string): value is LensId {
  return (LENS_IDS as readonly string[]).includes(value);
}

/**
 * Resolve a lens for a given composer discipline. ADR-038 split discipline
 * from access_level; the four authoring disciplines map 1:1 to the
 * authoring lenses, and architect maps to the dev lens at v1 (architect
 * does not have its own lens; the dev lens covers code-and-protocol work
 * which is where most architect contributions land). Stakeholder lens is
 * keyed off composers.access_level=stakeholder, not discipline.
 */
export function defaultLensFor(opts: {
  discipline: string | null;
  accessLevel?: string | null;
}): LensId {
  if (opts.accessLevel === 'stakeholder') return 'stakeholder';
  switch (opts.discipline) {
    case 'analyst':
      return 'analyst';
    case 'dev':
    case 'architect':
      return 'dev';
    case 'pm':
      return 'pm';
    case 'designer':
      return 'designer';
    default:
      return 'analyst';
  }
}
