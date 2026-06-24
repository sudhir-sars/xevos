import type { AgentId, Event, EventId, ServiceId } from "../schema";
import { Xevos } from "../schema";

type SubscriptionId = AgentId | ServiceId | Xevos;

export type EventInput = Omit<Event, "id">;

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

  private eventCounter = 0;

  private nextEventId(): EventId {
    return `event_${++this.eventCounter}` as EventId;
  }

  subscribe(id: SubscriptionId): Mailbox {
    const mailbox = new Mailbox();

    this.mailboxes.set(id, mailbox);

    return mailbox;
  }

  unsubscribe(id: SubscriptionId): void {
    this.mailboxes.delete(id);
  }

  publish<T extends Event>(event: Omit<T, "id">): EventId {
    const envelope: T = {
      ...event,
      id: this.nextEventId(),
    } as T;

    this.mailboxes.get(envelope.target)?.push(envelope);

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
