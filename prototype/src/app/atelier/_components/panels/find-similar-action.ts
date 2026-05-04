'use server';

// Server action for the find_similar lens panel (M5 / ARCH 6.4 / US-6.5).
//
// Calls dispatch() in-process per the M3 brief (server actions / server
// components hit the dispatcher directly, avoiding an HTTP round trip to
// /api/mcp). Post canonical-rebuild the deps come from getMcpDeps() (the
// MCP-side warm singleton); the lens does not allocate its own AtelierClient.
//
// The bearer is read from the same Supabase Auth cookie chain the rest of
// the lens uses (resolveBearer → readSupabaseAccessToken via the named
// adapter per ADR-029).

import { cookies } from 'next/headers';

import { dispatch } from '../../../../../../scripts/endpoint/lib/dispatch.ts';
import { getMcpDeps } from '../../../../lib/atelier/mcp-deps.ts';
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
    getMcpDeps(),
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

export { LensAuthError };
