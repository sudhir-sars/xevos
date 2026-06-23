// repositories/agent-memory.repository.ts

import { JSONFilePreset } from "lowdb/node";
import { ModelMessage } from "ai";
import { AgentId, AgentMemory } from "../../core/schema";

type AgentMemoryDatabase = {
  agentMemories: AgentMemory[];
};

type AgentMemoryDb = Awaited<
  ReturnType<typeof JSONFilePreset<AgentMemoryDatabase>>
>;

export class AgentMemoryRepository {
  constructor(private readonly db: AgentMemoryDb) {}

  static async create(
    file = "./storage/agent-memories.json",
  ): Promise<AgentMemoryRepository> {
    const db = await JSONFilePreset<AgentMemoryDatabase>(file, {
      agentMemories: [],
    });

    return new AgentMemoryRepository(db);
  }

  async get(agentId: AgentId): Promise<AgentMemory | null> {
    return (
      this.db.data.agentMemories.find((m) => m.agentId === agentId) ?? null
    );
  }

  async append(
    agentId: AgentId,
    newMessages: ModelMessage[],
  ): Promise<AgentMemory> {
    let memory = this.db.data.agentMemories.find((m) => m.agentId === agentId);

    if (!memory) {
      const newMemory: AgentMemory = {
        agentId,
        messages: newMessages,
        updatedAt: Date.now(),
      };

      this.db.data.agentMemories.push(newMemory);
      memory = newMemory;
    } else {
      memory.messages.push(...newMessages);
      memory.updatedAt = Date.now();
    }

    await this.db.write();
    return memory;
  }

  async clear(agentId: AgentId): Promise<void> {
    this.db.data.agentMemories = this.db.data.agentMemories.filter(
      (m) => m.agentId !== agentId,
    );
    await this.db.write();
  }
}
