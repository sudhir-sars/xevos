import { AgentId } from "../agent.schema";

export type EventId = `event_${number}`;
export type ServiceId = `service_${string}`;
export type principleId = `principal`;

export interface BaseEvent {
  id: EventId;
  source: AgentId | ServiceId | principleId;
  target: AgentId | ServiceId | principleId;
  correlationId?: EventId;
}
