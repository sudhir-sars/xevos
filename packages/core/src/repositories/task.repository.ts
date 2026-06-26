// repositories/task.repository.ts

import { eq } from "drizzle-orm";

import type {
  AgentId,
  MutableTask,
  Task,
  TaskCreate,
  TaskId,
  TaskStatus,
} from "../core/schema";

import { getDb, type DB } from "../db/client";
import { counters, tasks } from "../db/schema";

const TASK_COUNTER = "task";

export class TaskRepository {
  constructor(private readonly db: DB) {}

  static async create(): Promise<TaskRepository> {
    return new TaskRepository(getDb());
  }

  async get(taskId: TaskId): Promise<Task | null> {
    return (
      this.db.select().from(tasks).where(eq(tasks.id, taskId)).get() ?? null
    );
  }

  async createTask(task: TaskCreate): Promise<Task> {
    const now = Date.now();

    return this.db.transaction((tx): Task => {
      const counter = tx
        .select()
        .from(counters)
        .where(eq(counters.key, TASK_COUNTER))
        .get();

      const nextId = (counter?.value ?? 0) + 1;

      if (counter) {
        tx.update(counters)
          .set({ value: nextId })
          .where(eq(counters.key, TASK_COUNTER))
          .run();
      } else {
        tx.insert(counters).values({ key: TASK_COUNTER, value: nextId }).run();
      }

      const record: Task = {
        id: `task_${nextId}` as TaskId,
        // Born already assigned: creation and assignment are atomic.
        status: "assigned",
        review: null,
        createdAt: now,
        updatedAt: now,
        ...task,
      };

      tx.insert(tasks).values(record).run();

      return record;
    });
  }

  async update(
    taskId: TaskId,
    updates: Partial<MutableTask>,
  ): Promise<Task | null> {
    return (
      this.db
        .update(tasks)
        .set({ ...updates, updatedAt: Date.now() })
        .where(eq(tasks.id, taskId))
        .returning()
        .get() ?? null
    );
  }

  async delete(taskId: TaskId): Promise<void> {
    this.db.delete(tasks).where(eq(tasks.id, taskId)).run();
  }

  async list(): Promise<Task[]> {
    return this.db.select().from(tasks).all();
  }

  async listByAgent(agentId: AgentId): Promise<Task[]> {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.assignedTo, agentId))
      .all();
  }

  async listByStatus(status: TaskStatus): Promise<Task[]> {
    return this.db.select().from(tasks).where(eq(tasks.status, status)).all();
  }
}
