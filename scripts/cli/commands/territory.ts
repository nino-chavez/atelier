// `atelier territory <subcommand>` (US-11.5; BUILD-SEQUENCE §9; D2 polished form).
//
// v1 subcommands:
//   add — append a new entry to .atelier/territories.yaml.
//
// Per ADR-014 (territory + contract model), ADR-025 (review-routing key),
// ADR-038 (composer discipline enum), ADR-039 (per-territory plan_review
// opt-in). The schema lives in ARCH 6.6 + the territories.yaml header.
//
// What `add` does:
//   1. Collects required fields from CLI flags or interactive prompts (when
//      stdin is a TTY and required fields are missing).
//   2. Validates against the territories.yaml schema:
//        - name is unique (no collision with existing territories)
//        - owner_role / review_role are valid disciplines (per ADR-038)
//        - scope_kind is a valid enum (per ARCH 6.6)
//        - scope_pattern is non-empty
//   3. Appends using yaml's Document API so existing comments + ordering
//      survive round-trip (same library + technique used by
//      scripts/test/handlers/config.ts for .atelier/config.yaml).
//   4. Re-parses the written file to confirm round-trip correctness before
//      reporting success.
//   5. Runs scripts/traceability/validate-refs.ts (--per-pr) post-edit and
//      surfaces the result. The validator walks markdown citations, not
//      territories.yaml, so this confirms the broader doc graph still
//      reads cleanly; we surface its output but do not gate on it (the
//      baseline may carry pre-existing issues unrelated to this edit).
//   6. Prints a confirmation summary.
//
// Safe-by-default: --dry-run renders the preview without writing.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { parseDocument, isSeq, isMap } from 'yaml';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const TERRITORIES_PATH = resolve(REPO_ROOT, '.atelier/territories.yaml');

// Discipline enum per ADR-038. Source of truth is ARCH section 5 +
// territories.yaml header. Mirrored here for CLI-side validation; the
// substrate still validates server-side on read.
const DISCIPLINES = ['analyst', 'dev', 'pm', 'designer', 'architect'] as const;
type Discipline = (typeof DISCIPLINES)[number];

// scope_kind enum per ARCH 6.6 + the territories.yaml header.
const SCOPE_KINDS = [
  'files',
  'doc_region',
  'research_artifact',
  'design_component',
  'slice_config',
] as const;
type ScopeKind = (typeof SCOPE_KINDS)[number];

interface TerritoryInput {
  name: string;
  owner_role: Discipline;
  review_role: Discipline | null;
  scope_kind: ScopeKind;
  scope_pattern: string[];
  contracts_published: string[];
  contracts_consumed: string[];
  description: string;
  requires_plan_review: boolean;
}

export const territoryUsage = `atelier territory — manage territory definitions

Usage:
  atelier territory add [options]    Append a new entry to .atelier/territories.yaml

Add options:
  --name <slug>                  Territory name (kebab-case slug; required).
  --owner-role <discipline>      Owner discipline (required). One of:
                                   ${DISCIPLINES.join(' | ')}.
  --review-role <discipline>     Review discipline (optional; defaults to
                                 owner-role when omitted, per ADR-025).
  --scope-kind <kind>            Scope shape (required). One of:
                                   ${SCOPE_KINDS.join(' | ')}.
  --scope-pattern <pattern>      Pattern (repeatable, required at least once).
                                 Comma-split also accepted: "a/**,b/**".
  --description <text>           Free-text description (recommended; prompted
                                 when interactive and omitted).
  --contracts-published <name>   Contract name (repeatable; default empty).
  --contracts-consumed <name>    Contract name (repeatable; default empty).
  --requires-plan-review         Enable plan_review gate per ADR-039
                                 (default false; opt-in).
  --non-interactive              Do not prompt; fail if required flags are
                                 missing.
  --dry-run                      Render preview to stdout; do not write.
                                 Skips the post-edit validator run.
  --json                         Emit machine-readable JSON output.
  -h, --help                     Show this help.

Behavior:
  1. Validates name uniqueness, enum membership, and scope_pattern presence.
  2. Appends to .atelier/territories.yaml using a comment-preserving
     YAML round-trip (eemeli/yaml Document API).
  3. Runs scripts/traceability/validate-refs.ts --per-pr post-edit and
     surfaces the report. Does not gate the exit code on validate-refs
     because its baseline may carry pre-existing issues unrelated to a
     territories.yaml edit (the validator walks markdown, not yaml).
  4. Exits 0 on success; 1 on validation failure; 2 on argument error.

Note: this command edits the canonical territories.yaml. After merging the
PR that lands the change, the M1 territories-mirror sync script propagates
to the datastore on the next sync cycle (or run \`atelier sync publish-delivery\`
manually).
`;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  name?: string;
  ownerRole?: string;
  reviewRole?: string;
  scopeKind?: string;
  scopePatterns: string[];
  description?: string;
  contractsPublished: string[];
  contractsConsumed: string[];
  requiresPlanReview: boolean;
  nonInteractive: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

function parseAddArgs(args: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    scopePatterns: [],
    contractsPublished: [],
    contractsConsumed: [],
    requiresPlanReview: false,
    nonInteractive: false,
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
      case '--name': out.name = next(); break;
      case '--owner-role': out.ownerRole = next(); break;
      case '--review-role': out.reviewRole = next(); break;
      case '--scope-kind': out.scopeKind = next(); break;
      case '--scope-pattern': {
        const v = next();
        // Comma-split shorthand: --scope-pattern "a,b,c"
        for (const p of v.split(',')) {
          const trimmed = p.trim();
          if (trimmed) out.scopePatterns.push(trimmed);
        }
        break;
      }
      case '--description': out.description = next(); break;
      case '--contracts-published': out.contractsPublished.push(next()); break;
      case '--contracts-consumed': out.contractsConsumed.push(next()); break;
      case '--requires-plan-review': out.requiresPlanReview = true; break;
      case '--non-interactive': out.nonInteractive = true; break;
      case '--dry-run': out.dryRun = true; break;
      case '--json': out.json = true; break;
      case '--help':
      case '-h': out.help = true; break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

interface ValidationError {
  field: string;
  message: string;
}

function validateInput(
  input: TerritoryInput,
  existingNames: ReadonlySet<string>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!input.name) {
    errors.push({ field: 'name', message: 'is required' });
  } else if (!SLUG_RE.test(input.name)) {
    errors.push({
      field: 'name',
      message: `must be lowercase kebab-case slug (got "${input.name}")`,
    });
  } else if (existingNames.has(input.name)) {
    errors.push({
      field: 'name',
      message: `"${input.name}" already exists in .atelier/territories.yaml`,
    });
  }

  if (!DISCIPLINES.includes(input.owner_role)) {
    errors.push({
      field: 'owner_role',
      message: `must be one of ${DISCIPLINES.join(' | ')} (got "${input.owner_role}")`,
    });
  }
  if (input.review_role !== null && !DISCIPLINES.includes(input.review_role)) {
    errors.push({
      field: 'review_role',
      message: `must be one of ${DISCIPLINES.join(' | ')} or omitted (got "${input.review_role}")`,
    });
  }
  if (!SCOPE_KINDS.includes(input.scope_kind)) {
    errors.push({
      field: 'scope_kind',
      message: `must be one of ${SCOPE_KINDS.join(' | ')} (got "${input.scope_kind}")`,
    });
  }
  if (input.scope_pattern.length === 0) {
    errors.push({
      field: 'scope_pattern',
      message: 'at least one pattern is required',
    });
  } else {
    for (const p of input.scope_pattern) {
      if (!p || p !== p.trim()) {
        errors.push({
          field: 'scope_pattern',
          message: `pattern must be a non-empty trimmed string (got ${JSON.stringify(p)})`,
        });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Interactive prompts
// ---------------------------------------------------------------------------

async function promptForMissingFields(
  rl: ReadlineInterface,
  parsed: ParsedArgs,
  existingNames: ReadonlySet<string>,
): Promise<void> {
  console.log('atelier territory add (interactive)');
  console.log('');
  console.log(`Existing territories: ${[...existingNames].join(', ')}`);
  console.log('');

  while (!parsed.name || !SLUG_RE.test(parsed.name) || existingNames.has(parsed.name)) {
    const v = (await rl.question('name (kebab-case slug): ')).trim();
    if (!v) {
      console.log('  name is required');
      continue;
    }
    if (!SLUG_RE.test(v)) {
      console.log('  name must be lowercase kebab-case (a-z, 0-9, hyphen)');
      continue;
    }
    if (existingNames.has(v)) {
      console.log(`  "${v}" already exists; pick a different name`);
      continue;
    }
    parsed.name = v;
  }

  while (!parsed.ownerRole || !DISCIPLINES.includes(parsed.ownerRole as Discipline)) {
    const v = (await rl.question(`owner_role (${DISCIPLINES.join('|')}): `)).trim();
    if (!DISCIPLINES.includes(v as Discipline)) {
      console.log(`  invalid; must be one of ${DISCIPLINES.join(', ')}`);
      continue;
    }
    parsed.ownerRole = v;
  }

  if (parsed.reviewRole === undefined) {
    const v = (
      await rl.question(
        `review_role (${DISCIPLINES.join('|')} or blank to default to owner_role): `,
      )
    ).trim();
    if (v === '') {
      parsed.reviewRole = '';
    } else if (DISCIPLINES.includes(v as Discipline)) {
      parsed.reviewRole = v;
    } else {
      console.log('  invalid; defaulting to owner_role');
      parsed.reviewRole = '';
    }
  }

  while (!parsed.scopeKind || !SCOPE_KINDS.includes(parsed.scopeKind as ScopeKind)) {
    const v = (await rl.question(`scope_kind (${SCOPE_KINDS.join('|')}): `)).trim();
    if (!SCOPE_KINDS.includes(v as ScopeKind)) {
      console.log(`  invalid; must be one of ${SCOPE_KINDS.join(', ')}`);
      continue;
    }
    parsed.scopeKind = v;
  }

  if (parsed.scopePatterns.length === 0) {
    console.log('scope_pattern (one per line; blank line to finish; at least one required):');
    while (true) {
      const v = (await rl.question('  pattern> ')).trim();
      if (v === '') {
        if (parsed.scopePatterns.length === 0) {
          console.log('  at least one pattern is required');
          continue;
        }
        break;
      }
      parsed.scopePatterns.push(v);
    }
  }

  if (parsed.description === undefined) {
    const v = (await rl.question('description (optional, free text): ')).trim();
    parsed.description = v;
  }

  // contracts_published / contracts_consumed default to empty arrays; only
  // prompt if not supplied. We do not loop-prompt here -- adopters typically
  // fill these in later via PR review when contracts are designed.
  if (parsed.contractsPublished.length === 0) {
    const v = (
      await rl.question('contracts_published (comma-separated; blank for none): ')
    ).trim();
    if (v) parsed.contractsPublished = v.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (parsed.contractsConsumed.length === 0) {
    const v = (
      await rl.question('contracts_consumed (comma-separated; blank for none): ')
    ).trim();
    if (v) parsed.contractsConsumed = v.split(',').map((s) => s.trim()).filter(Boolean);
  }

  if (!parsed.requiresPlanReview) {
    const v = (
      await rl.question('requires_plan_review (per ADR-039; y/N): ')
    ).trim().toLowerCase();
    parsed.requiresPlanReview = v === 'y' || v === 'yes';
  }
}

// ---------------------------------------------------------------------------
// YAML write (comment-preserving)
// ---------------------------------------------------------------------------

interface ExistingState {
  names: Set<string>;
  rawDocument: ReturnType<typeof parseDocument>;
  rawText: string;
}

function loadExisting(): ExistingState {
  if (!existsSync(TERRITORIES_PATH)) {
    throw new Error(
      `${TERRITORIES_PATH} not found. Run \`atelier init\` to scaffold a project, or create the file by hand following the schema in ARCH 6.6.`,
    );
  }
  const raw = readFileSync(TERRITORIES_PATH, 'utf8');
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    throw new Error(
      `Failed to parse ${TERRITORIES_PATH}:\n  ${doc.errors.map((e) => e.message).join('\n  ')}`,
    );
  }

  const seq = doc.get('territories');
  if (!isSeq(seq)) {
    throw new Error(
      `${TERRITORIES_PATH} is missing the top-level "territories" sequence; cannot append.`,
    );
  }

  const names = new Set<string>();
  for (const item of seq.items) {
    if (!isMap(item)) continue;
    const n = item.get('name');
    if (typeof n === 'string') names.add(n);
  }

  return { names, rawDocument: doc, rawText: raw };
}

// Format a single territory entry as a YAML block fragment. Hand-formatted
// (instead of yaml-lib emitted) so that the existing file's folded-scalar
// descriptions and quote styles survive a write byte-faithfully -- yaml's
// Document.toString() re-flows folded scalars at its lineWidth, which would
// produce noisy diffs on every add. The schema is finite + well-defined per
// ARCH 6.6 so a manual emitter is honest here.
function formatEntryBlock(input: TerritoryInput): string {
  const lines: string[] = [];
  lines.push(`  - name: ${input.name}`);
  lines.push(`    owner_role: ${input.owner_role}`);
  lines.push(`    review_role: ${input.review_role ?? 'null'}`);
  lines.push(`    scope_kind: ${input.scope_kind}`);
  if (input.scope_pattern.length === 0) {
    lines.push(`    scope_pattern: []`);
  } else {
    lines.push(`    scope_pattern:`);
    for (const p of input.scope_pattern) {
      lines.push(`      - ${quoteScalarIfNeeded(p)}`);
    }
  }
  if (input.contracts_published.length === 0) {
    lines.push(`    contracts_published: []`);
  } else {
    lines.push(`    contracts_published:`);
    for (const c of input.contracts_published) lines.push(`      - ${c}`);
  }
  if (input.contracts_consumed.length === 0) {
    lines.push(`    contracts_consumed: []`);
  } else {
    lines.push(`    contracts_consumed:`);
    for (const c of input.contracts_consumed) lines.push(`      - ${c}`);
  }
  if (input.description) {
    // Render as folded scalar to match the existing entries' style.
    lines.push(`    description: >`);
    for (const piece of foldDescriptionToLines(input.description, 78)) {
      lines.push(`      ${piece}`);
    }
  } else {
    lines.push(`    description: ""`);
  }
  if (input.requires_plan_review) {
    lines.push(`    requires_plan_review: true`);
  }
  return lines.join('\n');
}

// Conservative quote-needed predicate. The existing entries quote glob
// patterns that contain `#` (anchor-style doc_region patterns) and bare
// strings otherwise; we follow that convention.
function quoteScalarIfNeeded(s: string): string {
  if (/^[A-Za-z0-9_./*-]+$/.test(s) && !s.startsWith('-') && !s.startsWith('?')) {
    return s;
  }
  // JSON.stringify produces a YAML-safe double-quoted scalar.
  return JSON.stringify(s);
}

// Word-wrap a single-paragraph description into folded-scalar lines that
// stay within `lineWidth` chars (matching yaml's default 80-col convention).
function foldDescriptionToLines(text: string, lineWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [text];
  const out: string[] = [];
  let current = '';
  for (const w of words) {
    if (current.length === 0) {
      current = w;
    } else if (current.length + 1 + w.length <= lineWidth) {
      current = `${current} ${w}`;
    } else {
      out.push(current);
      current = w;
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

function appendToYaml(
  state: ExistingState,
  input: TerritoryInput,
): { updated: string; preview: string } {
  const seq = state.rawDocument.get('territories');
  if (!isSeq(seq)) throw new Error('expected territories sequence (load-time invariant)');
  if (seq.items.length === 0) {
    throw new Error(
      'territories sequence is empty; cannot infer insertion point. Add at least one territory by hand first.',
    );
  }

  // Locate the byte offset just after the last existing territory entry.
  // yaml@2.x exposes a `.range` triple on parsed items: [start, valueEnd, nodeEnd].
  // We insert before any trailing comment block / `roles:` section that
  // follows the sequence, by anchoring on the last item's nodeEnd offset.
  const lastItem = seq.items[seq.items.length - 1] as { range?: [number, number, number] };
  const range = lastItem.range;
  if (!range) {
    throw new Error('yaml lib did not provide range info on the last territory entry');
  }
  const insertOffset = range[2];
  const fragment = formatEntryBlock(input);
  const updated =
    state.rawText.slice(0, insertOffset) +
    '\n\n' +
    fragment +
    '\n' +
    state.rawText.slice(insertOffset);

  // Round-trip safety: re-parse the emitted YAML, confirm it's still valid
  // and the new entry is reachable by name.
  const reparsed = parseDocument(updated);
  if (reparsed.errors.length > 0) {
    throw new Error(
      `emitted invalid YAML: ${reparsed.errors.map((e) => e.message).join('; ')}`,
    );
  }
  const reparsedSeq = reparsed.get('territories');
  if (!isSeq(reparsedSeq)) {
    throw new Error('emitted YAML lost the territories sequence');
  }
  if (reparsedSeq.items.length !== seq.items.length + 1) {
    throw new Error(
      `emitted YAML changed sequence length: expected ${seq.items.length + 1}, got ${reparsedSeq.items.length}`,
    );
  }
  const found = reparsedSeq.items.some(
    (it) => isMap(it) && it.get('name') === input.name,
  );
  if (!found) {
    throw new Error(`emitted YAML lost the new "${input.name}" entry`);
  }

  return { updated, preview: fragment };
}

// ---------------------------------------------------------------------------
// validate-refs runner
// ---------------------------------------------------------------------------

interface ValidatorResult {
  ran: boolean;
  exitCode: number | null;
  summary: string;
  /** Captured tail of stdout for surfacing in the human-formatted report. */
  reportTail: string;
}

function runValidator(): ValidatorResult {
  const validatorPath = resolve(REPO_ROOT, 'scripts/traceability/validate-refs.ts');
  if (!existsSync(validatorPath)) {
    return {
      ran: false,
      exitCode: null,
      summary: 'validate-refs.ts not found; skipped.',
      reportTail: '',
    };
  }
  const out = spawnSync(
    'npx',
    ['tsx', validatorPath, '--per-pr'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  const exitCode = out.status;
  const stdout = out.stdout ?? '';
  const summary =
    exitCode === 0
      ? 'validate-refs.ts --per-pr: OK (no drift introduced)'
      : `validate-refs.ts --per-pr: FAIL (exit ${exitCode}); see report tail. The validator walks markdown citations, not territories.yaml -- failures here typically reflect pre-existing baseline issues, not your add. Compare against \`git stash && validate-refs --per-pr\` to confirm.`;
  // Tail the last ~20 lines so we surface the FAIL block without flooding stdout.
  const lines = stdout.trim().split('\n');
  const tail = lines.slice(-20).join('\n');
  return { ran: true, exitCode, summary, reportTail: tail };
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

interface AddJsonOutput {
  ok: boolean;
  dryRun: boolean;
  entry: TerritoryInput;
  filePath: string;
  validator: ValidatorResult;
}

function emitHumanReport(opts: {
  dryRun: boolean;
  preview: string;
  filePath: string;
  validator: ValidatorResult;
}): void {
  const { dryRun, preview, filePath, validator } = opts;
  console.log('');
  if (dryRun) {
    console.log('atelier territory add: DRY RUN (no file written, validator skipped)');
  } else {
    console.log(`atelier territory add: appended to ${filePath}`);
  }
  console.log('');
  console.log('Entry:');
  for (const line of preview.split('\n')) {
    console.log(`  ${line}`);
  }
  console.log('');
  if (!dryRun) {
    console.log(validator.summary);
    if (validator.exitCode !== 0 && validator.reportTail) {
      console.log('');
      console.log('  validate-refs report tail:');
      for (const line of validator.reportTail.split('\n')) {
        console.log(`    ${line}`);
      }
    }
    console.log('');
    console.log('Next steps:');
    console.log('  1. Open a PR with this change (governance per .atelier/territories.yaml header).');
    console.log('  2. After merge, run `atelier sync publish-delivery` (or wait for the next sync');
    console.log('     cycle) to mirror the new territory into the datastore.');
  }
}

// ---------------------------------------------------------------------------
// Subcommand: add
// ---------------------------------------------------------------------------

async function runAdd(args: readonly string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseAddArgs(args);
  } catch (err) {
    console.error(`atelier territory add: ${(err as Error).message}`);
    console.error('');
    console.error(territoryUsage);
    return 2;
  }

  if (parsed.help) {
    console.log(territoryUsage);
    return 0;
  }

  let existing: ExistingState;
  try {
    existing = loadExisting();
  } catch (err) {
    console.error(`atelier territory add: ${(err as Error).message}`);
    return 1;
  }

  // Interactive prompting only when stdin is a TTY and --non-interactive
  // wasn't passed. Required-fields-missing in non-interactive mode is a
  // user error (exit 2).
  const requiredMissing =
    !parsed.name ||
    !parsed.ownerRole ||
    !parsed.scopeKind ||
    parsed.scopePatterns.length === 0;

  if (requiredMissing) {
    if (parsed.nonInteractive || !stdin.isTTY) {
      console.error('atelier territory add: missing required flags.');
      console.error('  --name, --owner-role, --scope-kind, --scope-pattern are required when');
      console.error('  --non-interactive is set or stdin is not a TTY.');
      console.error('');
      console.error('Run `atelier territory add --help` for the full flag list.');
      return 2;
    }
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      await promptForMissingFields(rl, parsed, existing.names);
    } finally {
      rl.close();
    }
  }

  // Coerce the parsed CLI inputs into the canonical TerritoryInput shape.
  // Validation will catch enum / uniqueness violations from any source
  // (flags, prompts, programmatic).
  const input: TerritoryInput = {
    name: parsed.name ?? '',
    owner_role: (parsed.ownerRole ?? '') as Discipline,
    review_role:
      parsed.reviewRole === undefined || parsed.reviewRole === ''
        ? null
        : (parsed.reviewRole as Discipline),
    scope_kind: (parsed.scopeKind ?? '') as ScopeKind,
    scope_pattern: parsed.scopePatterns,
    contracts_published: parsed.contractsPublished,
    contracts_consumed: parsed.contractsConsumed,
    description: parsed.description ?? '',
    requires_plan_review: parsed.requiresPlanReview,
  };

  const errors = validateInput(input, existing.names);
  if (errors.length > 0) {
    console.error('atelier territory add: validation failed:');
    for (const e of errors) {
      console.error(`  ${e.field}: ${e.message}`);
    }
    return 1;
  }

  const { updated, preview } = appendToYaml(existing, input);

  let validator: ValidatorResult;
  if (parsed.dryRun) {
    validator = {
      ran: false,
      exitCode: null,
      summary: 'validator skipped (--dry-run)',
      reportTail: '',
    };
  } else {
    writeFileSync(TERRITORIES_PATH, updated);
    validator = runValidator();
  }

  if (parsed.json) {
    const out: AddJsonOutput = {
      ok: true,
      dryRun: parsed.dryRun,
      entry: input,
      filePath: TERRITORIES_PATH,
      validator,
    };
    console.log(JSON.stringify(out, null, 2));
  } else {
    emitHumanReport({
      dryRun: parsed.dryRun,
      preview,
      filePath: TERRITORIES_PATH,
      validator,
    });
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function runTerritory(args: readonly string[]): Promise<number> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(territoryUsage);
    return 0;
  }
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === 'add') {
    return runAdd(rest);
  }
  console.error(`atelier territory: unknown subcommand "${sub ?? ''}"`);
  console.error('');
  console.error(territoryUsage);
  return 2;
}
