// Observability admin gate.
//
// Mirrors session.ts:resolveLensViewer but additionally requires
// composers.access_level='admin' (per ARCH 8.2 admin-gated route).
// Stakeholder + member access levels see a clean unauthorized state.

import type { Pool } from 'pg';
import type { LensDeps } from './deps.ts';
import {
  LensAuthError,
  resolveLensViewer,
} from './session.ts';
import type { ResolveBearerOptions } from './session.ts';
import type { AuthContext } from '../../../../scripts/endpoint/lib/auth.ts';

export interface ObservabilityViewer {
  auth: AuthContext;
  sessionId: string;
  composerName: string;
  projectName: string;
  accessLevel: string | null;
}

export class ObservabilityForbiddenError extends Error {
  override readonly name = 'ObservabilityForbiddenError';
  constructor(message: string) {
    super(message);
  }
}

export async function resolveObservabilityViewer(
  request: Request,
  deps: LensDeps,
  opts: ResolveBearerOptions,
): Promise<ObservabilityViewer> {
  const { auth, sessionId } = await resolveLensViewer(request, deps, opts);
  const pool = (deps.client as unknown as { pool: Pool }).pool;
  const { rows } = await pool.query<{
    display_name: string;
    access_level: string | null;
    project_name: string;
  }>(
    `SELECT c.display_name, c.access_level::text AS access_level, p.name AS project_name
       FROM composers c JOIN projects p ON p.id = c.project_id
      WHERE c.id = $1 AND p.id = $2`,
    [auth.composerId, auth.projectId],
  );
  const row = rows[0];
  if (!row) {
    throw new LensAuthError('no_composer', 'Composer record not found.');
  }
  if (row.access_level !== 'admin') {
    throw new ObservabilityForbiddenError(
      `Observability dashboard is admin-gated; your access_level is ${row.access_level ?? 'unset'}.`,
    );
  }
  return {
    auth,
    sessionId,
    composerName: row.display_name,
    projectName: row.project_name,
    accessLevel: row.access_level,
  };
}
