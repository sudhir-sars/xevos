// repositories/agent.repository.ts

import { JSONFilePreset } from "lowdb/node";

import type {
  Agent,
  AgentCreate,
  AgentId,
  AgentStatus,
  Department,
  Role,
  RoleDefinitionId,
} from "../../core/schema";

import { ensureStorageFile } from "../utils";
import { DEFAULT_AGENT } from "./default-agent";

type AgentDatabase = {
  counters: Partial<Record<RoleDefinitionId, number>>;
  agents: Agent[];
};

type AgentDb = Awaited<ReturnType<typeof JSONFilePreset<AgentDatabase>>>;

export class AgentRepository {
  constructor(private readonly db: AgentDb) {}

  static async create(
    file = "./storage/agents.json",
  ): Promise<AgentRepository> {
    const db = await JSONFilePreset<AgentDatabase>(
      await ensureStorageFile(file),
      {
        counters: {},
        agents: [],
      },
    );

    const repository = new AgentRepository(db);

    await repository.seedDefaults();

    return repository;
  }

  private async seedDefaults(): Promise<void> {
    let changed = false;

    const exists = this.db.data.agents.some(
      (existing) =>
        existing.role === DEFAULT_AGENT.role &&
        existing.department === DEFAULT_AGENT.department,
    );

    if (exists) return;

    const agentIdx = 1;
    const roleDefinitionId: RoleDefinitionId = `${DEFAULT_AGENT.role}_${DEFAULT_AGENT.department}`;
    const agentId: AgentId = `${DEFAULT_AGENT.role}_${DEFAULT_AGENT.department}_${agentIdx}`;

    this.db.data.counters[roleDefinitionId] = agentIdx + 1;

    this.db.data.agents.push({
      ...DEFAULT_AGENT,
      id: agentId,
      manages: [],

      status: "active",
      createdAt: Date.now(),
    });

    changed = true;

    if (changed) await this.db.write();
  }

  get(agentId: AgentId): Agent {
    const agent = this.db.data.agents.find((agent) => agent.id === agentId);

    if (!agent) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    return agent;
  }

  getCEO(): Agent {
    const ceo = this.db.data.agents.find(
      (agent) =>
        agent.role === "executive" && agent.department === "organization",
    );

    if (!ceo) {
      throw new Error("CEO agent not found");
    }

    return ceo;
  }

  async createAgent(agent: AgentCreate): Promise<Agent> {
    const roleDefinitionId: RoleDefinitionId = `${agent.role}_${agent.department}`;

    const nextId = (this.db.data.counters[roleDefinitionId] ?? 0) + 1;

    this.db.data.counters[roleDefinitionId] = nextId;

    const record: Agent = {
      ...agent,
      id: `${roleDefinitionId}_${nextId}` as AgentId,
      createdAt: Date.now(),
      manages: [],
      status: "active",
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
