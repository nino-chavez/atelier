// Browser-side Supabase client adapter (ADR-029 named adapter).
//
// Per ADR-029 the reference impl preserves GCP-portability; Supabase-specific
// dependencies must stay in named adapter modules. This file is the only
// place in the lens client-side code that imports the Supabase browser
// client. Swapping to a different IdP/Realtime stack means writing a sibling
// adapter, not editing the live-updater island.

'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * Lazy-construct the browser Supabase client. The client picks up the
 * Auth cookie automatically and uses it as the bearer for Realtime
 * subscriptions, satisfying ARCH 6.8 step 4 (subscribe presents bearer
 * JWT; broadcast service validates against project_id in channel name).
 *
 * createBrowserClient handles the chunked-cookie envelope (sb-<ref>-auth-
 * token.0/.1/...) so the same access_token resolved server-side via
 * @supabase/ssr is available client-side. Cookies option is intentionally
 * omitted: per @supabase/ssr docs the default browser cookie handling is
 * the supported path; customizing is for advanced use only.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set; the broadcast island cannot subscribe to Realtime (ADR-027 / ADR-029).',
    );
  }
  cached = createBrowserClient(url, anonKey);
  return cached;
}
