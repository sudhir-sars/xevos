import { AgentEvent } from "./agent";
import { TaskEvent } from "./task";
export * from "./agent";
export * from "./base-event";
export * from "./task";

export type Event = AgentEvent | TaskEvent;

export type EventRes<T> = Omit<T, "id" | "source">;
