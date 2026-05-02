// Portability lint: enforce ADR-029 GCP-portability constraint.
//
// Per ADR-029, Vercel-specific dependencies (`@vercel/edge`, `@vercel/kv`,
// `@vercel/edge-config`) and Supabase-specific globals must stay in named
// adapter modules. Without this discipline, the reference impl accumulates
// proprietary surface area that compounds future migration cost (Cloud Run
// equivalent of these packages doesn't exist; replacing them mid-flight is
// a multi-day refactor each).
//
// What this lints:
//
//   1. BANNED OUTRIGHT (no Cloud Run equivalent; never import):
//      - `@vercel/edge`           — Edge Functions runtime, replaced by Fluid
//                                   Compute on the Vercel side AND Cloud Run on
//                                   the GCP side; no shared shape.
//      - `@vercel/kv`             — Vercel-specific Redis-flavored KV; no GCP
//                                   equivalent the substrate would consume.
//      - `@vercel/edge-config`    — read-only edge-cached config; equivalent
//                                   on GCP would be a different service.
//
//   2. ADAPTER-ONLY (allowed in scripts/coordination/adapters/* only):
//      - `@supabase/supabase-js` Realtime API surface (`createClient`,
//        `RealtimeChannel`, `.channel()`, `.subscribe()`).
//        Allowed elsewhere: query/mutation patterns (those are pure
//        Postgres + JWKS auth, both portable).
//
//   3. CODE-PATTERN BAN (anywhere outside adapters):
//      - `.rpc(` calls on Supabase clients. Per ADR-029: "no Supabase RPC
//        functions outside `BroadcastService`". RPC functions are stored
//        procedures in Supabase that don't exist as-is on a Cloud SQL
//        deployment.
//
// What this does NOT lint:
//
//   - Vercel framework imports (Next.js / @vercel/analytics): these run on
//     Cloud Run via `next build && node`. Portable.
//   - Standard `@supabase/supabase-js` query/mutation calls (.from, .select,
//     .insert, .update, .delete): these compile to portable SQL via Postgrest
//     OR can be replaced with `pg` queries trivially. Portable.
//   - `@supabase/ssr` cookie reads in the prototype: the prototype's auth
//     cookie shape is the v1 reference; replacing for GCP requires a
//     different ssr layer regardless. Per-runtime, not per-import.
//
// Run:
//   npm run lint:portability
//   # or:
//   npx tsx scripts/lint/portability-lint.ts
//
// Exit 0 on clean, 1 on findings, 2 on internal error.

import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// Files to lint. Globs relative to REPO_ROOT. Allowlist; new code paths
// expand it explicitly.
const TARGETS: readonly string[] = [
  'scripts/**/*.ts',
  'prototype/src/**/*.ts',
  'prototype/src/**/*.tsx',
];

// Files to skip even if they match TARGETS. Smokes can import @supabase
// for fixture setup; node_modules is never linted; the linter itself
// includes self-documenting examples of the patterns it bans.
const SKIP_PATTERNS: readonly RegExp[] = [
  /\/node_modules\//,
  /\/__smoke__\//,
  /\/scripts\/lint\/portability-lint\.ts$/,
];

// Adapter-only allowlist: paths under here may import the adapter-only
// surfaces. Per ADR-029 the named-adapter directory.
//
// Two locations qualify as "named adapter":
//
//   1. scripts/coordination/adapters/* — server-side Supabase / OpenAI-
//      compatible adapter implementations per ARCH §6.8 + ADR-041.
//
//   2. Specific prototype client-side files that subscribe to broadcasts.
//      Client-side React components running in the browser cannot consume
//      a server-side BroadcastService wrapper; the realtime subscription
//      MUST happen in the client. The shape preserves portability: the
//      client code is small, well-named, and self-contained — swapping
//      Supabase Realtime for a Cloud Run WebSocket adapter (per ADR-029
//      migration impl) requires editing only the listed files.
const ADAPTER_ALLOWLIST_PATTERNS: readonly RegExp[] = [
  /^scripts\/coordination\/adapters\//,
  /^prototype\/src\/app\/atelier\/_components\/LiveUpdater\.tsx$/,
];

// Patterns that ban the import outright (rule 1).
const BANNED_OUTRIGHT: ReadonlyArray<{ pkg: string; reason: string }> = [
  { pkg: '@vercel/edge', reason: 'Edge runtime; no Cloud Run equivalent (ADR-029)' },
  { pkg: '@vercel/kv', reason: 'Vercel-specific KV; no GCP equivalent (ADR-029)' },
  { pkg: '@vercel/edge-config', reason: 'Vercel-specific edge-cached config (ADR-029)' },
];

// Patterns that allow the import only inside named adapter dirs (rule 2).
//
// We don't blanket-ban @supabase/supabase-js because most call shapes (.from,
// .select, .insert, .update, .delete) are portable Postgres-via-Postgrest.
// What's NOT portable is the Realtime API. We catch Realtime usage by
// looking at imported symbols (RealtimeChannel, createClient when paired
// with .channel() in the same file) rather than blanket-banning the package.
//
// Simpler v1 heuristic: if a non-adapter file imports `RealtimeChannel`,
// that's the Realtime surface. Fail. Other supabase-js imports stay
// allowed everywhere.
const ADAPTER_ONLY_SYMBOLS: ReadonlyArray<{ pkg: string; symbol: string; reason: string }> = [
  {
    pkg: '@supabase/supabase-js',
    symbol: 'RealtimeChannel',
    reason: 'Realtime channel API; wrap in BroadcastService adapter per ADR-029',
  },
];

// Code patterns banned outside adapter dirs (rule 3).
//
// `.rpc(` is the Supabase RPC API for invoking Postgres stored procedures.
// Per ADR-029 these don't exist on Cloud SQL; the substrate must use
// portable patterns (direct SQL via pg, or the .from/.select interface).
const CODE_PATTERN_BANS: ReadonlyArray<{ regex: RegExp; reason: string }> = [
  {
    regex: /\.rpc\s*\(/,
    reason: 'Supabase .rpc() invokes a Postgres stored procedure; not portable to Cloud SQL (ADR-029)',
  },
];

interface Finding {
  file: string;
  line: number;
  rule: 'banned_outright' | 'adapter_only' | 'code_pattern';
  excerpt: string;
  reason: string;
}

async function expandTargets(): Promise<readonly string[]> {
  const matches: string[] = [];
  for (const pattern of TARGETS) {
    for await (const entry of glob(pattern, { cwd: REPO_ROOT })) {
      // glob's output uses platform separators; normalize for matching
      // against our patterns.
      const normalized = entry.split('\\').join('/');
      if (SKIP_PATTERNS.some((rx) => rx.test('/' + normalized))) continue;
      matches.push(normalized);
    }
  }
  return matches.sort();
}

function isAdapterAllowed(relPath: string): boolean {
  return ADAPTER_ALLOWLIST_PATTERNS.some((rx) => rx.test(relPath));
}

function findingsForFile(relPath: string, body: string): Finding[] {
  const out: Finding[] = [];
  const lines = body.split('\n');
  const adapterDir = isAdapterAllowed(relPath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // Rule 1: outright-banned packages. Match `from '<pkg>'` or
    // `from "<pkg>"` or import `'<pkg>'`.
    for (const ban of BANNED_OUTRIGHT) {
      const rx = new RegExp(
        `(?:from|import)\\s+['"]` + escapeForRegex(ban.pkg) + `(?:/[^'"]*)?['"]`
      );
      if (rx.test(line)) {
        out.push({
          file: relPath,
          line: i + 1,
          rule: 'banned_outright',
          excerpt: line.trim(),
          reason: `imports ${ban.pkg}: ${ban.reason}`,
        });
      }
    }

    // Rule 2: adapter-only symbols. Skip when we're already in an adapter
    // dir (allowed there).
    if (!adapterDir) {
      for (const policy of ADAPTER_ONLY_SYMBOLS) {
        // Symbol must appear in an `import { ... } from '<pkg>'` line.
        const rx = new RegExp(
          `import\\s*(?:type\\s*)?\\{[^}]*\\b` +
            escapeForRegex(policy.symbol) +
            `\\b[^}]*\\}\\s*from\\s+['"]` +
            escapeForRegex(policy.pkg) +
            `['"]`
        );
        if (rx.test(line)) {
          out.push({
            file: relPath,
            line: i + 1,
            rule: 'adapter_only',
            excerpt: line.trim(),
            reason: `imports ${policy.symbol} from ${policy.pkg}: ${policy.reason}`,
          });
        }
      }
    }

    // Rule 3: code-pattern bans. Skip in adapter dirs.
    if (!adapterDir) {
      for (const ban of CODE_PATTERN_BANS) {
        if (ban.regex.test(line)) {
          out.push({
            file: relPath,
            line: i + 1,
            rule: 'code_pattern',
            excerpt: line.trim(),
            reason: ban.reason,
          });
        }
      }
    }
  }

  return out;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main(): Promise<void> {
  const targets = await expandTargets();
  if (targets.length === 0) {
    console.error('portability-lint: no files matched any pattern in TARGETS');
    process.exit(2);
  }

  const allFindings: Finding[] = [];
  for (const relPath of targets) {
    const abs = join(REPO_ROOT, relPath);
    const body = await readFile(abs, 'utf8');
    const findings = findingsForFile(relPath, body);
    allFindings.push(...findings);
  }

  console.log(
    `portability-lint: scanned ${targets.length} file(s); found ${allFindings.length} issue(s)`
  );
  for (const f of allFindings) {
    console.log(`  ${f.file}:${f.line}  ${f.rule}: ${f.reason}`);
    console.log(`    | ${f.excerpt}`);
  }

  if (allFindings.length > 0) {
    process.exit(1);
  }

  console.log('portability-lint: PASS');
}

main().catch((err) => {
  console.error('portability-lint: unexpected failure');
  console.error(err);
  process.exit(2);
});
