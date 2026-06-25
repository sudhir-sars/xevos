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
  EventId,
  EventRes,
  Role,
  ServiceId,
} from "../schema";
import { departmentSchema } from "../schema";

import type { AgentRepository, TaskRepository } from "../../repositories";

import { type EventBus, type Mailbox } from "../event-bus";

import type { MemoryService } from "./memory";
import type { PromptService } from "./prompt";
import type { ToolService } from "./tool";

import { toolNamesFor } from "./tool";

export const AGENT_SERVICE_ID: ServiceId = "agent_service";

/**
 * Authority rank. Roles are CAPABILITIES, not mandatory layers: a creator may
 * spawn any role strictly below its own rank, so the live tree can skip levels
 * and stay flat — an executive can delegate straight to a worker; a head can
 * staff workers directly without a manager in between. The spawn policy below is
 * what keeps that flatness from quietly growing into a cathedral of managers.
 */
const ROLE_RANK: Record<Role, number> = {
  executive: 0,
  head: 1,
  manager: 2,
  worker: 3,
};

const canCreate = (creator: Role, target: Role): boolean =>
  ROLE_RANK[target] > ROLE_RANK[creator];

/**
 * Spawn policy — the enforced half of "as flat as the task tolerates". Depth is
 * the most expensive dimension (every layer is an LLM round-trip down and back),
 * so we cap it hard; fan-out is cheap and parallel, so its cap is generous. Tune
 * here.
 */
const MAX_DEPTH = 3; // executive is depth 0; the deepest leaf may sit at depth 3
const MAX_DIRECT_REPORTS = 8; // per-agent fan-out ceiling
const MAX_TOTAL_AGENTS = 40; // global ceiling on the whole org

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

      this.publish(response, event.id);

      return;
    }

    const role = event.body.role;

    // 1. Capability: may this creator spawn this role at all?
    if (!canCreate(creator.role, role)) {
      return this.rejectCreation(
        event,
        `${creator.role} cannot create ${role}`,
      );
    }

    // 2. Spawn policy: keep the org flat and bounded.
    if (this.agentRepository.list().length >= MAX_TOTAL_AGENTS) {
      return this.rejectCreation(
        event,
        `organization has reached its size limit (${MAX_TOTAL_AGENTS} agents)`,
      );
    }

    if (creator.manages.length >= MAX_DIRECT_REPORTS) {
      return this.rejectCreation(
        event,
        `${creatorId} already has ${MAX_DIRECT_REPORTS} direct reports; delegate through them rather than adding more`,
      );
    }

    if (this.depthOf(creator) + 1 > MAX_DEPTH) {
      return this.rejectCreation(
        event,
        `max org depth (${MAX_DEPTH}) reached; this work must be delegated to an existing agent, not nested deeper`,
      );
    }

    // 3. Department is an orthogonal axis, not a tree level. The executive picks
    // which department a head/subordinate belongs to; everyone else inherits the
    // creator's department.
    let department: Department;

    if (creator.role === "executive") {
      const requested = event.body.department;

      if (!departmentSchema.options.includes(requested)) {
        return this.rejectCreation(
          event,
          `unknown department "${requested}"`,
        );
      }

      department = requested;
    } else {
      department = creator.department;
    }

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

    // The new agent is now live but idle — it blocks on its mailbox until its
    // parent delegates work to it. Triggering it is the creator's job (assign a
    // task, or hand over the objective with a message), not the service's.
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

    this.publish(response, event.id);
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

    this.publish(response, event.id);
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

    this.publish(response, event.id);
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

    this.publish(response, event.id);
  }

  /** Reject an agent-creation request with a readable reason the creator can act on. */
  private rejectCreation(
    request: AgentCreationRequestEvent,
    reason: string,
  ): void {
    const response: EventRes<AgentCreationResponseEvent> = {
      topic: "agent",
      target: request.source,
      type: "agent_creation_response",
      body: { approved: false, agentId: null, reason },
    };

    this.publish(response, request.id);
  }

  /** Distance from the executive root (executive = 0), by walking reportsTo. */
  private depthOf(agent: Agent): number {
    let depth = 0;
    let current = agent;

    // The MAX_TOTAL_AGENTS bound doubles as a cycle guard.
    while (current.reportsTo !== "principal" && depth <= MAX_TOTAL_AGENTS) {
      current = this.agentRepository.get(current.reportsTo);
      depth++;
    }

    return depth;
  }

  private publish<T extends Event>(
    event: EventRes<T>,
    correlationId?: EventId,
  ): void {
    this.bus.publish({
      source: AGENT_SERVICE_ID,
      ...event,
      ...(correlationId ? { correlationId } : {}),
    } as T);
  }
}
