import type { AgentId, EventId, PrincipalId } from "../schema";
import { type EventBus } from "../event-bus";

export class Principal {
  static readonly id: PrincipalId = "principal";

  constructor(
    private readonly bus: EventBus,
    private readonly executiveId: AgentId,
  ) {}

  /** Send a message to the executive agent. Returns the published event id. */
  send(content: string): EventId {
    return this.bus.publish({
      source: Principal.id,
      target: this.executiveId,
      topic: "agent",
      type: "message",
      body: { content },
    });
  }

  /**
   * Receive a reply an agent addressed to the principal. The reply arrives via
   * the `respond_to_principal` tool (out-of-band of the bus), so we echo it
   * back onto the bus — targeted at the principal, which has no mailbox, so it
   * is delivered only to observers — making it visible to the Principal UI.
   */
  receive(from: AgentId, message: string): void {
    console.log(`[principal] ⇐ ${from}\n${message}\n`);

    this.bus.publish({
      source: from,
      target: Principal.id,
      topic: "agent",
      type: "message",
      body: { content: message },
    });
  }
}
