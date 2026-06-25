import type {
  MutableTask,
  TaskCreate,
  TaskId,
  TaskStatus,
} from "../task.schema";

import type { BaseEvent } from "./base-event";

export interface TaskCreateRequestEvent extends BaseEvent {
  topic: "task";
  type: "task_create_request";

  // Creation and assignment are one atomic act: the spec carries `assignedTo`,
  // so a task is never born ownerless. The service creates it already
  // `assigned` and delegates to that agent in the same step — eliminating the
  // create-then-assign race and the "owned by whoever transitioned it" bug.
  body: TaskCreate;
}

export interface TaskCreateResponseEvent extends BaseEvent {
  topic: "task";
  type: "task_create_response";

  body: {
    taskId: TaskId | null;
    created: boolean;
    reason: string | null;
  };
}

export interface TaskUpdateRequestEvent extends BaseEvent {
  topic: "task";
  type: "task_update_request";

  body: {
    taskId: TaskId;
    patch: Partial<MutableTask>;
  };
}

export interface TaskUpdateResponseEvent extends BaseEvent {
  topic: "task";
  type: "task_update_response";

  body: {
    updated: boolean;
    reason: string | null;
  };
}

export interface TaskTransitionRequestEvent extends BaseEvent {
  topic: "task";
  type: "task_transition_request";

  body: {
    taskId: TaskId;
    to: TaskStatus;
    note: string | null;
  };
}

export interface TaskTransitionResponseEvent extends BaseEvent {
  topic: "task";
  type: "task_transition_response";

  body: {
    transitioned: boolean;
    reason: string | null;
  };
}

export type TaskEvent =
  | TaskCreateRequestEvent
  | TaskCreateResponseEvent
  | TaskUpdateRequestEvent
  | TaskUpdateResponseEvent
  | TaskTransitionRequestEvent
  | TaskTransitionResponseEvent;
