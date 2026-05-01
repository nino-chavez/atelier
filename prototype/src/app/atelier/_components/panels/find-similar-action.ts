'use server';

// Server action for the find_similar lens panel (M5 / ARCH 6.4 / US-6.5).
//
// Calls dispatch() in-process per the M3 brief (server actions / server
// components hit the dispatcher directly, avoiding an HTTP round trip to
// /api/mcp). Mirrors the pattern other panels use to fetch data through
// getLensDeps() + resolveLensViewer.
//
// Wire shape returned matches ARCH 6.4.1 with two additions for the UI:
//   - a top-level `error: string | null` for unauthorized / malformed
//     query paths so the client can render the affordance distinctly
//     from "ran but found nothing"
//   - per-match `score` already in the response shape (no changes there)
//
// What this action does NOT do:
//   - call any logger or analytics; the dispatch() path emits telemetry
//     itself (write.ts recordTelemetry).
//   - cache results. Each call is a fresh search.

import { cookies } from 'next/headers';

import { dispatch } from '../../../../../../scripts/endpoint/lib/dispatch.ts';
import { getLensDeps } from '../../../../lib/atelier/deps.ts';
import { LensAuthError, resolveBearer } from '../../../../lib/atelier/session.ts';
import { nextCookieAdapter } from '../../../../lib/atelier/adapters/next-cookies.ts';
import type { FindSimilarResponse } from '../../../../../../scripts/endpoint/lib/find-similar.ts';

export interface FindSimilarActionResult {
  query: string;
  trace_id: string | null;
  response: FindSimilarResponse | null;
  error: { code: string; message: string } | null;
}

export async function runFindSimilar(
  query: string,
  traceId?: string,
): Promise<FindSimilarActionResult> {
  const trimmedQuery = (query ?? '').trim();
  const trimmedTrace = (traceId ?? '').trim();
  if (trimmedQuery.length === 0) {
    return {
      query: trimmedQuery,
      trace_id: trimmedTrace.length > 0 ? trimmedTrace : null,
      response: null,
      error: { code: 'BAD_REQUEST', message: 'Enter a query to run find_similar.' },
    };
  }

  const deps = getLensDeps();
  const cookieStore = await cookies();
  const bearer = await resolveBearer(new Request('http://internal/find-similar'), {
    cookies: nextCookieAdapter(cookieStore),
  });
  if (!bearer) {
    return {
      query: trimmedQuery,
      trace_id: trimmedTrace.length > 0 ? trimmedTrace : null,
      response: null,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Sign in to run semantic search against this project.',
      },
    };
  }

  const result = await dispatch(
    {
      tool: 'find_similar',
      bearer,
      body: trimmedTrace.length > 0
        ? { description: trimmedQuery, trace_id: trimmedTrace }
        : { description: trimmedQuery },
    },
    deps,
  );

  if (result.ok) {
    return {
      query: trimmedQuery,
      trace_id: trimmedTrace.length > 0 ? trimmedTrace : null,
      response: result.data as FindSimilarResponse,
      error: null,
    };
  }

  return {
    query: trimmedQuery,
    trace_id: trimmedTrace.length > 0 ? trimmedTrace : null,
    response: null,
    error: { code: result.error.code, message: result.error.message },
  };
}

// Re-export for the unauthorized-path handling. Avoids an unused-import
// warning and keeps the import surface explicit for the client component.
export { LensAuthError };
