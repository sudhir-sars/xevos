// repositories/memory-warehouse.repository.ts

import { eq, inArray } from "drizzle-orm";

import type {
  AgentId,
  ClosedReason,
  MemoryWarehouse,
  MemoryWarehouseId,
  TaskId,
} from "../../core/schema";
import { getDb, getSqlite, toVecBlob, type DB } from "../../db/client";
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

  /**
   * Archive a learning. If an `embedding` is supplied it is written to the
   * sqlite-vec `vec_memory` table keyed by this row's `rowid`, enabling KNN
   * recall via {@link searchByVector}. Committed just after the row so a crash
   * in between leaves the learning intact (merely unindexed).
   */
  async archive(
    entry: MemoryWarehouseCreate,
    embedding?: readonly number[],
  ): Promise<MemoryWarehouse> {
    const row = this.db.transaction((tx): WarehouseRow => {
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

      return tx
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
    });

    if (embedding) {
      getSqlite()
        .prepare("INSERT INTO vec_memory(rowid, embedding) VALUES (?, ?)")
        .run(BigInt(row.rowid), toVecBlob(embedding));
    }

    return toDomain(row);
  }

  /**
   * K-nearest-neighbour recall over archived learnings, ordered by ascending
   * distance. Replaces the old BM25 keyword search with semantic vector search.
   */
  async searchByVector(
    embedding: readonly number[],
    limit: number,
  ): Promise<MemoryWarehouse[]> {
    const knn = getSqlite()
      .prepare(
        "SELECT rowid, distance FROM vec_memory WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
      )
      .all(toVecBlob(embedding), limit) as { rowid: bigint | number }[];

    if (knn.length === 0) return [];

    const orderedIds = knn.map((r) => Number(r.rowid));
    const rows = this.db
      .select()
      .from(memoryWarehouse)
      .where(inArray(memoryWarehouse.rowid, orderedIds))
      .all();

    const byRowid = new Map(rows.map((r) => [r.rowid, r]));
    return orderedIds
      .map((id) => byRowid.get(id))
      .filter((r): r is WarehouseRow => r !== undefined)
      .map(toDomain);
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
