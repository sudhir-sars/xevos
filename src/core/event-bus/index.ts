import type { AgentId, Event, ServiceId } from "../schema";
import { Xevos } from "../schema";

export type EventHandler = (event: Event) => Promise<void> | void;
type SubscriptionId = AgentId | ServiceId | Xevos;

export class Mailbox {
  private readonly queue: Event[] = [];
  private waiter?: (event: Event) => void;

  push(event: Event): void {
    if (this.waiter) {
      this.waiter(event);
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

  subscribe(id: SubscriptionId): Mailbox {
    const mailbox = new Mailbox();

    this.mailboxes.set(id, mailbox);

    return mailbox;
  }

  unsubscribe(id: SubscriptionId): void {
    this.mailboxes.delete(id);
  }

  publish(event: Event): void {
    this.mailboxes.get(event.target)?.push(event);
  }

  getMailbox(id: SubscriptionId): Mailbox {
    const mailbox = this.mailboxes.get(id);

    if (!mailbox) {
      throw new Error(`Mailbox not found for ${id}`);
    }

    return mailbox;
  }
}
