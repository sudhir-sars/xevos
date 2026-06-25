// services/agent.service.ts

import { BaseAgent } from "../agents";

import type {
  Agent,
  AgentSpawn,
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
/**
 * The org is a fixed ladder: each role spawns exactly the role one rung below
 * it. The spawned role is therefore NOT a choice — it is determined by the
 * creator's role, so the creator never inputs it. Workers are the leaves and
 * spawn no one.
 */
const NEXT_ROLE: Record<Role, Role | null> = {
  executive: "head",
  head: "manager",
  manager: "worker",
  worker: null,
};

/**
 * An agent's objective is STATIC — set by us from its role, never chosen per
 * creation. Identity is fixed ("serve your parent, deliver the work given to
 * you"); what varies is the WORK, which arrives as delegated direction and
 * tasks — not by rewriting who the agent is. This is why the creator's proposed
 * objective is ignored: a task-flavoured objective would make the agent drift
 * with the task instead of staying a stable seat in the org.
 */
function staticObjective(role: Role, department: Department): string {
  switch (role) {
    case "executive":
      return `Serve as the organization's executive: interface with the principal and deliver their objectives through the department heads you direct.`;
    case "head":
      return `Lead the ${department} department. Take the objectives your executive hands you and deliver them through the managers and work you organize. Your purpose is fixed — the specific goals arrive as direction from above and the work in flight, not from this statement.`;
    case "manager":
      return `Run your initiative in the ${department} department. Turn the requirements your head gives you into completed, verified work through your workers. Your purpose is fixed — the specific work arrives as direction and the tasks you create, not from this statement.`;
    case "worker":
      return `Execute the tasks assigned to you in the ${department} department to a high standard, following your manager's specification. Your purpose is fixed — the specific work arrives as the tasks you are assigned, not from this statement.`;
  }
}

/**
 * KPIs and responsibilities are STATIC per role too — generic across every
 * department, derived from what the role IS, not from the task that spawned it.
 * Like the objective, they are set by us so identity stays stable.
 */
const STATIC_KPIS: Record<Role, readonly string[]> = {
  executive: [
    "Principal objectives delivered",
    "Organizational alignment",
    "Delivery success rate",
  ],
  head: [
    "Department objectives delivered",
    "Initiative throughput",
    "Quality of delivered outcomes",
  ],
  manager: [
    "Initiative delivered to spec",
    "Task throughput and quality",
    "Rework rate kept low",
  ],
  worker: [
    "Assigned tasks completed and passed review",
    "First-pass approval rate",
    "Timeliness",
  ],
};

const STATIC_RESPONSIBILITIES: Record<Role, readonly string[]> = {
  executive: [
    "Interface with the principal",
    "Translate principal intent into objectives",
    "Delegate to and coordinate department heads",
    "Ensure outcomes meet the principal's intent",
  ],
  head: [
    "Turn the executive's objective into initiatives",
    "Staff and direct managers",
    "Review delivered outcomes against the objective",
    "Escalate blockers upward",
  ],
  manager: [
    "Own the specification for the initiative",
    "Decompose the work into concrete tasks",
    "Staff and direct workers",
    "Mark tasks complete on the Auditor's pass and report progress",
  ],
  worker: [
    "Execute assigned tasks to spec",
    "Keep task status current",
    "Submit completed work for review with real evidence",
    "Escalate blockers you cannot resolve",
  ],
};

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

  /**
   * Create-and-launch a subordinate DIRECTLY (validation + spawn policy + repo
   * write + launch), returning the real result. Trivial tools call this
   * in-process — and because the new agent is LAUNCHED (subscribed) before this
   * returns, the creator can message it immediately with no race. The bus
   * handler just wraps this in a response event.
   */
  async create(
    creatorId: AgentId,
    spec: AgentSpawn,
  ): Promise<{
    approved: boolean;
    agentId: AgentId | null;
    reason: string | null;
  }> {
    let creator: Agent;

    try {
      creator = this.agentRepository.get(creatorId);
    } catch {
      return {
        approved: false,
        agentId: null,
        reason: `unknown creator ${creatorId}`,
      };
    }

    // 1. Role is fixed by the ladder — the creator spawns exactly the role one
    // rung below it, never a role it chooses. Workers are leaves.
    const role = NEXT_ROLE[creator.role];

    if (!role) {
      return {
        approved: false,
        agentId: null,
        reason: `${creator.role} agents are leaves and do not spawn subordinates`,
      };
    }

    // 2. Spawn policy: keep the org flat and bounded.
    if (this.agentRepository.list().length >= MAX_TOTAL_AGENTS) {
      return {
        approved: false,
        agentId: null,
        reason: `organization has reached its size limit (${MAX_TOTAL_AGENTS} agents)`,
      };
    }

    if (creator.manages.length >= MAX_DIRECT_REPORTS) {
      return {
        approved: false,
        agentId: null,
        reason: `${creatorId} already has ${MAX_DIRECT_REPORTS} direct reports; delegate through them rather than adding more`,
      };
    }

    if (this.depthOf(creator) + 1 > MAX_DEPTH) {
      return {
        approved: false,
        agentId: null,
        reason: `max org depth (${MAX_DEPTH}) reached; this work must be delegated to an existing agent, not nested deeper`,
      };
    }

    // 3. Department: ONLY the executive spawns across departments, so only it
    // chooses one (for the head it creates). Everyone below inherits the
    // creator's department and does not — cannot — set it.
    let department: Department;

    if (creator.role === "executive") {
      if (!spec.department) {
        return {
          approved: false,
          agentId: null,
          reason:
            "the executive must specify the department for the new head",
        };
      }

      department = spec.department;
    } else {
      department = creator.department;
    }

    const created = await this.agentRepository.createAgent({
      role,
      department,
      // Identity is enforced by us from the role — objective, kpis, and
      // responsibilities are static, not chosen per creation, so an agent never
      // drifts with the task that spawned it. The work is driven by tasks.
      objective: staticObjective(role, department),
      kpis: [...STATIC_KPIS[role]],
      responsibilities: [...STATIC_RESPONSIBILITIES[role]],
      reportsTo: creatorId,
      manages: [],
      tools: toolNamesFor(role, department),
      status: "active",
    });

    await this.agentRepository.update(creatorId, {
      manages: [...creator.manages, created.id],
    });

    this.launch(created);

    return { approved: true, agentId: created.id, reason: null };
  }

  private async handleCreation(
    event: AgentCreationRequestEvent,
  ): Promise<void> {
    const result = await this.create(event.source as AgentId, event.body);

    const response: EventRes<AgentCreationResponseEvent> = {
      topic: "agent",
      target: event.source,
      type: "agent_creation_response",
      body: result,
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
