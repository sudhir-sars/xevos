import type { AgentId, EndpointId, Event, EventId, ServiceId } from "../schema";
import type { EventStore } from "./store";

export type { EventStore } from "./store";
export { DrizzleEventStore } from "./store";

type SubscriptionId = AgentId | ServiceId | EndpointId;

export type EventInput = Omit<Event, "id">;

/**
 * Observer invoked for every published event, after it is built and after
 * point-to-point mailbox delivery. Observers are read-only taps: they must not
 * mutate the event or throw (throws are caught and logged, never propagated to
 * the publisher).
 */
export type EventObserver = (event: Event) => void;

interface Slot {
  event: Event;
  /** Inbox row backing this delivery, if durably queued. */
  inboxId?: number;
}

export class Mailbox {
  private readonly queue: Slot[] = [];
  private waiter?: (slot: Slot) => void;
  /**
   * The event most recently handed out and not yet acknowledged. It is acked
   * (its inbox row marked consumed) on the NEXT takeNext — i.e. once the
   * consumer comes back for more work, proving it finished the previous event.
   * This gives at-least-once delivery: a crash mid-handling leaves the event
   * pending, so it is replayed on restart.
   */
  private inFlight?: Slot;

  constructor(private readonly onConsume?: (inboxId: number) => void) {}

  push(event: Event, inboxId?: number): void {
    const slot: Slot = { event, inboxId };

    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = undefined;
      resolve(slot);
      return;
    }

    this.queue.push(slot);
  }

  async takeNext(): Promise<Event> {
    this.ackInFlight();

    const slot = this.queue.shift();

    if (slot) {
      this.inFlight = slot;
      return slot.event;
    }

    if (this.waiter) {
      throw new Error("Mailbox already has a pending consumer");
    }

    return new Promise<Event>((resolve) => {
      this.waiter = (next) => {
        this.inFlight = next;
        resolve(next.event);
      };
    });
  }

  /** Acknowledge the previously delivered event as processed. */
  private ackInFlight(): void {
    if (this.inFlight?.inboxId !== undefined) {
      this.onConsume?.(this.inFlight.inboxId);
    }
    this.inFlight = undefined;
  }

  get size(): number {
    return this.queue.length;
  }
}

export class EventBus {
  private readonly mailboxes = new Map<SubscriptionId, Mailbox>();

  /** Read-only taps notified on every published event (broadcast). */
  private readonly observers = new Set<EventObserver>();

  /** Monotonic publish counter — the source of strictly-increasing event ids. */
  private seq: number;

  /**
   * @param store optional durable backing. When present, every event is written
   *   to the audit log and every targeted event to the durable inbox, and
   *   {@link recover} can replay unprocessed work after a restart. Without it the
   *   bus is purely in-memory (e.g. for isolated tests).
   */
  constructor(private readonly store?: EventStore) {
    this.seq = store?.maxSeq() ?? 0;
  }

  private nextEventId(): EventId {
    return `event_${++this.seq}` as EventId;
  }

  /**
   * Number of events published so far, equal to the latest event's sequence.
   * The observer uses this as the snapshot high-water mark (`throughSeq`).
   */
  get publishedCount(): number {
    return this.seq;
  }

  subscribe(id: SubscriptionId): Mailbox {
    const mailbox = new Mailbox(
      this.store ? (inboxId) => this.store?.markConsumed(inboxId) : undefined,
    );

    this.mailboxes.set(id, mailbox);

    return mailbox;
  }

  unsubscribe(id: SubscriptionId): void {
    this.mailboxes.delete(id);
  }

  /**
   * Register a broadcast tap. The returned disposer removes it. Taps observe
   * every event without affecting point-to-point mailbox delivery.
   */
  tap(observer: EventObserver): () => void {
    this.observers.add(observer);

    return () => {
      this.observers.delete(observer);
    };
  }

  get observerCount(): number {
    return this.observers.size;
  }

  publish<T extends Event>(event: Omit<T, "id">): EventId {
    const envelope: T = {
      ...event,
      id: this.nextEventId(),
    } as T;

    // Durable audit log: every event, even fire-and-forget observations.
    this.store?.append(this.seq, envelope);

    // Point-to-point delivery. When there is a subscriber AND a store, the
    // event is durably queued first so a crash before it is processed is
    // recoverable; the inbox id rides along so the mailbox can ack it.
    const mailbox = this.mailboxes.get(envelope.target);
    if (mailbox) {
      const inboxId = this.store?.enqueue(envelope.target, envelope);
      mailbox.push(envelope, inboxId);
    }

    // Broadcast to taps. A misbehaving observer must never break delivery
    // or the publisher, so failures are isolated and logged.
    for (const observer of this.observers) {
      try {
        observer(envelope);
      } catch (err) {
        console.error("[event-bus] observer threw:", err);
      }
    }

    return envelope.id;
  }

  /**
   * Replay durably-queued work that was never processed (e.g. left in flight by
   * a crash). Call AFTER subscribers are registered so deliveries land in live
   * mailboxes; events whose target is not subscribed are left pending.
   */
  recover(): number {
    if (!this.store) return 0;

    let replayed = 0;
    for (const { target, event, inboxId } of this.store.loadPending()) {
      const mailbox = this.mailboxes.get(target as SubscriptionId);
      if (mailbox) {
        mailbox.push(event, inboxId);
        replayed++;
      }
    }

    if (replayed > 0) {
      console.log(`[event-bus] recovered ${replayed} pending event(s)`);
    }

    return replayed;
  }

  getMailbox(id: SubscriptionId): Mailbox {
    const mailbox = this.mailboxes.get(id);

    if (!mailbox) {
      throw new Error(`Mailbox not found for ${id}`);
    }

    return mailbox;
  }

  hasSubscriber(id: SubscriptionId): boolean {
    return this.mailboxes.has(id);
  }

  get subscriberCount(): number {
    return this.mailboxes.size;
  }
}
