// repositories/agent-memory.repository.ts

import { eq } from "drizzle-orm";
import type { ModelMessage } from "ai";

import type { AgentId, AgentMemory } from "../../core/schema";
import { getDb, type DB } from "../../db/client";
import { agentMemories } from "../../db/schema";

export class AgentMemoryRepository {
  constructor(private readonly db: DB) {}

  static async create(): Promise<AgentMemoryRepository> {
    return new AgentMemoryRepository(getDb());
  }

  async get(agentId: AgentId): Promise<AgentMemory | null> {
    return (
      this.db
        .select()
        .from(agentMemories)
        .where(eq(agentMemories.agentId, agentId))
        .get() ?? null
    );
  }

  async append(
    agentId: AgentId,
    newMessages: ModelMessage[],
  ): Promise<AgentMemory> {
    return this.db.transaction((tx): AgentMemory => {
      const existing = tx
        .select()
        .from(agentMemories)
        .where(eq(agentMemories.agentId, agentId))
        .get();

      const messages = [...(existing?.messages ?? []), ...newMessages];
      const updatedAt = Date.now();

      if (existing) {
        tx.update(agentMemories)
          .set({ messages, updatedAt })
          .where(eq(agentMemories.agentId, agentId))
          .run();
      } else {
        tx.insert(agentMemories).values({ agentId, messages, updatedAt }).run();
      }

      return { agentId, messages, updatedAt };
    });
  }

  async clear(agentId: AgentId): Promise<void> {
    this.db
      .delete(agentMemories)
      .where(eq(agentMemories.agentId, agentId))
      .run();
  }
}
