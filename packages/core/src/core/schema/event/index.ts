import { AgentEvent } from "./agent";
import { TaskEvent } from "./task";
import { ObservationEvent } from "./observation";
import { PlatformEvent } from "./platform";
export * from "./agent";
export * from "./base-event";
export * from "./task";
export * from "./observation";
export * from "./platform";

export type Event = AgentEvent | TaskEvent | ObservationEvent | PlatformEvent;

export type EventRes<T> = Omit<T, "id" | "source">;
