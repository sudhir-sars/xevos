import type { ToolCallPart } from "ai";

import type { EventBus } from "../../event-bus";
import type { Agent } from "../../schema";
import type { TaskRepository } from "../../../repositories";
import type { DockerSandbox } from "../../sandbox";
import type { MemoryService } from "../memory";

import { createDefinitionMap, ToolName } from "./definitions";

import type { PrincipalSink, ToolContext, ToolResult } from "./ztypes";

export class ToolExecutor {
  constructor(
    private readonly bus: EventBus,
    private readonly memory: MemoryService,
    private readonly tasks: TaskRepository,
    private readonly principalSink: PrincipalSink,
  ) {}

  async execute(
    agent: Agent,
    toolCall: ToolCallPart,
    sandbox?: DockerSandbox,
  ): Promise<ToolResult> {
    const definition =
      createDefinitionMap(sandbox)[toolCall.toolName as ToolName];

    if (!definition) {
      return {
        success: false,
        error: `Unknown tool: ${toolCall.toolName}`,
      };
    }

    const ctx: ToolContext = {
      agent,
      bus: this.bus,
      memory: this.memory,
      tasks: this.tasks,
      principalSink: this.principalSink,
    };

    try {
      return await definition.handler(ctx, toolCall.input as any);
    } catch (error) {
      console.error(`[ToolExecutor] Tool "${toolCall.toolName}" failed`, error);

      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown tool execution error",
      };
    }
  }
}
