import type { AgentId } from "../agent.schema";
import type { BaseEvent } from "./base-event";

/**
 * Emitted when a TRIVIAL tool runs directly (no request/response round-trip on
 * the bus). The effect has already been applied in the handler; this event
 * exists purely for accountability and transparency — it is addressed to the
 * observer sink (no agent or service consumes it for routing), so it shows up
 * for every bus tap (the observer UI) without waking anyone.
 */
export interface ToolObservationEvent extends BaseEvent {
  topic: "observation";
  type: "tool_executed";

  body: {
    agentId: AgentId;
    tool: string;
    rationale: string | null;
    ok: boolean;
    detail: string;
  };
}

export type ObservationEvent = ToolObservationEvent;
