import type { AgentId } from "../../agents/schema/agent.schema";

export type EventId = `event_${number}`;
export type ServiceId = `service_${string}`;
export type Xevos = `xevos`;

export interface BaseEvent {
  id: EventId;
  source: AgentId | ServiceId | Xevos;
  target: AgentId | ServiceId | Xevos;
  correlationId?: EventId;
}
