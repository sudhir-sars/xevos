import type { Tool } from "ai";
import { z } from "zod";

import type { EventBus } from "../../event-bus";
import type { Agent, AgentId, Event } from "../../schema";
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

export interface ToolContext {
  readonly agent: Agent;
  readonly bus: EventBus;
  readonly memory: MemoryService;
  readonly tasks: TaskRepository;
  readonly agents: AgentRepository;
  readonly principalSink: PrincipalSink;
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
