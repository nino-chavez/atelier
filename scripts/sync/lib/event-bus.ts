// In-memory typed event bus.
//
// This is the M1 -> M2 -> M4 cutover seam for `publish-delivery` per
// `../../README.md` "publish-delivery trigger model":
//   M1: polling source publishes to this bus
//   M2: endpoint post-commit hook publishes to this bus
//   M4: BroadcastService bridges into this bus
// In every case the subscriber code does not change; only the bus's
// source-of-events changes. That is what makes the cutover one-line.
//
// The bus is intentionally minimal: typed channels, sync handlers, no
// persistence. It runs in the same process as the publisher and subscriber.
// When the broadcast substrate lands at M4 (per ADR-029 BroadcastService),
// the bridge will translate broadcast deliveries into bus.publish calls.

export interface EventEnvelope<TPayload = unknown> {
  channel: string;
  payload: TPayload;
  publishedAt: Date;
}

export type EventHandler<TPayload = unknown> = (envelope: EventEnvelope<TPayload>) => void | Promise<void>;

export interface EventBus {
  publish<TPayload>(channel: string, payload: TPayload): Promise<void>;
  subscribe<TPayload>(channel: string, handler: EventHandler<TPayload>): Unsubscribe;
  /** Drains pending handler invocations -- useful in tests. */
  drain(): Promise<void>;
  /** Subscriber count for a channel. */
  subscriberCount(channel: string): number;
}

export type Unsubscribe = () => void;

class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly pending: Promise<unknown>[] = [];

  async publish<TPayload>(channel: string, payload: TPayload): Promise<void> {
    const handlers = this.handlers.get(channel);
    if (!handlers || handlers.size === 0) return;

    const envelope: EventEnvelope<TPayload> = { channel, payload, publishedAt: new Date() };
    for (const handler of handlers) {
      // Each handler is fire-and-forget from publish()'s perspective, but
      // failures are surfaced via .catch -> console.error so the polling
      // loop is not silently broken by a misbehaving subscriber.
      const result = Promise.resolve()
        .then(() => (handler as EventHandler<TPayload>)(envelope))
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error(`[event-bus] handler for channel "${channel}" threw:`, err);
        });
      this.pending.push(result);
    }
  }

  subscribe<TPayload>(channel: string, handler: EventHandler<TPayload>): Unsubscribe {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set<EventHandler>();
      this.handlers.set(channel, set);
    }
    set.add(handler as EventHandler);
    return () => {
      set!.delete(handler as EventHandler);
      if (set!.size === 0) this.handlers.delete(channel);
    };
  }

  async drain(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending.splice(0, this.pending.length);
      await Promise.allSettled(batch);
    }
  }

  subscriberCount(channel: string): number {
    return this.handlers.get(channel)?.size ?? 0;
  }
}

let singleton: EventBus | null = null;

/** Process-singleton bus. Sufficient for M1 since publisher + subscriber
 *  run in the same Node process. M4 BroadcastService bridge replaces this
 *  factory with one that fans out across processes. */
export function getEventBus(): EventBus {
  if (!singleton) singleton = new InMemoryEventBus();
  return singleton;
}

/** For tests. Resets the singleton. */
export function resetEventBus(): void {
  singleton = null;
}

// =========================================================================
// Channel constants (typed payloads)
// =========================================================================

export const CHANNEL = {
  CONTRIBUTION_STATE_CHANGED: 'contribution.state_changed',
  DECISION_LOGGED: 'decision.logged',
  COMMENT_INGESTED: 'triage.comment_ingested',
} as const;

export interface ContributionStateChangedPayload {
  contributionId: string;
  projectId: string;
  newState: 'open' | 'claimed' | 'in_progress' | 'review' | 'merged' | 'rejected';
  priorState: 'open' | 'claimed' | 'in_progress' | 'review' | 'merged' | 'rejected' | null;
  observedAt: string;
  /** Origin of the state change for debugging the cutover.
   *  M1: 'polling'; M2: 'endpoint-hook'; M4: 'broadcast-bridge'. */
  source: 'polling' | 'endpoint-hook' | 'broadcast-bridge';
}

export interface DecisionLoggedPayload {
  decisionId: string;
  adrId: string;
  projectId: string;
  category: string;
  traceIds: string[];
  repoCommitSha: string;
}

export interface CommentIngestedPayload {
  commentId: string;
  source: 'github' | 'jira' | 'linear' | 'figma' | 'confluence' | 'notion' | 'manual';
  authorExternal: string;
  text: string;
  /** Free-form context provided by the source-of-comment integration --
   *  filename, parent contribution, frame id, etc. */
  context: Record<string, unknown>;
  ingestedAt: string;
}
