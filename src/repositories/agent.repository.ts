// repositories/agent.repository.ts

import { JSONFilePreset } from "lowdb/node";

import type {
  Agent,
  AgentId,
  AgentStatus,
  Department,
  Role,
  RoleDefinitionId,
} from "../core/schema";

type AgentCreate = Omit<Agent, "id" | "createdAt">;

type AgentCounterKey = RoleDefinitionId;

type AgentDatabase = {
  counters: Partial<Record<AgentCounterKey, number>>;
  agents: Agent[];
};

type AgentDb = Awaited<ReturnType<typeof JSONFilePreset<AgentDatabase>>>;

export class AgentRepository {
  constructor(private readonly db: AgentDb) {}

  static async create(
    file = "./storage/agents.json",
  ): Promise<AgentRepository> {
    const db = await JSONFilePreset<AgentDatabase>(file, {
      counters: {},
      agents: [],
    });

    return new AgentRepository(db);
  }

  get(agentId: AgentId): Agent {
    const agent = this.db.data.agents.find((agent) => agent.id === agentId);

    if (!agent) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    return agent;
  }

  async createAgent(agent: AgentCreate): Promise<Agent> {
    const roleDefinitionId =
      `${agent.role}_${agent.department}` as RoleDefinitionId;

    const nextId = (this.db.data.counters[roleDefinitionId] ?? 0) + 1;

    this.db.data.counters[roleDefinitionId] = nextId;

    const record: Agent = {
      ...agent,
      id: `${roleDefinitionId}_${nextId}` as AgentId,
      createdAt: Date.now(),
    };

    this.db.data.agents.push(record);

    await this.db.write();

    return record;
  }

  async update(
    agentId: AgentId,
    updates: Partial<AgentCreate>,
  ): Promise<Agent> {
    const agent = this.db.data.agents.find((agent) => agent.id === agentId);

    if (!agent) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    Object.assign(agent, updates);

    await this.db.write();

    return agent;
  }

  async delete(agentId: AgentId): Promise<void> {
    const index = this.db.data.agents.findIndex(
      (agent) => agent.id === agentId,
    );

    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    this.db.data.agents.splice(index, 1);

    await this.db.write();
  }

  list(): Agent[] {
    return [...this.db.data.agents];
  }

  listByRole(role: Role): Agent[] {
    return this.db.data.agents.filter((agent) => agent.role === role);
  }

  listByDepartment(department: Department): Agent[] {
    return this.db.data.agents.filter(
      (agent) => agent.department === department,
    );
  }

  listByStatus(status: AgentStatus): Agent[] {
    return this.db.data.agents.filter((agent) => agent.status === status);
  }

  listReports(managerId: AgentId): Agent[] {
    return this.db.data.agents.filter((agent) => agent.reportsTo === managerId);
  }
}
