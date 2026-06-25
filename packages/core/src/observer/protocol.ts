/**
 * Wire protocol between the core Node process (EventBus tap -> WebSocket) and
 * the Next.js Principal UI.
 *
 * Versioned and typed. Domain payloads reuse the existing core schema types so
 * the web app stays in lock-step with the backend. This module is type-only at
 * runtime apart from {@link PROTOCOL_VERSION} and the small parse/guard
 * helpers, so it is safe to import (type-only) from a browser bundle via the
 * `@xevos/core/protocol` export.
 */

import type {
  Agent,
  Department,
  Event,
  EventId,
  MemoryWarehouse,
  Role,
  Task,
} from "../core/schema";

// Re-export the domain types the UI needs so the web app has a single,
// dependency-light import surface: `@xevos/core/protocol`.
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
export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

export interface PromptsSnapshot {
  roles: Partial<Record<Role, string>>;
  departments: Partial<Record<Department, string>>;
}

/**
 * Full state captured from the SQLite-backed stores at connect time. The web app
 * seeds its state from this, then folds in subsequent {@link EventFrame}s.
 */
export interface Snapshot {
  protocolVersion: ProtocolVersion;
  /** Epoch millis the snapshot was captured. */
  capturedAt: number;
  /**
   * Highest event sequence number reflected in this snapshot. Event frames with
   * a sequence at or below this were already folded into the stores, so the
   * client can safely ignore them as duplicates.
   */
  throughSeq: number;
  agents: Agent[];
  tasks: Task[];
  prompts: PromptsSnapshot;
  memoryWarehouse: MemoryWarehouse[];
}

interface FrameBase {
  v: ProtocolVersion;
  /** Monotonic per-connection frame counter. */
  seq: number;
  /** Epoch millis the frame was emitted. */
  ts: number;
}

export interface SnapshotFrame extends FrameBase {
  kind: "snapshot";
  data: Snapshot;
}

export interface EventFrame extends FrameBase {
  kind: "event";
  event: Event;
}

/** Anything the server may push to a connected client. */
export type ServerFrame = SnapshotFrame | EventFrame;

/** A message the UI sends to the executive over the same WebSocket. */
export interface PrincipalMessageFrame {
  v: ProtocolVersion;
  kind: "principal_message";
  content: string;
}

/** Anything a client may push to the server. */
export type ClientFrame = PrincipalMessageFrame;

export function principalMessageFrame(content: string): PrincipalMessageFrame {
  return { v: PROTOCOL_VERSION, kind: "principal_message", content };
}

/** Numeric sequence encoded in an `event_<n>` id (NaN if malformed). */
export function eventSeq(id: EventId): number {
  return Number(id.slice("event_".length));
}

/**
 * Narrow an untrusted parsed value to a {@link ServerFrame}. Validates only the
 * envelope (version + discriminant), not the full domain payload — payloads are
 * produced by the trusted core process.
 */
export function isServerFrame(value: unknown): value is ServerFrame {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const frame = value as Record<string, unknown>;

  if (frame.v !== PROTOCOL_VERSION) {
    return false;
  }

  if (typeof frame.seq !== "number" || typeof frame.ts !== "number") {
    return false;
  }

  if (frame.kind === "snapshot") {
    return typeof frame.data === "object" && frame.data !== null;
  }

  if (frame.kind === "event") {
    return typeof frame.event === "object" && frame.event !== null;
  }

  return false;
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
  if (typeof value !== "object" || value === null) {
    return false;
  }

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
