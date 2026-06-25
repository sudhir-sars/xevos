import type { ToolCallPart, ToolSet } from "ai";

import { type EventBus } from "../../event-bus";
import type { Agent, AgentId, ServiceId } from "../../schema";
import type { TaskRepository } from "../../../repositories";
import type { DockerSandbox } from "../../sandbox";
import type { MemoryService } from "../memory";

import { ToolRegistry } from "./registry";
import { ToolExecutor } from "./executor";
import type { PrincipalSink, ToolResult } from "./ztypes";

export const TOOL_SERVICE_ID: ServiceId = "service_tool";

export class ToolService {
  private readonly registry = new ToolRegistry();
  private readonly executor: ToolExecutor;

  constructor(
    bus: EventBus,
    memory: MemoryService,
    tasks: TaskRepository,
    principalSink: PrincipalSink = defaultPrincipalSink,
  ) {
    this.executor = new ToolExecutor(bus, memory, tasks, principalSink);
  }

  getTools(agent: Agent, sandbox?: DockerSandbox): ToolSet {
    return this.registry.getTools(agent, sandbox);
  }

  execute(agent: Agent, toolCall: ToolCallPart): Promise<ToolResult> {
    return this.executor.execute(agent, toolCall);
  }
}

function defaultPrincipalSink(from: AgentId, message: string): void {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Message to Principal
From: ${from}

${message}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}
