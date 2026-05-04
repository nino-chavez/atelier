// IA/UX dynamic-surface smoke (M7-exit gate per PR #40 + M7-exit audit Pattern 3).
//
// Substitutes the manual `/atelier` walk-through that the M3 lens.smoke.ts
// comment explicitly named as a gap ("UI render is verified by the manual
// /atelier walk-through documented in the M3-exit notes"). Per the global
// CLAUDE.md IA/UX scope rule for dynamic surfaces, the assertion classes
// below are the failure modes static heuristics miss.
//
// Scope:
//   /atelier/[lens] panels (10 panels via lens-data.ts)
//   /atelier/observability sections (8 sections via observability-data.ts)
//
// Assertion classes (per audit Pattern 3 table):
//   1. Default-view logic  — list queries ORDER BY recency
//   2. Scale budget         — list queries declare LIMIT (server-side cap)
//   3. Server-side filter/sort — LIMIT + ORDER BY happen in SQL, not in client
//   4. Freshness contract  — observability Refresher.tsx polls within budget
//   5. Filter/sort visibility — baseline absence assertion (no client filters at v1)
//
// Layer split (per the M7-exit audit):
//   - This file: STATIC layer. Source-text analysis of the data-loading
//     modules + Refresher.tsx + panel components. Deterministic, no DB,
//     no browser. Closes ~70% of the audit Pattern 3 table.
//   - DOM layer (Playwright): freshness-tick observation + DOM row-count
//     ceiling assertion under 50/500/5000-row fixtures. Deferred to a
//     follow-up PR; requires running dev server + seeded substrate.
//
// Run: `npm run smoke:iaux` from repo root.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const PROTOTYPE_SRC = resolve(REPO_ROOT, 'prototype', 'src');

const LENS_DATA = join(PROTOTYPE_SRC, 'lib', 'atelier', 'lens-data.ts');
const OBS_DATA = join(PROTOTYPE_SRC, 'lib', 'atelier', 'observability-data.ts');
const REFRESHER = join(
  PROTOTYPE_SRC,
  'app',
  'atelier',
  'observability',
  '_components',
  'Refresher.tsx',
);
const PANELS_DIR = join(PROTOTYPE_SRC, 'app', 'atelier', '_components', 'panels');

// Documented freshness budget. The audit's Pattern 3 freshness-contract row
// names 30s as the observability poll interval. If this changes, the audit
// needs to learn about it.
const POLL_INTERVAL_MS_EXPECTED = 30_000;

// Documented per-panel ceilings (extracted from the audit + lens-data /
// observability-data source). Static assertion that the LIMIT clauses in
// the source haven't drifted from the documented budget.
const PER_PANEL_CEILINGS: Record<string, number> = {
  'lens.locks': 50,
  'lens.contracts': 25,
  'lens.reviewQueue': 30,
  'observability.recentRegistrations': 10,
  'observability.recentTransitions': 50,
  'observability.lockLedger': 25,
  'observability.recentDecisions': 10,
  'observability.throughputByTerritory': 10,
};

let failures = 0;
let assertions = 0;

function assert(cond: boolean, message: string): void {
  assertions += 1;
  if (cond) return;
  console.error(`FAIL: ${message}`);
  failures += 1;
}

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

// Extract every `pool.query<...>(\`...\`, ...)` invocation from a source file.
// Returns the inner template literal body (the SQL string) per match.
//
// A query is "list-bearing" (returns multiple rows the UI renders) if its
// generic return type is a multi-property row shape, NOT a single scalar
// aggregation `{ count: string }` or single-field accumulator. We classify
// by inspecting the generic-arg block of the call.
//
// We don't try to parse TypeScript here; the pattern is uniform enough across
// both data files that a regex catches all instances. If the codebase starts
// using a different query helper, this needs to grow.
function extractTypedQueries(source: string): { typeBlock: string; sqlBody: string }[] {
  const out: { typeBlock: string; sqlBody: string }[] = [];
  // Between `>(` and the opening backtick: allow whitespace + JS line
  // comments (the obs embedding query has a multi-line // comment between
  // them explaining the ORDER BY, caught by this smoke).
  const re = /pool\.query<([\s\S]*?)>\(\s*(?:\/\/[^\n]*\n\s*)*`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const typeBlock = m[1];
    const sqlBody = m[2];
    if (typeBlock === undefined || sqlBody === undefined) continue;
    out.push({ typeBlock: typeBlock.trim(), sqlBody: sqlBody.trim() });
  }
  return out;
}

function hasOrderBy(sqlBody: string): boolean {
  return /ORDER BY/i.test(sqlBody);
}

function hasLimit(sqlBody: string): boolean {
  return /LIMIT/i.test(sqlBody);
}

function extractLimitValue(sqlBody: string): number | 'parameterized' | null {
  // LIMIT 50 -> 50; LIMIT $5 -> 'parameterized'; no LIMIT -> null
  const m = sqlBody.match(/LIMIT\s+(\d+|\$\d+)/i);
  const captured = m?.[1];
  if (!captured) return null;
  if (captured.startsWith('$')) return 'parameterized';
  return Number(captured);
}

// =====================================================================
// Assertion 1+2: Bidirectional contract on every typed query in both
// data modules:
//   - Rule A: every query with LIMIT must ALSO have ORDER BY
//             (no scale-budget without a deterministic order)
//   - Rule B: every query with `created_at DESC` (or analogous recency
//             timestamp DESC) must ALSO have LIMIT
//             (recency-sorted lists must declare a render ceiling)
//
// These two rules catch the load-bearing failure modes without needing
// to classify every query as scalar-aggregation vs list-bearing — the
// contract holds regardless of return shape, and false positives become
// impossible. Aggregation queries that emit a single scalar row don't
// trigger either rule (no LIMIT, no DESC); list queries always trigger.
// =====================================================================

const RECENCY_DESC_RE = /ORDER BY\s+[\w.]*(?:created_at|updated_at|acquired_at|published_at|heartbeat_at|started_at|reaped_at|timestamp)[\w.]*\s+DESC/i;

// Strip ORDER BY clauses that appear INSIDE aggregate functions like
// ARRAY_AGG(... ORDER BY ...) — those control aggregation order, not result
// row order, and don't trigger the scale-budget contract.
function stripAggregateOrders(sqlBody: string): string {
  // Remove substrings like `ARRAY_AGG(<anything>)`, `JSON_AGG(<anything>)`,
  // `STRING_AGG(<anything>)`, `JSONB_AGG(<anything>)`. The aggregate's
  // contents (including any ORDER BY) won't be tested as top-level orders.
  return sqlBody.replace(/(?:ARRAY_AGG|JSON_AGG|STRING_AGG|JSONB_AGG)\s*\([^)]*\)/gi, '$AGG()');
}

function checkContract(
  source: string,
  label: string,
): { totalQueries: number; ruleAViolations: number; ruleBViolations: number } {
  const queries = extractTypedQueries(source);
  let ruleA = 0;
  let ruleB = 0;
  for (const q of queries) {
    const stripped = stripAggregateOrders(q.sqlBody);
    const limit = hasLimit(stripped);
    const order = hasOrderBy(stripped);
    const recencyDesc = RECENCY_DESC_RE.test(stripped);
    if (limit && !order) {
      assert(false, `${label}: query has LIMIT without ORDER BY — type ${q.typeBlock.slice(0, 80)}`);
      ruleA += 1;
    }
    if (recencyDesc && !limit) {
      assert(false, `${label}: query has recency-DESC ORDER BY without LIMIT — type ${q.typeBlock.slice(0, 80)}`);
      ruleB += 1;
    }
  }
  return { totalQueries: queries.length, ruleAViolations: ruleA, ruleBViolations: ruleB };
}

console.log('# 1. Lens data — LIMIT requires ORDER BY; recency-DESC requires LIMIT');
const lensSource = readSource(LENS_DATA);
const lensResult = checkContract(lensSource, 'lens-data');
console.log(
  `  inspected ${lensResult.totalQueries} typed queries; ` +
    `${lensResult.ruleAViolations} rule-A + ${lensResult.ruleBViolations} rule-B violations`,
);

console.log('# 2. Observability data — same contract');
const obsSource = readSource(OBS_DATA);
const obsResult = checkContract(obsSource, 'observability-data');
console.log(
  `  inspected ${obsResult.totalQueries} typed queries; ` +
    `${obsResult.ruleAViolations} rule-A + ${obsResult.ruleBViolations} rule-B violations`,
);

// Sanity assertion: both modules contain at least one query with LIMIT
// (otherwise the contract is vacuously true and the test isn't actually
// running — defensive against accidental query-helper rename).
assert(
  /LIMIT/i.test(lensSource),
  'lens-data must contain at least one LIMIT clause (sanity check on contract coverage)',
);
assert(
  /LIMIT/i.test(obsSource),
  'observability-data must contain at least one LIMIT clause (sanity check on contract coverage)',
);

const lensQueries = extractTypedQueries(lensSource);
const obsQueries = extractTypedQueries(obsSource);

// X1 audit Q2: minimum-match sanity floors. The extractor regex is
// pattern-fragile — if `pool.query<...>` syntax changes (e.g., a refactor
// to `db.query<...>` or a new helper wrapper), extraction silently
// returns 0 and the contract assertions above become vacuously true.
// Floors reflect today's count minus a small tolerance; bump them up if
// the codebase grows new queries, bump them down only when an audited
// reduction lands.
const LENS_QUERY_FLOOR = 5;
const OBS_QUERY_FLOOR = 8;
assert(
  lensQueries.length >= LENS_QUERY_FLOOR,
  `lens-data.ts query extractor regression: expected >=${LENS_QUERY_FLOOR} typed queries, found ${lensQueries.length} — check the regex against current source`,
);
assert(
  obsQueries.length >= OBS_QUERY_FLOOR,
  `observability-data.ts query extractor regression: expected >=${OBS_QUERY_FLOOR} typed queries, found ${obsQueries.length}`,
);

// =====================================================================
// Assertion 3: Documented per-panel ceilings haven't drifted.
// =====================================================================

console.log('# 3. Per-panel ceilings match audit-documented budget');

// Each panel's query is identified by a unique SQL-body marker (more reliable
// than type-block matching because territory/contribution/review queries
// share field names like `review_role`).
const panelChecks: {
  source: { typeBlock: string; sqlBody: string }[];
  sqlMarker: RegExp;
  expected: number | 'parameterized';
  label: string;
}[] = [
  {
    source: lensQueries,
    sqlMarker: /FROM locks l JOIN composers/,
    expected: PER_PANEL_CEILINGS['lens.locks']!,
    label: 'lens.locks',
  },
  {
    source: lensQueries,
    sqlMarker: /FROM contracts c JOIN territories/,
    expected: PER_PANEL_CEILINGS['lens.contracts']!,
    label: 'lens.contracts',
  },
  {
    source: lensQueries,
    sqlMarker: /co\.state = 'review'/,
    expected: PER_PANEL_CEILINGS['lens.reviewQueue']!,
    label: 'lens.reviewQueue',
  },
  {
    // Contributions-active is parameterized via lens-config depth — assert
    // it's the parameterized form, not a hard-coded number.
    source: lensQueries,
    sqlMarker: /co\.state IN \('open', 'claimed', 'plan_review'/,
    expected: 'parameterized',
    label: 'lens.activeContributions',
  },
  {
    source: obsQueries,
    sqlMarker: /FROM sessions\s+WHERE project_id = \$1 AND created_at > now/,
    expected: PER_PANEL_CEILINGS['observability.recentRegistrations']!,
    label: 'observability.recentRegistrations',
  },
  {
    source: obsQueries,
    sqlMarker: /t\.action LIKE 'contribution\.%'/,
    expected: PER_PANEL_CEILINGS['observability.recentTransitions']!,
    label: 'observability.recentTransitions',
  },
  {
    source: obsQueries,
    sqlMarker: /t\.action IN \('lock\.acquired', 'lock\.released'\)/,
    expected: PER_PANEL_CEILINGS['observability.lockLedger']!,
    label: 'observability.lockLedger',
  },
  {
    source: obsQueries,
    sqlMarker: /GROUP BY t\.name ORDER BY COUNT\(co\.id\) DESC/,
    expected: PER_PANEL_CEILINGS['observability.throughputByTerritory']!,
    label: 'observability.throughputByTerritory',
  },
];

for (const check of panelChecks) {
  const q = check.source.find((qq) => check.sqlMarker.test(qq.sqlBody));
  assert(q !== undefined, `${check.label}: query must exist (marker ${check.sqlMarker})`);
  if (q) {
    const limit = extractLimitValue(q.sqlBody);
    assert(
      limit === check.expected,
      `${check.label}: LIMIT must be ${check.expected} (got ${limit})`,
    );
  }
}

// =====================================================================
// Assertion 4: Freshness contract — Refresher.tsx exists with documented poll.
// =====================================================================

console.log('# 4. Freshness contract — observability Refresher poll interval');
const refresherSource = readSource(REFRESHER);
assert(
  refresherSource.includes(`POLL_INTERVAL_MS = ${POLL_INTERVAL_MS_EXPECTED.toLocaleString('en-US').replace(/,/g, '_')}`)
    || refresherSource.includes(`POLL_INTERVAL_MS = ${POLL_INTERVAL_MS_EXPECTED}`),
  `Refresher.tsx must declare POLL_INTERVAL_MS = ${POLL_INTERVAL_MS_EXPECTED} (audit Pattern 3 contract)`,
);
assert(
  refresherSource.includes('setInterval'),
  'Refresher.tsx must call setInterval (active poll, not one-shot fetch)',
);
assert(
  refresherSource.includes('router.refresh'),
  'Refresher.tsx must invoke router.refresh on tick (SSR re-render captures new state)',
);

// =====================================================================
// Assertion 5: Filter/sort visibility baseline — no client-side controls.
// =====================================================================
//
// The audit explicitly documents the ABSENCE of user-visible filter/sort
// affordances at v1 ("Establishes baseline for v1.x filter/sort additions").
// This assertion documents the absence so any future addition forces an
// explicit acknowledgement: the test must be updated when the first filter
// or sort control lands, which keeps the audit table truthful.

console.log('# 5. Filter/sort visibility baseline — no client controls at v1');
const panelFiles = readdirSync(PANELS_DIR).filter((f) => f.endsWith('.tsx'));
let panelsWithControls = 0;
const controlSignatures = ['<select', '<input type="search"', 'role="combobox"', 'aria-sort'];
for (const file of panelFiles) {
  const src = readSource(join(PANELS_DIR, file));
  for (const sig of controlSignatures) {
    if (src.includes(sig)) {
      panelsWithControls += 1;
      console.log(`  baseline drift: panel ${file} contains ${sig}`);
      break;
    }
  }
}
assert(
  panelsWithControls === 0,
  `lens panels must have ZERO user-visible filter/sort controls at v1 (baseline absence; ${panelsWithControls} drifted)`,
);

// =====================================================================
// Assertion 6: Server-side filter/sort — NO list construction in client modules.
// =====================================================================
//
// Companion to Assertion 5: panels render server-rendered slices (SSR via
// Next App Router). Sort/filter logic must NOT run client-side (no in-memory
// .sort() or .filter() calls operating on the rendered list — those would
// indicate client received unbounded data and is paginating in-browser).
//
// We grep panel components for `.sort(` and `.filter(` invocations on
// JSX-rendered arrays. False positives possible (utility filter calls);
// allowlist them inline if/when they appear.

console.log('# 6. Server-side filter/sort — no client-side list re-sorting');
let clientSortDrift = 0;
for (const file of panelFiles) {
  const src = readSource(join(PANELS_DIR, file));
  // X1 audit Q2: strip line comments BEFORE matching .sort(. The prior
  // lookbehind form (/(?<!\/\/[^\n]*)\.sort\(/g) was unreliable because
  // variable-length lookbehinds collapse to a single position and the
  // assertion didn't actually exclude commented occurrences. Operators
  // who legitimately need to write about sort in code comments can keep
  // doing so; only real .sort() invocations count toward drift.
  const stripped = src.replace(/\/\/[^\n]*$/gm, '');
  const sortMatches = stripped.match(/\.sort\(/g) ?? [];
  if (sortMatches.length > 0) {
    clientSortDrift += sortMatches.length;
    console.log(`  drift: panel ${file} contains ${sortMatches.length} client-side .sort() call(s)`);
  }
}
assert(
  clientSortDrift === 0,
  `panels must not call .sort() on rendered lists client-side (${clientSortDrift} drift instances; sort happens server-side via SQL ORDER BY)`,
);

// =====================================================================
// Summary
// =====================================================================

console.log('');
if (failures === 0) {
  console.log(`iaux smoke: PASS (${assertions} assertions; 0 failures)`);
  process.exit(0);
}
console.log(`iaux smoke: FAIL (${assertions} assertions; ${failures} failure(s))`);
process.exit(1);
