import type { AgentId, EndpointId, Event, EventId, ServiceId } from "../schema";

type SubscriptionId = AgentId | ServiceId | EndpointId;

export type EventInput = Omit<Event, "id">;

/**
 * Observer invoked for every published event, after it is built and after
 * point-to-point mailbox delivery. Observers are read-only taps: they must not
 * mutate the event or throw (throws are caught and logged, never propagated to
 * the publisher).
 */
export type EventObserver = (event: Event) => void;

export class Mailbox {
  private readonly queue: Event[] = [];
  private waiter?: (event: Event) => void;

  push(event: Event): void {
    if (this.waiter) {
      const resolve = this.waiter;

      this.waiter = undefined;
      resolve(event);

      return;
    }

    this.queue.push(event);
  }

  async takeNext(): Promise<Event> {
    const event = this.queue.shift();

    if (event) {
      return event;
    }

    if (this.waiter) {
      throw new Error("Mailbox already has a pending consumer");
    }

    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  get size(): number {
    return this.queue.length;
  }
}

export class EventBus {
  private readonly mailboxes = new Map<SubscriptionId, Mailbox>();

  /** Read-only taps notified on every published event (broadcast). */
  private readonly observers = new Set<EventObserver>();

  private nextEventId(): EventId {
    return `event_${Date.now()}` as EventId;
  }

  subscribe(id: SubscriptionId): Mailbox {
    const mailbox = new Mailbox();

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

    // Point-to-point delivery (unchanged).
    this.mailboxes.get(envelope.target)?.push(envelope);

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
