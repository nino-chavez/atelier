// HTTP probe primitive shared between:
//   - scripts/cli/lib/preflight.ts (checkOurDevServer — boolean health check)
//   - scripts/cli/commands/doctor.ts (probeEndpoint — status-detailed probe)
//
// Returns the raw status code + a normalized ok flag so callers decide
// what counts as "healthy" for their context. The /api/mcp endpoint
// returns 401 to unauthenticated POSTs (healthy), 405 to non-POST verbs
// (healthy: route reachable), and 5xx on real degradation.
//
// Per ADR-029, this stays on plain node:http and node:net so the same
// probe runs against any reference-implementation peer (Vercel +
// Supabase Cloud or the local-bootstrap stack) without vendor coupling.

import { request } from 'node:http';

export interface EndpointProbeResult {
  ok: boolean;
  detail: string;
  /** HTTP status code observed when the request reached the server; undefined on transport error. */
  statusCode?: number;
}

export interface ProbeOptions {
  host?: string;
  port: number;
  path?: string;
  method?: 'GET' | 'POST';
  timeoutMs?: number;
  /** Body to send with POST. Defaults to '{}'. */
  body?: string;
  /**
   * Caller-supplied predicate that classifies a response as healthy. The
   * default treats 401 + 405 as "endpoint reachable" and any 5xx as
   * unhealthy; everything else as unexpected.
   */
  classify?: (status: number, body: string) => EndpointProbeResult;
}

const DEFAULTS: Required<Pick<ProbeOptions, 'host' | 'path' | 'method' | 'timeoutMs' | 'body'>> = {
  host: '127.0.0.1',
  path: '/api/mcp',
  method: 'POST',
  timeoutMs: 3000,
  body: '{}',
};

function defaultClassify(status: number, body: string): EndpointProbeResult {
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
  if (status >= 200 && status < 600) {
    return {
      ok: true,
      detail: `dev server reachable (HTTP ${status})`,
      statusCode: status,
    };
  }
  return {
    ok: false,
    detail: `unexpected ${status} from endpoint`,
    statusCode: status,
  };
}

export function probeEndpoint(opts: ProbeOptions): Promise<EndpointProbeResult> {
  const host = opts.host ?? DEFAULTS.host;
  const path = opts.path ?? DEFAULTS.path;
  const method = opts.method ?? DEFAULTS.method;
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  const body = opts.body ?? DEFAULTS.body;
  const classify = opts.classify ?? defaultClassify;

  return new Promise((resolveStatus) => {
    const req = request(
      {
        host,
        port: opts.port,
        path,
        method,
        headers: { 'Content-Type': 'application/json' },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        let bodyOut = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk: string) => (bodyOut += chunk));
        res.on('end', () => resolveStatus(classify(status, bodyOut)));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolveStatus({ ok: false, detail: `timeout connecting to ${host}:${opts.port} (${timeoutMs}ms)` });
    });
    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        resolveStatus({ ok: false, detail: `dev server not running on :${opts.port}` });
      } else {
        resolveStatus({ ok: false, detail: `transport error: ${err.message}` });
      }
    });
    if (method === 'POST') req.write(body);
    req.end();
  });
}
