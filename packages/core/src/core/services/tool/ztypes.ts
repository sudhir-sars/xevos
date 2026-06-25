import type { Tool } from "ai";
import { z } from "zod";

import type { EventBus } from "../../event-bus";
import type {
  Agent,
  AgentSpawn,
  AgentId,
  Event,
  ServiceId,
  TaskCreate,
  TaskId,
  TaskStatus,
  ToolObservationEvent,
} from "../../schema";
import type { AgentRepository, TaskRepository } from "../../../repositories";
import type { MemoryService } from "../memory";

export type ToolResult =
  | {
      success: true;
      result?: unknown;
    }
  | {
      success: false;
      error: string;
    };

export type PrincipalSink = (from: AgentId, message: string) => void;

/**
 * Synchronous, in-process org operations a TRIVIAL tool invokes DIRECTLY instead
 * of round-tripping a request/response through the bus. They own the same
 * validation and lifecycle the services do (createAgent also launches the new
 * agent before returning, so the creator can message it immediately with no
 * race) — they just hand the real result straight back to the caller.
 */
export interface OrgOps {
  createAgent(
    creatorId: AgentId,
    spec: AgentSpawn,
  ): Promise<{
    approved: boolean;
    agentId: AgentId | null;
    reason: string | null;
  }>;

  createTask(
    source: AgentId,
    spec: TaskCreate,
  ): Promise<{ taskId: TaskId | null; created: boolean; reason: string | null }>;

  transitionTask(
    source: AgentId,
    taskId: TaskId,
    to: TaskStatus,
    note: string | null,
  ): Promise<{ transitioned: boolean; reason: string | null }>;
}

export interface ToolContext {
  readonly agent: Agent;
  readonly bus: EventBus;
  readonly memory: MemoryService;
  readonly tasks: TaskRepository;
  readonly agents: AgentRepository;
  readonly principalSink: PrincipalSink;
  /** Direct org operations for trivial tools. Absent on the onError path. */
  readonly org?: OrgOps;
}

/**
 * The observer sink: a service id nobody subscribes to. Events addressed here
 * route to no mailbox, but every bus tap (the observer UI) still sees them —
 * exactly what we want for fire-and-forget transparency.
 */
export const OBSERVER_ID = "observer_service" as ServiceId;

/** Clip helper so a noisy result (e.g. apt-get logs) can't bloat the event. */
function clipDetail(value: unknown): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  text = text ?? "";
  return text.length > 800 ? `${text.slice(0, 800)}…` : text;
}

/**
 * Publish a fire-and-forget observation that a trivial tool ran. The effect is
 * already applied; this is purely the audit trail. Addressed to OBSERVER_ID so
 * it routes nowhere yet is visible to every tap.
 */
export function observe(
  bus: EventBus,
  agent: Agent,
  tool: string,
  input: unknown,
  result: ToolResult,
): void {
  const rationale =
    input && typeof input === "object" && "rationale" in input
      ? String((input as { rationale: unknown }).rationale)
      : null;

  bus.publish<ToolObservationEvent>({
    source: agent.id,
    target: OBSERVER_ID,
    topic: "observation",
    type: "tool_executed",
    body: {
      agentId: agent.id,
      tool,
      rationale,
      ok: result.success,
      detail: clipDetail(result.success ? result.result : result.error),
    },
  });
}

export type ToolHandler<TInput = unknown> = (
  ctx: ToolContext,
  input: TInput,
) => ToolResult | Promise<ToolResult>;

export interface ToolDefinition<
  TName extends string = string,
  TInput = unknown,
> {
  readonly name: TName;
  readonly tool: Tool;
  readonly handler: ToolHandler<TInput>;
  /**
   * TRIVIAL tools: the handler applies its effect directly and returns the real
   * result (no bus round-trip). The tool layer emits an observation event after
   * each such call for transparency. Non-trivial tools (which publish a targeted
   * command to the bus) leave this falsy.
   */
  readonly direct?: boolean;
}

export function defineTool<const TName extends string, TInput = unknown>(
  definition: ToolDefinition<TName, TInput>,
): ToolDefinition<TName, TInput> {
  return definition;
}

/**
 * Publish a command onto the event bus and return an ACKNOWLEDGEMENT — not a
 * result. The bus is asynchronous: the real outcome (a taskId, an agentId, an
 * answer) arrives later as a separate event addressed back to the caller. The
 * returned `eventId` is the correlation handle that response will carry as its
 * `correlationId`.
 *
 * @param awaiting the `type` of the response event the caller should expect, or
 *   `null`/omitted for fire-and-forget commands that get no direct reply.
 */
export function publish<T extends Event>(
  bus: EventBus,
  event: Omit<T, "id">,
  awaiting?: string | null,
): ToolResult {
  const eventId = bus.publish<T>(event);

  const note = awaiting
    ? `Acknowledged — your command was published to the event bus. This is NOT the result. The outcome will arrive later as a separate "${awaiting}" event addressed to you, carrying correlationId "${eventId}". Do not invent or act on any id (taskId, agentId, …) until that event arrives — if you have nothing else to do, call wait_until_response.`
    : `Acknowledged — your command was published to the event bus. No direct reply is expected for this; you will learn the outcome through later events. Continue with other work or call wait_until_response.`;

  return {
    success: true,
    result: {
      status: "accepted",
      eventId,
      awaiting: awaiting ?? null,
      note,
    },
  };
}

export const rationale = z
  .string()
  .describe("Why you are taking this action. Recorded on the event for audit.");

export const agentId = z
  .string()
  .describe("target agent id, e.g. <role>_<department>_<number>");

export const taskId = z.string().describe("task id, e.g. task_<number>");
