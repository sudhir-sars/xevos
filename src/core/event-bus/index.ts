import type { AgentId } from "../agents";
import type { EventItem } from "./schema";
import type { ServiceId, Xevos } from "./schema/base-event";

export type EventHandler = (event: EventItem) => Promise<void> | void;

type SubscriptionId = AgentId | ServiceId | Xevos;

type Subscriber = {
  id: SubscriptionId;
  handler: EventHandler;
};

export class EventBus {
  private readonly subscribers = new Map<SubscriptionId, Subscriber>();

  public subscribe(id: SubscriptionId, handler: EventHandler): void {
    this.subscribers.set(id, {
      id,
      handler,
    });
  }

  public unsubscribe(id: SubscriptionId): void {
    this.subscribers.delete(id);
  }

  public async publish(event: EventItem): Promise<void> {
    const subscriber = this.subscribers.get(event.target);

    if (!subscriber) return;

    await subscriber.handler(event);
  }
}
