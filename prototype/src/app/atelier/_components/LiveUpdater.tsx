// LiveUpdater — broadcast-substrate client island for the lens shell.
//
// Per ADR-016 the broadcast substrate sits beside the SDLC sync substrate;
// per ARCH 6.8 the lens UI subscribes to the per-project events channel
// and reconciles by re-fetching canonical state on event arrival. This
// island is the smallest viable surface that closes the M3 affordance
// notes: the SSR-pure panels stay server-rendered, but a small client
// component subscribes and triggers `router.refresh()` so the next render
// pass picks up the new canonical state.
//
// Design notes:
//   - Single island per page, mounted in the lens shell. router.refresh()
//     re-runs the server component for the entire route, so all panels
//     update together. Per-panel refresh would be premature optimization
//     given the project-scoped event volume budget (BUILD-SEQUENCE M4
//     exit criteria: presence accurate within 2 seconds).
//   - 'use client' is the only client boundary in /atelier; the rest of
//     the lens stays SSR-pure.
//   - Per ADR-029 the Supabase-specific bits live in the named adapter
//     module supabase-browser.ts; this island uses only the abstract
//     channel name + event envelope shape from ../../../lib/atelier/
//     adapters/supabase-browser.ts.
//   - Refresh debouncing: events arrive in bursts (e.g., a claim followed
//     by a lock acquisition emits two events in <100ms). We coalesce into
//     a single refresh per REFRESH_COALESCE_MS window so the SSR pass
//     runs once per visible state cluster, not once per event.
//
//     Note: this window is the user-felt freshness floor. Broadcast
//     latency was measured at 3-19ms in the M4 smoke against local
//     Realtime; the perceived staleness budget on /atelier is therefore
//     dominated by REFRESH_COALESCE_MS + the SSR re-render cost, NOT
//     the broadcast hop. If you tune this value, treat it as a UX
//     latency knob, not a transport knob.

'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '../../../lib/atelier/adapters/supabase-browser.ts';

interface LiveUpdaterProps {
  projectId: string;
}

const REFRESH_COALESCE_MS = 150;
const PUBLISH_EVENT_NAME = 'event';

export default function LiveUpdater({ projectId }: LiveUpdaterProps) {
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const channelName = `atelier:project:${projectId}:events`;
    const supabase = getSupabaseBrowserClient();
    const channel: RealtimeChannel = supabase.channel(channelName, {
      config: { broadcast: { self: false, ack: false } },
    });

    const triggerRefresh = (): void => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        router.refresh();
      }, REFRESH_COALESCE_MS);
    };

    channel.on('broadcast', { event: PUBLISH_EVENT_NAME }, () => {
      // Every event kind triggers a refresh at v1; the SSR pass is the
      // single source of truth and re-fetches the canonical state. Future
      // optimization can dispatch on envelope.kind for selective updates.
      triggerRefresh();
    });

    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // Per ARCH 6.8 failure mode: degraded broadcast does not block
        // canonical state. The lens still renders from the last SSR pass;
        // a refresh on next user interaction reconciles. Log for ops.
        // eslint-disable-next-line no-console
        console.warn(`[atelier] broadcast subscribe status: ${status}; lens will fall back to manual refresh.`);
      }
    });

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      channel.unsubscribe().catch(() => {
        // Best-effort teardown.
      });
    };
  }, [projectId, router]);

  return null;
}
