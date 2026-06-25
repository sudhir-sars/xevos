// repositories/agent.repository.ts

import { and, eq } from "drizzle-orm";

import type {
  Agent,
  AgentCreate,
  AgentId,
  AgentStatus,
  Department,
  Role,
  RoleDefinitionId,
} from "../../core/schema";

import { getDb, type DB } from "../../db/client";
import { agents, counters } from "../../db/schema";
import { DEFAULT_AGENT } from "./default-agent";

export class AgentRepository {
  constructor(private readonly db: DB) {}

  static async create(): Promise<AgentRepository> {
    const repository = new AgentRepository(getDb());
    repository.seedDefaults();
    return repository;
  }

  private seedDefaults(): void {
    const exists = this.db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.role, DEFAULT_AGENT.role),
          eq(agents.department, DEFAULT_AGENT.department),
        ),
      )
      .get();

    if (exists) return;

    const roleDefinitionId: RoleDefinitionId = `${DEFAULT_AGENT.role}_${DEFAULT_AGENT.department}`;
    const agentId: AgentId = `${roleDefinitionId}_1`;

    this.db.transaction((tx) => {
      tx.insert(agents)
        .values({
          ...DEFAULT_AGENT,
          id: agentId,
          manages: [],
          status: "active",
          createdAt: Date.now(),
        })
        .run();

      tx.insert(counters).values({ key: roleDefinitionId, value: 2 }).run();
    });
  }

  get(agentId: AgentId): Agent {
    const row = this.db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .get();

    if (!row) throw new Error(`Agent "${agentId}" not found`);

    return row;
  }

  getCEO(): Agent {
    const ceo = this.db
      .select()
      .from(agents)
      .where(
        and(eq(agents.role, "executive"), eq(agents.department, "organization")),
      )
      .get();

    if (!ceo) throw new Error("CEO agent not found");

    return ceo;
  }

  async createAgent(agent: AgentCreate): Promise<Agent> {
    const roleDefinitionId: RoleDefinitionId = `${agent.role}_${agent.department}`;

    return this.db.transaction((tx): Agent => {
      const counter = tx
        .select()
        .from(counters)
        .where(eq(counters.key, roleDefinitionId))
        .get();

      const nextId = (counter?.value ?? 0) + 1;

      if (counter) {
        tx.update(counters)
          .set({ value: nextId })
          .where(eq(counters.key, roleDefinitionId))
          .run();
      } else {
        tx.insert(counters)
          .values({ key: roleDefinitionId, value: nextId })
          .run();
      }

      const record: Agent = {
        ...agent,
        id: `${roleDefinitionId}_${nextId}` as AgentId,
        createdAt: Date.now(),
        manages: [],
        status: "active",
      };

      tx.insert(agents).values(record).run();

      return record;
    });
  }

  async update(agentId: AgentId, updates: Partial<AgentCreate>): Promise<Agent> {
    const result = this.db
      .update(agents)
      .set(updates)
      .where(eq(agents.id, agentId))
      .returning()
      .get();

    if (!result) throw new Error(`Agent "${agentId}" not found`);

    return result;
  }

  async delete(agentId: AgentId): Promise<void> {
    const deleted = this.db
      .delete(agents)
      .where(eq(agents.id, agentId))
      .returning({ id: agents.id })
      .get();

    if (!deleted) throw new Error(`Agent "${agentId}" not found`);
  }

  list(): Agent[] {
    return this.db.select().from(agents).all();
  }

  listByRole(role: Role): Agent[] {
    return this.db.select().from(agents).where(eq(agents.role, role)).all();
  }

  listByDepartment(department: Department): Agent[] {
    return this.db
      .select()
      .from(agents)
      .where(eq(agents.department, department))
      .all();
  }

  listByStatus(status: AgentStatus): Agent[] {
    return this.db.select().from(agents).where(eq(agents.status, status)).all();
  }

  listReports(managerId: AgentId): Agent[] {
    return this.db
      .select()
      .from(agents)
      .where(eq(agents.reportsTo, managerId))
      .all();
  }
}
