import type { AgentId, Xevos } from "../schema";
import { type EventBus } from "../event-bus";

export class Principal {
  static readonly id: Xevos = "xevos";

  constructor(
    private readonly bus: EventBus,
    private readonly executiveId: AgentId,
  ) {}

  send(content: string): void {
    this.bus.publish({
      source: Principal.id,
      target: this.executiveId,
      topic: "agent",
      type: "message",
      body: { content },
    });
  }

  /** Receive a reply an agent addressed to the principal. */
  receive(from: AgentId, message: string): void {
    console.log(`
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          Message to Principal
          From: ${from}

          ${message}
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
  }
}
