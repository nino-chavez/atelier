// Observability admin gate (post canonical-rebuild).
//
// Mirrors session.ts:resolveLensViewer but additionally requires
// composers.access_level='admin' (per ARCH 8.2 admin-gated route).
// Stakeholder + member access levels see a clean unauthorized state.
//
// Single Supabase RPC (`atelier_obs_admin_viewer`) does the resolve +
// admin gate + dashboard-session ensure. No pg.Pool.

import type { ServerSupabaseClient } from './adapters/supabase-ssr.ts';
import { LensAuthError, getRequestSupabaseClient } from './session.ts';

export interface ObservabilityViewer {
  composerId: string;
  projectId: string;
  composerName: string;
  projectName: string;
  accessLevel: string | null;
  sessionId: string;
}

export class ObservabilityForbiddenError extends Error {
  override readonly name = 'ObservabilityForbiddenError';
  constructor(message: string) {
    super(message);
  }
}

interface RawAdminViewer {
  composer_id: string;
  project_id: string;
  composer_name: string;
  project_name: string;
  access_level: string | null;
  session_id: string;
}

export async function resolveObservabilityViewer(
  client?: ServerSupabaseClient,
): Promise<ObservabilityViewer> {
  const supabase = client ?? (await getRequestSupabaseClient());
  const { data, error } = await supabase.rpc<Record<string, never>, RawAdminViewer>(
    'atelier_obs_admin_viewer',
  );
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('observability_forbidden')) {
      throw new ObservabilityForbiddenError(
        `Observability dashboard is admin-gated; ${msg}`,
      );
    }
    if (msg.includes('no_composer')) {
      throw new LensAuthError('no_composer', msg);
    }
    throw new LensAuthError('invalid_bearer', `atelier_obs_admin_viewer failed: ${msg}`);
  }
  if (!data) {
    throw new LensAuthError('no_composer', 'No active composer for the current Auth session.');
  }
  return {
    composerId: data.composer_id,
    projectId: data.project_id,
    composerName: data.composer_name,
    projectName: data.project_name,
    accessLevel: data.access_level,
    sessionId: data.session_id,
  };
}
