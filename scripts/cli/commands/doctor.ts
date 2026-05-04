// `atelier doctor` — diagnose substrate health (US-11.9; D1 polished form).
//
// Per ARCH 6.1.1 self-verification flow + the 2026-04-28 expert review
// finding that "in self-hosted, connectivity issues are the dominant
// support-volume class." Doctor is the adopter's first-line tool for
// substrate triage.
//
// What this does:
//   1. Runs the preflight checks shared with `atelier dev` (docker,
//      supabase CLI, supabase running, port 3030, bearer expiry, env file)
//   2. If substrate is up, hits /api/mcp with an unauthenticated probe
//      to confirm the endpoint dispatches (expects 401 without bearer
//      = healthy; 500 = endpoint broken; connection-refused = dev
//      server not up)
//   3. Maps observed failures to the symptom-to-cause table in
//      ARCH 6.1.1 with actionable remediation hints
//   4. Exits 0 when all checks pass; exit 1 when any check is degraded
//
// Diagnostic only — does NOT start, restart, or modify the substrate.
// `atelier dev` is the fix surface. This separation keeps doctor safe
// to run from any state without side effects.

import {
  runPreflight,
  formatReport,
  type PreflightReport,
} from '../lib/preflight.ts';
import { probeEndpoint as libProbe, type EndpointProbeResult } from '../../lib/probe.ts';

export const doctorUsage = `atelier doctor — diagnose substrate health

Usage:
  atelier doctor [--json]

Options:
  --json   Emit machine-readable JSON instead of human-formatted output.

Diagnostic only. Reports:
  - docker: daemon reachable
  - supabase CLI: installed
  - supabase running: services up
  - port 3030: state of dev-server port
  - bearer: presence + expiry of .mcp.json bearer
  - dev server: prototype is reachable on :3030
  - env file: prototype/.env.local present
  - endpoint: /api/mcp dispatches (when dev server is up)

Exits 0 when all checks pass; 1 when any check is degraded.
This command does NOT modify substrate state. Use \`atelier dev\` to
start / repair the substrate.

Symptom -> cause hints map to ARCH 6.1.1.
`;

/**
 * Probe /api/mcp without a bearer. A healthy endpoint returns 401 with
 * a JSON-RPC-shaped body (the MCP dispatcher rejects unauthorized).
 * Any other shape indicates degraded behavior. Doctor wraps the shared
 * probe primitive so the doctor-specific error wording is preserved
 * (X1 audit Q3b).
 */
async function probeEndpoint(): Promise<EndpointProbeResult> {
  return libProbe({
    port: 3030,
    classify: (status, body) => {
      if (status === 401) {
        return {
          ok: true,
          detail: 'returned 401 (expected without bearer; endpoint dispatches)',
          statusCode: status,
        };
      }
      if (status === 405) {
        return {
          ok: true,
          detail: 'returned 405 (route reachable; expecting POST)',
          statusCode: status,
        };
      }
      if (status >= 500) {
        return {
          ok: false,
          detail: `returned ${status}: endpoint reachable but error path: ${body.slice(0, 200)}`,
          statusCode: status,
        };
      }
      return {
        ok: false,
        detail: `unexpected ${status} from /api/mcp without bearer`,
        statusCode: status,
      };
    },
  });
}

interface DiagnosisHint {
  symptom: string;
  cause: string;
  fix: string;
}

function deriveHints(report: PreflightReport, endpoint: EndpointProbeResult): DiagnosisHint[] {
  const out: DiagnosisHint[] = [];

  if (!report.docker.ok) {
    out.push({
      symptom: 'docker daemon unreachable',
      cause: 'Docker Desktop or container runtime not running',
      fix: 'start Docker Desktop (or your container runtime); then re-run `atelier doctor`',
    });
  }
  if (!report.supabaseCli.ok) {
    out.push({
      symptom: 'supabase CLI not found',
      cause: 'supabase CLI is not installed or not on PATH',
      fix: 'install via `npm install -g supabase` (or `brew install supabase/tap/supabase`)',
    });
  }
  if (!report.supabaseRunning.ok && report.docker.ok && report.supabaseCli.ok) {
    out.push({
      symptom: 'supabase services not running',
      cause: 'local Supabase stack is stopped',
      fix: 'run `supabase start` (or `atelier dev` to start everything in one go)',
    });
  }
  if (!report.bearer.status.ok) {
    out.push({
      symptom: report.bearer.status.detail ?? 'bearer expired or missing',
      cause: 'Supabase Auth access_tokens default to 1h TTL; .mcp.json bearer not refreshed',
      fix: 'rotate via `npx tsx scripts/bootstrap/rotate-bearer.ts` (per docs/user/guides/rotate-bearer.md)',
    });
  } else if (report.bearer.remainingSeconds !== null && report.bearer.remainingSeconds < 300) {
    out.push({
      symptom: `bearer expires in ${report.bearer.remainingSeconds}s`,
      cause: 'within 5-minute expiry window',
      fix: 'rotate via `npx tsx scripts/bootstrap/rotate-bearer.ts` (per docs/user/guides/rotate-bearer.md)',
    });
  }
  if (!report.envFile.ok) {
    out.push({
      symptom: 'prototype/.env.local missing or incomplete',
      cause: 'env file not copied from .env.example',
      fix: 'cp prototype/.env.example prototype/.env.local && edit OPENAI_API_KEY (per local-bootstrap.md Step 2)',
    });
  }
  if (!endpoint.ok && report.devServer.ok === false) {
    out.push({
      symptom: 'dev server not reachable on :3030',
      cause: 'next dev process not running',
      fix: 'run `atelier dev` (or `cd prototype && npm run dev`)',
    });
  }
  if (!endpoint.ok && endpoint.statusCode && endpoint.statusCode >= 500) {
    out.push({
      symptom: `/api/mcp returned ${endpoint.statusCode}`,
      cause: 'endpoint code path errored — likely missing OIDC env or schema drift',
      fix: 'check dev server stderr: ATELIER_OIDC_ISSUER + ATELIER_JWT_AUDIENCE must be set; supabase migrations must be applied',
    });
  }
  return out;
}

interface DoctorJsonOutput {
  preflight: PreflightReport;
  endpoint: EndpointProbeResult;
  hints: DiagnosisHint[];
  overallOk: boolean;
}

export async function runDoctor(args: readonly string[]): Promise<number> {
  const json = args.includes('--json');
  if (args.includes('--help') || args.includes('-h')) {
    console.log(doctorUsage);
    return 0;
  }

  const preflight = await runPreflight();
  // Probe endpoint regardless of preflight; if dev server not up, probe
  // will report ECONNREFUSED.
  const endpoint = await probeEndpoint();
  const hints = deriveHints(preflight, endpoint);

  const preflightOk =
    preflight.docker.ok &&
    preflight.supabaseCli.ok &&
    preflight.supabaseRunning.ok &&
    preflight.envFile.ok &&
    preflight.bearer.status.ok;
  const overallOk = preflightOk && endpoint.ok;

  if (json) {
    const out: DoctorJsonOutput = { preflight, endpoint, hints, overallOk };
    console.log(JSON.stringify(out, null, 2));
    return overallOk ? 0 : 1;
  }

  // Human-formatted output: reuse formatReport for preflight, then append
  // endpoint + hints.
  console.log(formatReport(preflight));
  console.log('');
  console.log(`endpoint  /api/mcp: ${endpoint.ok ? 'OK' : 'DEGRADED'} ${endpoint.detail}`);
  console.log('');
  if (hints.length === 0) {
    console.log('atelier doctor: substrate is HEALTHY');
    return 0;
  }
  console.log(`atelier doctor: ${hints.length} issue(s) detected:`);
  console.log('');
  for (const h of hints) {
    console.log(`  symptom: ${h.symptom}`);
    console.log(`  cause:   ${h.cause}`);
    console.log(`  fix:     ${h.fix}`);
    console.log('');
  }
  return overallOk ? 0 : 1;
}
