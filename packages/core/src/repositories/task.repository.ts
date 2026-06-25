// repositories/task.repository.ts

import { JSONFilePreset } from "lowdb/node";

import type {
  AgentId,
  MutableTask,
  Task,
  TaskCreate,
  TaskId,
  TaskStatus,
} from "../core/schema";
import { ensureStorageFile } from "./utils";

type TaskDatabase = {
  nextTaskId: number;
  tasks: Task[];
};

type TaskDb = Awaited<ReturnType<typeof JSONFilePreset<TaskDatabase>>>;
export class TaskRepository {
  constructor(private readonly db: TaskDb) {}

  static async create(file = "./storage/tasks.json"): Promise<TaskRepository> {
    const db = await JSONFilePreset<TaskDatabase>(
      await ensureStorageFile(file),
      {
        nextTaskId: 1,
        tasks: [],
      },
    );

    return new TaskRepository(db);
  }

  async get(taskId: TaskId): Promise<Task | null> {
    return this.db.data.tasks.find((task) => task.id === taskId) ?? null;
  }

  async createTask(task: TaskCreate): Promise<Task> {
    const now = Date.now();

    const record: Task = {
      id: `task_${this.db.data.nextTaskId++}` as TaskId,

      // Born already assigned: creation and assignment are atomic (the spec
      // carries `assignedTo`), so a task never sits in `backlog` waiting for a
      // separate assign step.
      status: "assigned",

      review: null,

      createdAt: now,
      updatedAt: now,

      ...task,
    };

    this.db.data.tasks.push(record);

    await this.db.write();

    return record;
  }

  async update(
    taskId: TaskId,
    updates: Partial<MutableTask>,
  ): Promise<Task | null> {
    const task = this.db.data.tasks.find((task) => task.id === taskId);

    if (!task) return null;

    Object.assign(task, updates, {
      updatedAt: Date.now(),
    });

    await this.db.write();

    return task;
  }

  async delete(taskId: TaskId): Promise<void> {
    this.db.data.tasks = this.db.data.tasks.filter(
      (task) => task.id !== taskId,
    );

    await this.db.write();
  }

  async list(): Promise<Task[]> {
    return [...this.db.data.tasks];
  }

  async listByAgent(agentId: AgentId): Promise<Task[]> {
    return this.db.data.tasks.filter((task) => task.assignedTo === agentId);
  }

  async listByStatus(status: TaskStatus): Promise<Task[]> {
    return this.db.data.tasks.filter((task) => task.status === status);
  }
}
