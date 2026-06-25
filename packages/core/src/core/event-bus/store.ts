import { asc, eq, sql } from "drizzle-orm";

import type { Event } from "../schema";
import { getDb, type DB } from "../../db/client";
import { events, inbox } from "../../db/schema";

export interface PendingDelivery {
  target: string;
  event: Event;
  inboxId: number;
}

/**
 * Durable backing for the EventBus: an append-only `events` audit log and a
 * per-recipient `inbox` work queue. Synchronous (better-sqlite3), so the bus's
 * `publish` stays synchronous.
 */
export interface EventStore {
  /** Highest event sequence persisted, so ids stay monotonic across restarts. */
  maxSeq(): number;
  /** Append an event to the durable log. `seq` is the numeric part of its id. */
  append(seq: number, event: Event): void;
  /** Durably queue a targeted event; returns the inbox row id. */
  enqueue(target: string, event: Event): number;
  /** Mark an inbox row processed. */
  markConsumed(inboxId: number): void;
  /** Pending (unconsumed) deliveries, oldest first — for crash recovery. */
  loadPending(): PendingDelivery[];
}

function bodyOf(event: Event): unknown {
  return (event as { body?: unknown }).body ?? null;
}

function correlationOf(event: Event): string | null {
  return (event as { correlationId?: string }).correlationId ?? null;
}

export class DrizzleEventStore implements EventStore {
  constructor(private readonly db: DB = getDb()) {}

  maxSeq(): number {
    const row = this.db
      .select({ max: sql<number | null>`max(${events.seq})` })
      .from(events)
      .get();
    return row?.max ?? 0;
  }

  append(seq: number, event: Event): void {
    this.db
      .insert(events)
      .values({
        seq,
        source: event.source,
        target: event.target,
        topic: event.topic,
        type: event.type,
        body: bodyOf(event),
        correlationId: correlationOf(event),
      })
      .run();
  }

  enqueue(target: string, event: Event): number {
    const row = this.db
      .insert(inbox)
      .values({ target, event, status: "pending", createdAt: Date.now() })
      .returning({ id: inbox.id })
      .get();
    return row.id;
  }

  markConsumed(inboxId: number): void {
    this.db
      .update(inbox)
      .set({ status: "consumed" })
      .where(eq(inbox.id, inboxId))
      .run();
  }

  loadPending(): PendingDelivery[] {
    return this.db
      .select()
      .from(inbox)
      .where(eq(inbox.status, "pending"))
      .orderBy(asc(inbox.id))
      .all()
      .map((row) => ({
        target: row.target,
        event: row.event as Event,
        inboxId: row.id,
      }));
  }
}
