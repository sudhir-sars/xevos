// services/task.service.ts

import type {
  AgentId,
  ClosedReason,
  Event,
  EventId,
  EventRes,
  MutableTask,
  ServiceId,
  Task,
  TaskCreateRequestEvent,
  TaskCreateResponseEvent,
  TaskTransitionRequestEvent,
  TaskTransitionResponseEvent,
  TaskUpdateRequestEvent,
  TaskUpdateResponseEvent,
  TaskStatus,
} from "../schema";
import type { AgentRepository, TaskRepository } from "../../repositories";
import { type EventBus, type Mailbox } from "../event-bus";
import type { MemoryService } from "./memory";

const TERMINAL: readonly TaskStatus[] = ["completed", "failed", "cancelled"];

const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  backlog: ["assigned", "cancelled"],
  assigned: ["in_progress", "blocked", "cancelled"],
  in_progress: ["blocked", "in_review", "completed", "failed", "cancelled"],
  blocked: ["in_progress", "cancelled", "failed"],
  in_review: ["in_progress", "completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export const TASK_SERVICE_ID: ServiceId = "service_tasks";

export class TaskService {
  private running = false;
  private mailbox: Mailbox;

  constructor(
    private readonly bus: EventBus,
    private readonly tasks: TaskRepository,
    private readonly agents: AgentRepository,
    private readonly memory: MemoryService,
  ) {
    this.mailbox = this.bus.subscribe(TASK_SERVICE_ID);
  }

  start(): void {
    if (this.running) return;

    this.running = true;

    void this.run();
  }

  stop(): void {
    this.running = false;
    this.bus.unsubscribe(TASK_SERVICE_ID);
  }

  private async run(): Promise<void> {
    while (this.running) {
      const event = await this.mailbox.takeNext();

      try {
        await this.handle(event);
      } catch (err) {
        console.error(`[task-service] failed to handle ${event.type}:`, err);
      }
    }
  }

  private async handle(event: Event): Promise<void> {
    if (event.topic !== "task") return;

    switch (event.type) {
      case "task_create_request":
        return this.handleCreate(event);

      case "task_transition_request":
        return this.handleTransition(event);

      case "task_update_request":
        return this.handleUpdate(event);

      default:
        return;
    }
  }

  private async handleCreate(event: TaskCreateRequestEvent): Promise<void> {
    try {
      const task = await this.tasks.createTask(event.body);

      const response: EventRes<TaskCreateResponseEvent> = {
        topic: "task",
        target: event.source,
        type: "task_create_response",
        body: {
          taskId: task.id,
          created: true,
          reason: null,
        },
      };

      this.publish(response, event.id);
    } catch (error) {
      const response: EventRes<TaskCreateResponseEvent> = {
        topic: "task",
        target: event.source,
        type: "task_create_response",
        body: {
          taskId: null,
          created: false,
          reason:
            error instanceof Error ? error.message : "failed to create task",
        },
      };

      this.publish(response, event.id);
    }
  }

  private async handleTransition(
    event: TaskTransitionRequestEvent,
  ): Promise<void> {
    const { taskId, to, note } = event.body;

    const task = await this.tasks.get(taskId);

    if (!task) {
      const response: EventRes<TaskTransitionResponseEvent> = {
        topic: "task",
        target: event.source,
        type: "task_transition_response",
        body: {
          transitioned: false,
          reason: `task ${taskId} not found`,
        },
      };

      this.publish(response, event.id);

      return;
    }

    if (!VALID_TRANSITIONS[task.status].includes(to)) {
      const response: EventRes<TaskTransitionResponseEvent> = {
        topic: "task",
        target: event.source,
        type: "task_transition_response",
        body: {
          transitioned: false,
          reason: `illegal transition ${task.status} → ${to}`,
        },
      };

      this.publish(response, event.id);

      return;
    }

    const patch: Partial<MutableTask> = {
      status: to,
    };

    if (
      !task.assignedTo &&
      (to === "assigned" || to === "in_progress") &&
      this.isAgent(event.source)
    ) {
      patch.assignedTo = event.source;
    }

    const updated = await this.tasks.update(taskId, patch);

    const response: EventRes<TaskTransitionResponseEvent> = {
      topic: "task",
      target: event.source,
      type: "task_transition_response",
      body: {
        transitioned: true,
        reason: note,
      },
    };

    this.publish(response);

    if (updated && TERMINAL.includes(to)) {
      await this.archive(updated, to as ClosedReason, note ?? undefined);
    }
  }

  private async handleUpdate(event: TaskUpdateRequestEvent): Promise<void> {
    const updated = await this.tasks.update(
      event.body.taskId,
      event.body.patch,
    );

    const response: EventRes<TaskUpdateResponseEvent> = {
      topic: "task",
      target: event.source,
      type: "task_update_response",
      body: {
        updated: updated !== null,
        reason: updated ? null : `task ${event.body.taskId} not found`,
      },
    };

    this.publish(response);

    if (updated && TERMINAL.includes(updated.status)) {
      await this.archive(updated, updated.status as ClosedReason);
    }
  }

  private async archive(
    task: Task,
    reason: ClosedReason,
    summary?: string,
  ): Promise<void> {
    if (!task.assignedTo) {
      return;
    }

    try {
      const agent = this.agents.get(task.assignedTo);
      await this.memory.closeTask(agent, task.id, reason, summary);
    } catch (err) {
      console.error(`[task-service] failed to archive ${task.id}:`, err);
    }
  }

  private isAgent(id: Event["source"]): id is AgentId {
    try {
      this.agents.get(id as AgentId);
      return true;
    } catch {
      return false;
    }
  }

  private publish<T extends Event>(
    event: EventRes<T>,
    correlationId?: EventId,
  ): void {
    this.bus.publish({
      source: TASK_SERVICE_ID,
      ...event,
      ...(correlationId ? { correlationId } : {}),
    } as T);
  }
}
