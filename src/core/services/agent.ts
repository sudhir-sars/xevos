// services/runtime.service.ts

import { AgentId } from "../schema";
import { BaseAgent } from "../agents";
import { AgentRepository } from "../../repositories";
import { EventBus } from "../event-bus";
import { MemoryService } from "./memory";
import { PromptService } from "./prompt";
import { ToolRegistry } from "../agents";

export class AgentService {
  private readonly agents = new Map<AgentId, BaseAgent>();

  constructor(
    private readonly agentRepository: AgentRepository,
    private readonly bus: EventBus,
    private readonly memory: MemoryService,
    private readonly tools: ToolRegistry,
    private readonly prompts: PromptService,
  ) {}

  start(): void {
    const agents = this.agentRepository.list();

    for (const config of agents) {
      if (config.status !== "active") {
        continue;
      }

      const agent = new BaseAgent(
        config,
        this.bus,
        this.memory,
        this.tools,
        this.prompts,
      );

      agent.start();
      this.agents.set(config.id, agent);
    }
  }

  stop(): void {
    for (const agent of this.agents.values()) {
      agent.stop();
    }
    this.agents.clear();
  }

  getAgent(id: AgentId): BaseAgent {
    const agent = this.agents.get(id);

    if (!agent) {
      throw new Error(`Agent "${id}" not running`);
    }

    return agent;
  }

  isRunning(id: AgentId): boolean {
    return this.agents.has(id);
  }
}
