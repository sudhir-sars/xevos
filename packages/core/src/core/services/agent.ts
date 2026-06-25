// services/agent.service.ts

import { BaseAgent } from "../agents";

import type {
  Agent,
  AgentCreationRequestEvent,
  AgentCreationResponseEvent,
  AgentId,
  AgentResumeRequestEvent,
  AgentResumeResponseEvent,
  AgentSuspensionRequestEvent,
  AgentSuspensionResponseEvent,
  AgentTerminationRequestEvent,
  AgentTerminationResponseEvent,
  Department,
  Event,
  EventRes,
  Role,
  ServiceId,
} from "../schema";

import type { AgentRepository, TaskRepository } from "../../repositories";

import { type EventBus, type Mailbox } from "../event-bus";

import type { MemoryService } from "./memory";
import type { PromptService } from "./prompt";
import type { ToolService } from "./tool";

import { toolNamesFor } from "./tool";

export const AGENT_SERVICE_ID: ServiceId = "service_agent";

const SUBORDINATE_ROLE: Record<Role, Role | null> = {
  executive: "head",
  head: "manager",
  manager: "worker",
  worker: null,
};

export class AgentService {
  private readonly agents = new Map<AgentId, BaseAgent>();

  private running = false;

  private readonly mailbox: Mailbox;

  constructor(
    private readonly agentRepository: AgentRepository,
    private readonly taskRepository: TaskRepository,
    private readonly bus: EventBus,
    private readonly memory: MemoryService,
    private readonly tools: ToolService,
    private readonly prompts: PromptService,
  ) {
    this.mailbox = bus.subscribe(AGENT_SERVICE_ID);

    for (const config of this.agentRepository.list()) {
      if (config.status === "active") {
        this.launch(config);
      }
    }
  }

  start(): void {
    if (this.running) return;

    this.running = true;

    void this.consume();
  }

  stop(): void {
    this.running = false;

    for (const agent of this.agents.values()) {
      agent.stop();
    }

    this.agents.clear();

    this.bus.unsubscribe(AGENT_SERVICE_ID);
  }

  private launch(config: Agent): void {
    if (this.agents.has(config.id)) return;

    const agent = new BaseAgent(
      config,
      this.bus,
      this.memory,
      this.tools,
      this.prompts,
      this.taskRepository,
    );

    this.agents.set(config.id, agent);

    agent.start();
  }

  private async consume(): Promise<void> {
    while (this.running) {
      const event = await this.mailbox.takeNext();

      try {
        await this.handle(event);
      } catch (error) {
        console.error(`[agent-service] failed to handle ${event.type}`, error);
      }
    }
  }

  private async handle(event: Event): Promise<void> {
    if (event.topic !== "agent") return;

    switch (event.type) {
      case "agent_creation_request":
        return this.handleCreation(event);

      case "agent_suspension_request":
        return this.handleSuspension(event);

      case "agent_resume_request":
        return this.handleResume(event);

      case "agent_termination_request":
        return this.handleTermination(event);

      default:
        return;
    }
  }

  private async handleCreation(
    event: AgentCreationRequestEvent,
  ): Promise<void> {
    const creatorId = event.source as AgentId;

    let creator: Agent;

    try {
      creator = this.agentRepository.get(creatorId);
    } catch {
      const response: EventRes<AgentCreationResponseEvent> = {
        topic: "agent",
        target: event.source,
        type: "agent_creation_response",
        body: {
          approved: false,
          agentId: null,
          reason: `unknown creator ${creatorId}`,
        },
      };

      this.publish(response);

      return;
    }

    const role = SUBORDINATE_ROLE[creator.role];

    if (!role) {
      const response: EventRes<AgentCreationResponseEvent> = {
        topic: "agent",
        target: event.source,
        type: "agent_creation_response",
        body: {
          approved: false,
          agentId: null,
          reason: `${creator.role} agents cannot create subordinates`,
        },
      };

      this.publish(response);

      return;
    }

    const department: Department =
      creator.role === "executive" ? event.body.department : creator.department;

    const created = await this.agentRepository.createAgent({
      role,
      department,
      objective: event.body.objective,
      kpis: event.body.kpis,
      responsibilities: event.body.responsibilities,
      reportsTo: creatorId,
      manages: [],
      tools: toolNamesFor(role, department),
      status: "active",
    });

    await this.agentRepository.update(creatorId, {
      manages: [...creator.manages, created.id],
    });

    this.launch(created);

    const response: EventRes<AgentCreationResponseEvent> = {
      topic: "agent",
      target: event.source,
      type: "agent_creation_response",
      body: {
        approved: true,
        agentId: created.id,
        reason: null,
      },
    };

    this.publish(response);
  }

  private async handleSuspension(
    event: AgentSuspensionRequestEvent,
  ): Promise<void> {
    await this.agentRepository.update(event.body.agentId, {
      status: "suspended",
    });

    const response: EventRes<AgentSuspensionResponseEvent> = {
      topic: "agent",
      target: event.source,
      type: "agent_suspension_response",
      body: {
        approved: true,
        reason: null,
      },
    };

    this.publish(response);
  }

  private async handleResume(event: AgentResumeRequestEvent): Promise<void> {
    const resumed = await this.agentRepository.update(event.body.agentId, {
      status: "active",
    });

    this.launch(resumed);

    const response: EventRes<AgentResumeResponseEvent> = {
      topic: "agent",
      target: event.source,
      type: "agent_resume_response",
      body: {
        resumed: true,
        reason: null,
      },
    };

    this.publish(response);
  }

  private async handleTermination(
    event: AgentTerminationRequestEvent,
  ): Promise<void> {
    const { agentId } = event.body;

    this.agents.get(agentId)?.stop();

    this.agents.delete(agentId);

    await this.agentRepository.delete(agentId);

    const response: EventRes<AgentTerminationResponseEvent> = {
      topic: "agent",
      target: event.source,
      type: "agent_termination_response",
      body: {
        terminated: true,
        reason: null,
      },
    };

    this.publish(response);
  }

  private publish<T extends Event>(event: EventRes<T>): void {
    this.bus.publish({
      source: AGENT_SERVICE_ID,
      ...event,
    } as T);
  }
}
