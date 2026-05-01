// Supabase Realtime adapter for the BroadcastService interface (ADR-029).
//
// Per ADR-029 the reference impl preserves GCP-portability; Supabase-specific
// dependencies must stay in NAMED ADAPTER MODULES. This file is the only
// place in the broadcast substrate that imports `@supabase/supabase-js`.
// Swapping to Postgres NOTIFY/LISTEN (the documented migration impl) means
// writing a sibling adapter, not editing broadcast.ts.
//
// Implementation notes:
//   - Publish path uses the service-role client. Realtime broadcasts are
//     ephemeral (no persistence; per-channel FIFO + at-least-once); the
//     canonical state lives in Postgres regardless per ADR-005.
//   - Subscribe path uses the user's bearer JWT (Supabase access_token).
//     Per ARCH 6.8 step 4, project_id authorization is enforced by RLS on
//     the Postgres rows the events reference, plus channel-name validation
//     here. Future hardening: bind broadcast channels to Realtime
//     authorization policies (Supabase recently added "private channels"
//     via realtime.broadcast_changes; v1 keeps the simpler model).
//   - The adapter does NOT allocate ids/seqs. Allocation is the publisher's
//     responsibility (AtelierClient owns the Postgres sequence). Callers
//     must populate envelope.id and envelope.seq before publish().

import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from '@supabase/supabase-js';

import {
  projectIdFromChannel,
  type BroadcastEnvelope,
  type BroadcastService,
  type PublishInput,
  type SubscribeInput,
  type Subscription,
} from '../lib/broadcast.ts';

// ===========================================================================
// Configuration
// ===========================================================================

export interface SupabaseRealtimeOptions {
  /** Supabase project URL, e.g. http://127.0.0.1:54321 (local) or https://<ref>.supabase.co */
  url: string;
  /**
   * Service-role key. Used for the publish-side client only. The
   * publisher always runs server-side (the AtelierClient). Subscribers
   * use their own JWT.
   */
  serviceRoleKey: string;
  /** Anon key. Used to construct subscriber clients that authenticate via user JWT. */
  anonKey: string;
}

/**
 * Resolve adapter config from process.env. Throws with concrete messages
 * when required values are missing so misconfiguration fails closed at
 * startup rather than silently dropping events at runtime.
 */
export function supabaseRealtimeOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseRealtimeOptions {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) {
    throw new Error(
      'SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) not set; Supabase Realtime adapter requires the API URL (ADR-027).',
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY not set; the publish-side broadcaster requires service-role auth (ARCH 6.8).',
    );
  }
  if (!anonKey) {
    throw new Error(
      'SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) not set; subscriber clients need the anon key as the base for user JWT auth (ADR-027).',
    );
  }
  return { url, serviceRoleKey, anonKey };
}

// ===========================================================================
// Adapter
// ===========================================================================

const PUBLISH_EVENT_NAME = 'event';

/**
 * SupabaseRealtimeBroadcastService — concrete BroadcastService implementation
 * backed by Supabase Realtime broadcast channels.
 *
 * Lifecycle:
 *   - Construct once per process (publisher side; the AtelierClient injects
 *     this into write.ts paths).
 *   - Each subscribe() call creates a fresh RealtimeChannel keyed on the
 *     channel name + a per-subscription user client (each user client is
 *     authenticated with its own JWT so RLS-scoped reads on the canonical
 *     state still work when the subscriber re-fetches on event arrival).
 *   - close() tears down the publisher channel and unsubscribes all
 *     outstanding subscriptions. Adapters that hold pooled connections
 *     should not be reused after close().
 */
export class SupabaseRealtimeBroadcastService implements BroadcastService {
  private readonly publisher: SupabaseClient;
  private readonly publishChannels = new Map<string, RealtimeChannel>();
  private readonly subscribeClients: SupabaseClient[] = [];

  constructor(private readonly options: SupabaseRealtimeOptions) {
    this.publisher = createClient(options.url, options.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 50 } },
    });
  }

  async publish(input: PublishInput): Promise<void> {
    if (!input.envelope.id || !input.envelope.seq) {
      throw new Error(
        'BroadcastEnvelope.id and .seq must be populated by the publisher before calling publish() (ARCH 6.8 ordering).',
      );
    }

    const channel = this.acquirePublishChannel(input.channel);
    const result = await channel.send({
      type: 'broadcast',
      event: PUBLISH_EVENT_NAME,
      payload: input.envelope,
    });
    if (result !== 'ok') {
      // 'timed out' / 'error' are non-fatal at the broadcast layer:
      // canonical state still has the row and subscribers reconcile on
      // next reconnect via degraded=true. Surface to the caller so it can
      // log and degrade rather than silently drop.
      throw new Error(`Supabase Realtime publish failed for channel "${input.channel}": ${result}`);
    }
  }

  async subscribe(input: SubscribeInput): Promise<Subscription> {
    const projectId = projectIdFromChannel(input.channel);
    if (!projectId) {
      throw new Error(
        `Channel "${input.channel}" does not match the per-project pattern; subscribe rejected.`,
      );
    }

    // Per-subscriber client carries the user's JWT so any reconciling
    // pool reads the subscriber issues use the same RLS scope. Realtime
    // itself trusts the channel name + RLS on referenced rows for v1.
    const userClient = createClient(this.options.url, this.options.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${input.jwt}` } },
    });
    this.subscribeClients.push(userClient);

    const channel = userClient.channel(input.channel, {
      config: { broadcast: { self: true, ack: false } },
    });

    const subscribePromise = new Promise<void>((resolve, reject) => {
      channel.on('broadcast', { event: PUBLISH_EVENT_NAME }, (message) => {
        const envelope = message['payload'] as BroadcastEnvelope | undefined;
        if (!envelope) return;
        Promise.resolve()
          .then(() => input.handler(envelope))
          .catch((err) => {
            // Subscriber handler error: don't let it kill the channel.
            // Log and continue; idempotency invariant means redelivery
            // would have surfaced the same error anyway.
            // eslint-disable-next-line no-console
            console.error(
              `[supabase-realtime] subscriber handler threw for channel "${input.channel}":`,
              err,
            );
          });
      });
      channel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          resolve();
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          reject(
            err ??
              new Error(
                `Supabase Realtime subscribe failed for channel "${input.channel}": status=${status}`,
              ),
          );
        }
      });
    });

    await subscribePromise;

    return {
      channel: input.channel,
      unsubscribe: async () => {
        await channel.unsubscribe();
        await userClient.removeAllChannels();
      },
    };
  }

  async unsubscribe(subscription: Subscription): Promise<void> {
    await subscription.unsubscribe();
  }

  async close(): Promise<void> {
    for (const channel of this.publishChannels.values()) {
      try {
        await channel.unsubscribe();
      } catch {
        // Best-effort teardown; do not block shutdown on a hung channel.
      }
    }
    this.publishChannels.clear();
    try {
      await this.publisher.removeAllChannels();
    } catch {
      // Same: best-effort.
    }
    for (const userClient of this.subscribeClients) {
      try {
        await userClient.removeAllChannels();
      } catch {
        // Same: best-effort.
      }
    }
    this.subscribeClients.length = 0;
  }

  /**
   * Realtime requires every channel that is `send()`-ed to be subscribed
   * first (even from the publisher side). We cache the publisher channel
   * per logical channel name so repeated publishes don't re-subscribe.
   */
  private acquirePublishChannel(name: string): RealtimeChannel {
    let existing = this.publishChannels.get(name);
    if (existing) return existing;
    existing = this.publisher.channel(name, {
      config: { broadcast: { self: false, ack: false } },
    });
    existing.subscribe();
    this.publishChannels.set(name, existing);
    return existing;
  }
}

/**
 * Convenience factory: construct a SupabaseRealtimeBroadcastService from
 * environment variables. Used by the AtelierClient's broadcaster wiring
 * and by smoke tests.
 */
export function createSupabaseRealtimeBroadcastService(
  options?: SupabaseRealtimeOptions,
): SupabaseRealtimeBroadcastService {
  return new SupabaseRealtimeBroadcastService(options ?? supabaseRealtimeOptionsFromEnv());
}
