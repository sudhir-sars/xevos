import type { ToolCallPart, ToolSet } from "ai";

import { type EventBus } from "../../event-bus";
import type { Agent, AgentId, ServiceId } from "../../schema";
import type { AgentRepository, TaskRepository } from "../../../repositories";
import type { DockerSandbox } from "../../sandbox";
import type { MemoryService } from "../memory";

import { ToolRegistry } from "./registry";
import { ToolExecutor } from "./executor";
import {
  observe,
  type OrgOps,
  type PrincipalSink,
  type ToolContext,
  type ToolResult,
} from "./ztypes";

export const TOOL_SERVICE_ID: ServiceId = "tool_service";

export class ToolService {
  private readonly registry = new ToolRegistry();
  private readonly executor: ToolExecutor;

  /**
   * Direct, in-process org operations the TRIVIAL tools call instead of
   * round-tripping the bus. Bound after construction (the services that back it
   * depend on this ToolService, so the wiring is necessarily two-phase).
   */
  private org?: OrgOps;

  constructor(
    private readonly bus: EventBus,
    private readonly memory: MemoryService,
    private readonly tasks: TaskRepository,
    private readonly agents: AgentRepository,
    private readonly principalSink: PrincipalSink = defaultPrincipalSink,
  ) {
    this.executor = new ToolExecutor(bus, memory, tasks, agents, principalSink);
  }

  /** Wire the direct org operations once the backing services exist. */
  setOrgOps(org: OrgOps): void {
    this.org = org;
  }

  /**
   * Build the agent's granted tools as ready-to-run ai-SDK tools: each tool's
   * `execute` is its handler bound to *this* agent's context. generateText then
   * runs the effect (publish a coordination event, drive the sandbox) inside its
   * own loop — there is no separate dispatch/executor round-trip for the model's
   * own tool calls.
   */
  getTools(agent: Agent, sandbox?: DockerSandbox): ToolSet {
    const ctx: ToolContext = {
      agent,
      bus: this.bus,
      memory: this.memory,
      tasks: this.tasks,
      agents: this.agents,
      principalSink: this.principalSink,
      org: this.org,
    };

    const tools: ToolSet = {};

    for (const def of this.registry.resolve(agent, sandbox)) {
      tools[def.name] = {
        ...def.tool,
        execute: async (input: unknown) => {
          const result = await def.handler(ctx, input as any);

          // TRIVIAL tools applied their effect directly (no bus round-trip) —
          // emit a fire-and-forget observation so the action is still visible
          // on the bus for accountability and transparency.
          if (def.direct) {
            observe(this.bus, agent, def.name, input, result);
          }

          return result;
        },
      } as ToolSet[string];
    }

    return tools;
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
