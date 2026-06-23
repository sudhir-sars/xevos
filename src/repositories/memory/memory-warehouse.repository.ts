// repositories/memory-warehouse.repository.ts

import { JSONFilePreset } from "lowdb/node";
import {
  AgentId,
  MemoryWarehouse,
  MemoryWarehouseId,
  TaskId,
  ClosedReason,
} from "../../core/schema";

type MemoryWarehouseCreate = Omit<MemoryWarehouse, "id" | "createdAt">;

type MemoryWarehouseDatabase = {
  counter: number;
  warehouse: MemoryWarehouse[];
};

type MemoryWarehouseDb = Awaited<
  ReturnType<typeof JSONFilePreset<MemoryWarehouseDatabase>>
>;

export class MemoryWarehouseRepository {
  constructor(private readonly db: MemoryWarehouseDb) {}

  static async create(
    file = "./storage/memory-warehouse.json",
  ): Promise<MemoryWarehouseRepository> {
    const db = await JSONFilePreset<MemoryWarehouseDatabase>(file, {
      counter: 0,
      warehouse: [],
    });

    return new MemoryWarehouseRepository(db);
  }

  async get(id: MemoryWarehouseId): Promise<MemoryWarehouse | null> {
    return this.db.data.warehouse.find((w) => w.id === id) ?? null;
  }

  async archive(entry: MemoryWarehouseCreate): Promise<MemoryWarehouse> {
    const nextId = this.db.data.counter + 1;
    this.db.data.counter = nextId;

    const record: MemoryWarehouse = {
      ...entry,
      id: `memory_${nextId}` as MemoryWarehouseId,
      createdAt: Date.now(),
    };

    this.db.data.warehouse.push(record);
    await this.db.write();
    return record;
  }

  async list(): Promise<MemoryWarehouse[]> {
    return [...this.db.data.warehouse];
  }

  async listByAgent(agentId: AgentId): Promise<MemoryWarehouse[]> {
    return this.db.data.warehouse.filter((w) => w.agentId === agentId);
  }

  async listByTask(taskId: TaskId): Promise<MemoryWarehouse[]> {
    return this.db.data.warehouse.filter((w) => w.taskId === taskId);
  }

  async listByOutcome(outcome: ClosedReason): Promise<MemoryWarehouse[]> {
    return this.db.data.warehouse.filter((w) => w.outcome === outcome);
  }

  async delete(id: MemoryWarehouseId): Promise<void> {
    this.db.data.warehouse = this.db.data.warehouse.filter((w) => w.id !== id);
    await this.db.write();
  }
}
