// repositories/memory-warehouse.repository.ts

import { eq } from "drizzle-orm";

import type {
  AgentId,
  ClosedReason,
  MemoryWarehouse,
  MemoryWarehouseId,
  TaskId,
} from "../../core/schema";
import { getDb, type DB } from "../../db/client";
import { counters, memoryWarehouse } from "../../db/schema";

type MemoryWarehouseCreate = Omit<MemoryWarehouse, "id" | "createdAt">;
type WarehouseRow = typeof memoryWarehouse.$inferSelect;

const MEMORY_COUNTER = "memory";

/** Drop the internal `rowid`/`memoryId` columns, exposing the domain shape. */
function toDomain(row: WarehouseRow): MemoryWarehouse {
  return {
    id: row.memoryId,
    taskId: row.taskId,
    agentId: row.agentId,
    outcome: row.outcome,
    learning: row.learning,
    messages: row.messages,
    createdAt: row.createdAt,
  };
}

export class MemoryWarehouseRepository {
  constructor(private readonly db: DB) {}

  static async create(): Promise<MemoryWarehouseRepository> {
    return new MemoryWarehouseRepository(getDb());
  }

  async get(id: MemoryWarehouseId): Promise<MemoryWarehouse | null> {
    const row = this.db
      .select()
      .from(memoryWarehouse)
      .where(eq(memoryWarehouse.memoryId, id))
      .get();
    return row ? toDomain(row) : null;
  }

  async archive(entry: MemoryWarehouseCreate): Promise<MemoryWarehouse> {
    return this.db.transaction((tx): MemoryWarehouse => {
      const counter = tx
        .select()
        .from(counters)
        .where(eq(counters.key, MEMORY_COUNTER))
        .get();

      const nextId = (counter?.value ?? 0) + 1;

      if (counter) {
        tx.update(counters)
          .set({ value: nextId })
          .where(eq(counters.key, MEMORY_COUNTER))
          .run();
      } else {
        tx.insert(counters)
          .values({ key: MEMORY_COUNTER, value: nextId })
          .run();
      }

      const row = tx
        .insert(memoryWarehouse)
        .values({
          memoryId: `memory_${nextId}` as MemoryWarehouseId,
          taskId: entry.taskId,
          agentId: entry.agentId,
          outcome: entry.outcome,
          learning: entry.learning,
          messages: entry.messages,
          createdAt: Date.now(),
        })
        .returning()
        .get();

      return toDomain(row);
    });
  }

  async list(): Promise<MemoryWarehouse[]> {
    return this.db.select().from(memoryWarehouse).all().map(toDomain);
  }

  async listByAgent(agentId: AgentId): Promise<MemoryWarehouse[]> {
    return this.db
      .select()
      .from(memoryWarehouse)
      .where(eq(memoryWarehouse.agentId, agentId))
      .all()
      .map(toDomain);
  }

  async listByTask(taskId: TaskId): Promise<MemoryWarehouse[]> {
    return this.db
      .select()
      .from(memoryWarehouse)
      .where(eq(memoryWarehouse.taskId, taskId))
      .all()
      .map(toDomain);
  }

  async listByOutcome(outcome: ClosedReason): Promise<MemoryWarehouse[]> {
    return this.db
      .select()
      .from(memoryWarehouse)
      .where(eq(memoryWarehouse.outcome, outcome))
      .all()
      .map(toDomain);
  }

  async delete(id: MemoryWarehouseId): Promise<void> {
    this.db
      .delete(memoryWarehouse)
      .where(eq(memoryWarehouse.memoryId, id))
      .run();
  }
}
