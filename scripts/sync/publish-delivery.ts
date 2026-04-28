#!/usr/bin/env -S npx tsx
//
// publish-delivery: contribution state -> external delivery tracker.
//
// Trigger model per scripts/README.md:
//   M1: polling source. This file IS the source. It polls contributions for
//       state changes and publishes `contribution.state_changed` to the
//       in-memory event bus. The subscriber (also in this file) consumes
//       and dispatches to the configured delivery adapter.
//   M2: endpoint post-commit hook publishes to the same bus; this polling
//       source remains as a 5-minute safety-net catch-up.
//   M4: BroadcastService bridge replaces the polling source entirely.
//
// The subscriber code does not change across milestones; only the source
// of events does. That is what makes the cutover one-line.
//
// CLI:
//   publish-delivery --once                  Run a single poll cycle then exit
//   publish-delivery --interval 60           Poll every N seconds (default 60)
//   publish-delivery --adapter noop          Adapter name (default from env / noop)
//   publish-delivery --since <iso>           Override the cursor (default: file)
//   publish-delivery --dry-run               Skip writes (cursor + telemetry)

import { Client } from 'pg';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import {
  CHANNEL,
  type ContributionStateChangedPayload,
  type EventBus,
  getEventBus,
} from './lib/event-bus.ts';
import { resolveDeliveryAdapter, type DeliveryAdapter } from './lib/adapters.ts';

interface Args {
  once: boolean;
  interval: number;
  adapter: string;
  since: string | null;
  dryRun: boolean;
}

const CURSOR_PATH = '.atelier/state/publish-delivery-cursor.json';
const STATES_OF_INTEREST = ['claimed', 'in_progress', 'review', 'merged', 'rejected'] as const;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    once: false,
    interval: 60,
    adapter: process.env.ATELIER_DELIVERY_ADAPTER ?? 'noop',
    since: null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--once') args.once = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--interval') args.interval = Number(argv[++i]);
    else if (a === '--adapter') args.adapter = argv[++i]!;
    else if (a === '--since') args.since = argv[++i]!;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: publish-delivery [--once] [--interval N] [--adapter NAME] [--since ISO] [--dry-run]');
      process.exit(0);
    }
  }
  return args;
}

async function readCursor(): Promise<Date> {
  try {
    const raw = await fs.readFile(CURSOR_PATH, 'utf8');
    const { lastRunAt } = JSON.parse(raw) as { lastRunAt: string };
    return new Date(lastRunAt);
  } catch {
    // Default to 5 minutes ago (the M2 catch-up window per scripts/README.md).
    return new Date(Date.now() - 5 * 60 * 1000);
  }
}

async function writeCursor(cursor: Date): Promise<void> {
  await fs.mkdir(dirname(CURSOR_PATH), { recursive: true });
  await fs.writeFile(CURSOR_PATH, JSON.stringify({ lastRunAt: cursor.toISOString() }, null, 2) + '\n');
}

interface ContributionRow {
  id: string;
  project_id: string;
  state: ContributionStateChangedPayload['newState'];
  kind: 'implementation' | 'research' | 'design';
  trace_ids: string[];
  updated_at: Date;
  content_ref: string;
}

async function pollOnce(opts: { db: Client; bus: EventBus; since: Date; dryRun: boolean }): Promise<{ detected: number; cursor: Date }> {
  const { db, bus, since, dryRun } = opts;
  const { rows } = await db.query<ContributionRow>(
    `SELECT id, project_id, state, kind, trace_ids, updated_at, content_ref
       FROM contributions
      WHERE updated_at > $1
        AND state = ANY($2::contribution_state[])
      ORDER BY updated_at ASC`,
    [since.toISOString(), STATES_OF_INTEREST],
  );

  for (const row of rows) {
    const payload: ContributionStateChangedPayload = {
      contributionId: row.id,
      projectId: row.project_id,
      newState: row.state,
      priorState: null, // M1: cursor-based polling cannot see prior state. Endpoint hook (M2) carries it.
      observedAt: row.updated_at.toISOString(),
      source: 'polling',
    };
    await bus.publish(CHANNEL.CONTRIBUTION_STATE_CHANGED, payload);
  }

  // Cursor advances to the latest observed updated_at (or now if no rows --
  // prevents the cursor from rewinding when there are no changes).
  const newCursor = rows.length > 0 ? rows[rows.length - 1]!.updated_at : new Date();
  if (!dryRun) await writeCursor(newCursor);
  return { detected: rows.length, cursor: newCursor };
}

function registerSubscriber(bus: EventBus, db: Client, adapter: DeliveryAdapter, dryRun: boolean): void {
  bus.subscribe<ContributionStateChangedPayload>(CHANNEL.CONTRIBUTION_STATE_CHANGED, async (envelope) => {
    const { contributionId, projectId } = envelope.payload;

    // Re-fetch fresh contribution row (cursor-based events may have stale state
    // by the time the subscriber processes them; freshness matters for the
    // delivery upsert).
    const { rows } = await db.query<ContributionRow & { summary: string | null }>(
      `SELECT id, project_id, state, kind, trace_ids, updated_at, content_ref,
              NULL::text AS summary
         FROM contributions WHERE id = $1`,
      [contributionId],
    );
    const row = rows[0];
    if (!row) return;

    try {
      const result = await adapter.upsertIssue({
        contributionId: row.id,
        projectId: row.project_id,
        kind: row.kind,
        state: row.state,
        traceIds: row.trace_ids,
        summary: `Atelier ${row.kind}: ${row.trace_ids.join(', ')}`,
        bodyMarkdown: `Contribution ${row.id} (state=${row.state})\nContent ref: ${row.content_ref}`,
      });

      if (!dryRun) {
        await db.query(
          `INSERT INTO telemetry (project_id, action, outcome, metadata)
           VALUES ($1, 'delivery.synced', 'ok', $2::jsonb)`,
          [
            projectId,
            JSON.stringify({
              contributionId,
              adapter: adapter.name,
              externalId: result.externalId,
              externalUrl: result.externalUrl,
              source: envelope.payload.source,
            }),
          ],
        );
      }
    } catch (err) {
      // Sync failures must surface in observability per ARCH 8.2 but do not
      // block subsequent contributions per scripts/README.md.
      if (!dryRun) {
        await db.query(
          `INSERT INTO telemetry (project_id, action, outcome, metadata)
           VALUES ($1, 'delivery.sync_failed', 'error', $2::jsonb)`,
          [projectId, JSON.stringify({ contributionId, adapter: adapter.name, error: String(err) })],
        ).catch(() => {});
      }
      // eslint-disable-next-line no-console
      console.error(`[publish-delivery] adapter ${adapter.name} failed for ${contributionId}:`, err);
    }
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

  const db = new Client({ connectionString: dbUrl });
  await db.connect();

  const bus = getEventBus();
  const adapter = resolveDeliveryAdapter(args.adapter);
  registerSubscriber(bus, db, adapter, args.dryRun);

  const runCycle = async (): Promise<void> => {
    const cursor = args.since ? new Date(args.since) : await readCursor();
    const result = await pollOnce({ db, bus, since: cursor, dryRun: args.dryRun });
    await bus.drain();
    // eslint-disable-next-line no-console
    console.log(
      `[publish-delivery] cursor=${cursor.toISOString()} -> ${result.cursor.toISOString()} detected=${result.detected} adapter=${adapter.name}${args.dryRun ? ' (dry-run)' : ''}`,
    );
  };

  if (args.once) {
    await runCycle();
    await db.end();
    return;
  }

  await runCycle();
  setInterval(() => {
    runCycle().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[publish-delivery] cycle failed:', err);
    });
  }, args.interval * 1000);
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain || process.argv[1]?.endsWith('publish-delivery.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { pollOnce, registerSubscriber, parseArgs };
