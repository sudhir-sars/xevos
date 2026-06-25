// services/task.service.ts

import type {
  AgentId,
  ClosedReason,
  Event,
  EventId,
  EventRes,
  ServiceId,
  Task,
  TaskCreate,
  TaskCreateRequestEvent,
  TaskCreateResponseEvent,
  TaskDelegationRequestEvent,
  TaskId,
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

export const TASK_SERVICE_ID: ServiceId = "tasks_service";

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

  /**
   * Create-and-assign a task DIRECTLY. Trivial tools call this in-process and
   * get the real result back; the bus handler wraps it in a response event.
   * Creation is direct; only the delegation that WAKES the worker is a bus
   * event (a peer agent must act — that part stays async).
   */
  async create(
    source: AgentId,
    spec: TaskCreate,
  ): Promise<{ taskId: TaskId | null; created: boolean; reason: string | null }> {
    void source;
    const assignTo = spec.assignedTo;

    try {
      // A create-and-assign must name a worker, and that worker must exist —
      // otherwise we'd mint an orphaned task and delegate into the void.
      if (!assignTo) {
        throw new Error("create_and_assign_task requires an assignedTo agent");
      }

      this.agents.get(assignTo);

      const task = await this.tasks.createTask(spec);

      // Wake the assignee with its work (non-trivial: a peer agent must act).
      // The task is already `assigned` to it, so it can go straight to
      // in_progress.
      const delegation: EventRes<TaskDelegationRequestEvent> = {
        topic: "agent",
        target: assignTo,
        type: "task_delegation_request",
        body: { taskId: task.id },
      };

      this.publish(delegation);

      return { taskId: task.id, created: true, reason: null };
    } catch (error) {
      return {
        taskId: null,
        created: false,
        reason:
          error instanceof Error ? error.message : "failed to create task",
      };
    }
  }

  /** Transition a task DIRECTLY, with the same validation the bus path uses. */
  async transition(
    source: AgentId,
    taskId: TaskId,
    to: TaskStatus,
    note: string | null,
  ): Promise<{ transitioned: boolean; reason: string | null }> {
    const task = await this.tasks.get(taskId);

    if (!task) {
      return { transitioned: false, reason: `task ${taskId} not found` };
    }

    if (!VALID_TRANSITIONS[task.status].includes(to)) {
      return {
        transitioned: false,
        reason: `illegal transition ${task.status} → ${to}`,
      };
    }

    // Completion authority belongs to the MANAGER alone — not the worker that
    // did the work, not the Auditor that judged it. Enforced here so the policy
    // holds no matter who calls update_task_status.
    if (to === "completed") {
      let managerId: string | null = null;
      if (task.assignedTo) {
        try {
          managerId = this.agents.get(task.assignedTo).reportsTo;
        } catch {
          managerId = null;
        }
      }

      if (source !== managerId) {
        return {
          transitioned: false,
          reason: "only the task's manager may mark it completed",
        };
      }
    }

    // Ownership is set once, atomically, at creation (create_and_assign_task).
    // Transitions only move status — they never reassign.
    const updated = await this.tasks.update(taskId, { status: to });

    if (updated && TERMINAL.includes(to)) {
      await this.archive(updated, to as ClosedReason, note ?? undefined);
    }

    return { transitioned: true, reason: note };
  }

  private async handleCreate(event: TaskCreateRequestEvent): Promise<void> {
    const result = await this.create(event.source as AgentId, event.body);

    const response: EventRes<TaskCreateResponseEvent> = {
      topic: "task",
      target: event.source,
      type: "task_create_response",
      body: result,
    };

    this.publish(response, event.id);
  }

  private async handleTransition(
    event: TaskTransitionRequestEvent,
  ): Promise<void> {
    const { taskId, to, note } = event.body;

    const result = await this.transition(
      event.source as AgentId,
      taskId,
      to,
      note,
    );

    const response: EventRes<TaskTransitionResponseEvent> = {
      topic: "task",
      target: event.source,
      type: "task_transition_response",
      body: result,
    };

    this.publish(response, event.id);
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
