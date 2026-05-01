// BroadcastService interface (ARCH 6.8 / ADR-029).
//
// The coordination broadcast substrate (the second of ADR-016's two
// orthogonal substrates) carries real-time state-change events from the
// endpoint to interested subscribers. This module defines the
// vendor-neutral interface every implementation must satisfy. Concrete
// implementations live under `../adapters/` per ADR-029 -- this file
// does NOT import any provider SDK.
//
// Architecture per ARCH 6.8:
//   - Topology: per-project channel by default
//   - Channel name: `atelier:project:<project_id>:events`
//   - Ordering: per-channel FIFO + at-least-once
//   - id/seq: monotonic per project, allocated by the publisher
//   - Failure mode: degraded broadcast does not block the datastore write
//                   (ADR-005: repo-first; broadcast is downstream)
//
// Per ADR-016 the broadcast substrate sits beside the SDLC-sync substrate;
// the canonical write to Postgres is authoritative, and broadcast is the
// change-notification layer above it. Subscribers must be idempotent and
// must reconcile against the canonical state on `degraded=true` reconnects.

// ===========================================================================
// Event taxonomy (ARCH 6.8 event categories)
// ===========================================================================

export type BroadcastEventKind =
  | 'contribution.state_changed'
  | 'contribution.released'
  | 'decision.created'
  | 'lock.acquired'
  | 'lock.released'
  | 'contract.published'
  | 'session.presence_changed';

export interface ContributionStateChangedPayload {
  contribution_id: string;
  prior_state: string | null;
  new_state: string;
  author_session_id: string | null;
  author_composer_id: string | null;
  trace_ids: string[];
}

export interface ContributionReleasedPayload {
  contribution_id: string;
  prior_author_session_id: string | null;
  prior_author_composer_id: string | null;
  reason: 'released' | 'reaped';
}

export interface DecisionCreatedPayload {
  decision_id: string;
  adr_id: string;
  trace_ids: string[];
  summary: string;
  category: 'architecture' | 'product' | 'design' | 'research';
}

export interface LockAcquiredPayload {
  lock_id: string;
  contribution_id: string;
  artifact_scope: string[];
  holder_session_id: string;
  holder_composer_id: string;
  fencing_token: string;
}

export interface LockReleasedPayload {
  lock_id: string;
  contribution_id: string | null;
  prior_holder_session_id: string | null;
  prior_holder_composer_id: string | null;
  reason: 'released' | 'reaped';
}

export interface ContractPublishedPayload {
  contract_id: string;
  territory_id: string;
  name: string;
  version: number;
  breaking: boolean;
}

export interface SessionPresenceChangedPayload {
  session_id: string;
  composer_id: string;
  status: 'active' | 'idle' | 'dead';
  surface: 'ide' | 'web' | 'terminal' | 'passive';
  agent_client: string | null;
}

export type BroadcastPayload =
  | ContributionStateChangedPayload
  | ContributionReleasedPayload
  | DecisionCreatedPayload
  | LockAcquiredPayload
  | LockReleasedPayload
  | ContractPublishedPayload
  | SessionPresenceChangedPayload;

// ===========================================================================
// Envelope (ARCH 6.8 ordering guarantees)
// ===========================================================================

/**
 * Wire envelope for a single broadcast event. The publisher is responsible
 * for allocating `id` and `seq` (monotonic per project) before calling
 * publish() so subscribers can detect gaps on reconnect.
 *
 * `id` and `seq` are equal at v1 because there is exactly one channel per
 * project; they are kept distinct in the envelope because the topology
 * extension to per-guild channels (noted in ARCH 6.8 as a non-feature at
 * v1) would diverge them.
 */
export interface BroadcastEnvelope<TKind extends BroadcastEventKind = BroadcastEventKind> {
  /** Monotonic per project. Used by subscribers for at-least-once dedup. */
  id: string;
  /** Monotonic per channel. Used by subscribers to detect gaps on reconnect. */
  seq: string;
  /** Wall-clock time at publish; informational, not used for ordering. */
  published_at: string;
  kind: TKind;
  project_id: string;
  payload: TKind extends 'contribution.state_changed'
    ? ContributionStateChangedPayload
    : TKind extends 'contribution.released'
      ? ContributionReleasedPayload
      : TKind extends 'decision.created'
        ? DecisionCreatedPayload
        : TKind extends 'lock.acquired'
          ? LockAcquiredPayload
          : TKind extends 'lock.released'
            ? LockReleasedPayload
            : TKind extends 'contract.published'
              ? ContractPublishedPayload
              : TKind extends 'session.presence_changed'
                ? SessionPresenceChangedPayload
                : never;
  /**
   * Set true on the first event a subscriber receives after a reconnect;
   * indicates the subscriber may have missed events while disconnected and
   * should reconcile against canonical state. ARCH 6.8 failure-mode rule.
   */
  degraded?: boolean;
}

// ===========================================================================
// Subscription handle
// ===========================================================================

export interface Subscription {
  channel: string;
  unsubscribe(): Promise<void>;
}

export type BroadcastHandler = (envelope: BroadcastEnvelope) => void | Promise<void>;

// ===========================================================================
// Service contract (ARCH 6.8 interface contract)
// ===========================================================================

/**
 * Publisher-side options. The seq + id allocator is injected so the
 * service stays pure transport; the AtelierClient owns the Postgres
 * sequence (allocate_broadcast_seq) and threads the allocated values
 * into the envelope before calling publish().
 */
export interface PublishInput<TKind extends BroadcastEventKind = BroadcastEventKind> {
  channel: string;
  envelope: BroadcastEnvelope<TKind>;
}

export interface SubscribeInput {
  channel: string;
  /**
   * Bearer JWT for authorization. Per ARCH 6.8 step 4 the BroadcastService
   * validates the JWT against the project_id encoded in the channel name
   * before delivering events.
   */
  jwt: string;
  handler: BroadcastHandler;
}

/**
 * BroadcastService — the vendor-neutral pub/sub contract every adapter
 * must implement. Reference impl is Supabase Realtime; the documented
 * migration impl is Postgres NOTIFY/LISTEN with a sequence-number wrapper.
 *
 * Required ordering guarantees per ARCH 6.8:
 *   - FIFO per channel
 *   - At-least-once delivery (no exactly-once; subscribers idempotent via id)
 *   - No cross-channel ordering
 */
export interface BroadcastService {
  publish(input: PublishInput): Promise<void>;
  subscribe(input: SubscribeInput): Promise<Subscription>;
  /** Explicit unsubscribe; the Subscription handle is sufficient for callers. */
  unsubscribe(subscription: Subscription): Promise<void>;
  /**
   * Optional resource cleanup for adapters that hold pooled connections
   * (Supabase Realtime does; NOTIFY/LISTEN does). Called at process shutdown.
   */
  close?(): Promise<void>;
}

// ===========================================================================
// Channel naming (ARCH 6.8: per-project channel by default)
// ===========================================================================

/**
 * Compute the canonical project-events channel name. Subscribers compute
 * this from `project_id` without a discovery round-trip per ARCH 6.8.
 */
export function projectEventsChannel(projectId: string): string {
  if (!projectId || projectId.trim().length === 0) {
    throw new Error('projectEventsChannel: project_id is required');
  }
  return `atelier:project:${projectId}:events`;
}

/**
 * Parse a channel name back to its project_id. Returns null if the channel
 * does not match the per-project pattern. Adapters use this to enforce
 * channel-name -> project_id authorization at subscribe time per ARCH 6.8
 * step 4.
 */
export function projectIdFromChannel(channel: string): string | null {
  const match = channel.match(/^atelier:project:([^:]+):events$/);
  return match ? match[1]! : null;
}

// ===========================================================================
// No-op service (degraded-broadcast fallback)
// ===========================================================================

/**
 * No-op BroadcastService. Used when broadcast is intentionally disabled
 * (single-process tooling like sync scripts that don't need fan-out) or
 * when the configured provider is unreachable. Per ARCH 6.8 the canonical
 * write still succeeds; broadcast is downstream.
 *
 * Subscribers that connect to a no-op service will simply never receive
 * events; the lens UI's polling fallback per ARCH 6.8 covers this case.
 */
export class NoopBroadcastService implements BroadcastService {
  async publish(_input: PublishInput): Promise<void> {
    // Intentionally empty. The publish is a no-op; canonical state lives
    // in Postgres regardless.
  }

  async subscribe(input: SubscribeInput): Promise<Subscription> {
    return {
      channel: input.channel,
      unsubscribe: async () => {
        // Intentionally empty.
      },
    };
  }

  async unsubscribe(_subscription: Subscription): Promise<void> {
    // Intentionally empty.
  }
}
