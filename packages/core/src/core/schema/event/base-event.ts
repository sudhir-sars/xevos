import { AgentId, PrincipalId } from "../agent.schema";

export type EventId = `event_${number}`;
export type ServiceId = `service_${string}`;

/** Any addressable participant on the bus. */
export type EndpointId = AgentId | ServiceId | PrincipalId;

export interface BaseEvent {
  id: EventId;
  source: EndpointId;
  target: EndpointId;
  correlationId?: EventId;
}
