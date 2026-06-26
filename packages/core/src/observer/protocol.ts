/**
 * Wire protocol between the core Node process and the Next.js Principal UI.
 *
 * Hybrid sync model:
 *   - Live ORG STATE (small: agent roster, prompts, aggregate stats) is pushed
 *     in full as an `org` frame on connect and again whenever it changes.
 *   - TASKS and MESSAGES are historical/large: the client loads them via the
 *     paginated HTTP endpoints (`/tasks`, `/messages`) and then receives only
 *     `task` upsert and `message` append deltas over the socket.
 *   - Raw `event` frames continue to stream for the live event log view.
 *
 * Type-only at runtime apart from PROTOCOL_VERSION and the parse/guard helpers,
 * so it is safe to import from a browser bundle via `@xevos/core/protocol`.
 */

import type {
  Agent,
  AgentStatus,
  Department,
  Event,
  EventId,
  Role,
  Task,
  TaskStatus,
} from "../core/schema";

export type {
  Agent,
  AgentEvent,
  AgentId,
  AgentStatus,
  Department,
  Event,
  EventId,
  MemoryWarehouse,
  Review,
  Role,
  Task,
  TaskEvent,
  TaskId,
  TaskPriority,
  TaskStatus,
} from "../core/schema";

/** Bump when the frame shapes below change incompatibly. */
export const PROTOCOL_VERSION = 2 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

export interface PromptsSnapshot {
  roles: Partial<Record<Role, string>>;
  departments: Partial<Record<Department, string>>;
}

/** Aggregate, always-complete view of organization health. */
export interface OrgStats {
  agents: number;
  activeAgents: number;
  activeWorkers: number;
  byRole: Partial<Record<Role, number>>;
  byStatus: Partial<Record<AgentStatus, number>>;
  tasks: number;
  runningTasks: number;
  tasksByStatus: Partial<Record<TaskStatus, number>>;
  /** Pending (unprocessed) items across all inbox queues. */
  queueDepth: number;
}

/** The full live org state — small enough to resend whole on every change. */
export interface OrgState {
  protocolVersion: ProtocolVersion;
  capturedAt: number;
  agents: Agent[];
  prompts: PromptsSnapshot;
  stats: OrgStats;
}

/** A principal <-> agent conversation message, derived from a `message` event. */
export interface Message {
  id: EventId;
  /** events.seq — the pagination cursor (descending). */
  seq: number;
  ts: number;
  from: string;
  to: string;
  /** True when sent by the principal (the UI). */
  outgoing: boolean;
  content: string;
}

/** One page of a descending, cursor-paginated history. */
export interface Page<T> {
  items: T[];
  /** Cursor to pass as `before` for the next (older) page, or null if exhausted. */
  nextCursor: number | null;
}

interface FrameBase {
  v: ProtocolVersion;
  /** Epoch millis the frame was emitted. */
  ts: number;
}

/** Full org state — initial and on every change. */
export interface OrgFrame extends FrameBase {
  kind: "org";
  org: OrgState;
}

/** A task was created or changed; client upserts it by id. */
export interface TaskDeltaFrame extends FrameBase {
  kind: "task";
  task: Task;
}

/** A new conversation message; client appends it. */
export interface MessageDeltaFrame extends FrameBase {
  kind: "message";
  message: Message;
}

/** Raw event for the live event-log view. */
export interface EventFrame extends FrameBase {
  kind: "event";
  seq: number;
  event: Event;
}

/** Anything the server may push to a connected client. */
export type ServerFrame =
  | OrgFrame
  | TaskDeltaFrame
  | MessageDeltaFrame
  | EventFrame;

/** A message the UI sends to the executive over the same WebSocket. */
export interface PrincipalMessageFrame {
  v: ProtocolVersion;
  kind: "principal_message";
  content: string;
}

export type ClientFrame = PrincipalMessageFrame;

export function principalMessageFrame(content: string): PrincipalMessageFrame {
  return { v: PROTOCOL_VERSION, kind: "principal_message", content };
}

/** Numeric sequence encoded in an `event_<n>` id (NaN if malformed). */
export function eventSeq(id: EventId): number {
  return Number(id.slice("event_".length));
}

const SERVER_KINDS = new Set(["org", "task", "message", "event"]);

/** Narrow an untrusted parsed value to a {@link ServerFrame} (envelope only). */
export function isServerFrame(value: unknown): value is ServerFrame {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as Record<string, unknown>;
  return (
    frame.v === PROTOCOL_VERSION &&
    typeof frame.kind === "string" &&
    SERVER_KINDS.has(frame.kind)
  );
}

/** Parse a raw text frame into a typed {@link ServerFrame}, or null if invalid. */
export function parseServerFrame(raw: string): ServerFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isServerFrame(parsed) ? parsed : null;
}

export function isClientFrame(value: unknown): value is ClientFrame {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as Record<string, unknown>;
  return (
    frame.v === PROTOCOL_VERSION &&
    frame.kind === "principal_message" &&
    typeof frame.content === "string"
  );
}

/** Parse a raw text frame into a typed {@link ClientFrame}, or null if invalid. */
export function parseClientFrame(raw: string): ClientFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isClientFrame(parsed) ? parsed : null;
}
