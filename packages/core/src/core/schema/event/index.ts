import { AgentEvent } from "./agent";
import { TaskEvent } from "./task";
import { ObservationEvent } from "./observation";
export * from "./agent";
export * from "./base-event";
export * from "./task";
export * from "./observation";

export type Event = AgentEvent | TaskEvent | ObservationEvent;
export type EventRes<T> = Omit<T, "id" | "source">;
