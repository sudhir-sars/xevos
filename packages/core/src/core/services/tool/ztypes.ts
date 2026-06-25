import type { Tool } from "ai";
import { z } from "zod";

import type { EventBus } from "../../event-bus";
import type { Agent, AgentId, Event } from "../../schema";
import type { TaskRepository } from "../../../repositories";
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

export function publish<T extends Event>(
  bus: EventBus,
  event: Omit<T, "id">,
): ToolResult {
  const eventId = bus.publish<T>(event);

  return {
    success: true,
    result: {
      eventId,
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
