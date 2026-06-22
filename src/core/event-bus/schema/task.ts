import type {
  MutableTask,
  TaskCreate,
  TaskId,
  TaskStatus,
} from "../../agents/schema/task.schema";

import type { BaseEvent } from "./base-event";

interface TaskCreateRequestEvent extends BaseEvent {
  topic: "task";
  type: "task_create_request";

  body: TaskCreate;
}

interface TaskCreateResponseEvent extends BaseEvent {
  topic: "task";
  type: "task_create_response";

  body: {
    taskId: TaskId | null;
    created: boolean;
    reason: string | null;
  };
}

interface TaskUpdateRequestEvent extends BaseEvent {
  topic: "task";
  type: "task_update_request";

  body: {
    taskId: TaskId;
    patch: Partial<MutableTask>;
  };
}

interface TaskUpdateResponseEvent extends BaseEvent {
  topic: "task";
  type: "task_update_response";

  body: {
    updated: boolean;
    reason: string | null;
  };
}

interface TaskTransitionRequestEvent extends BaseEvent {
  topic: "task";
  type: "task_transition_request";

  body: {
    taskId: TaskId;
    to: TaskStatus;
    note: string | null;
  };
}

interface TaskTransitionResponseEvent extends BaseEvent {
  topic: "task";
  type: "task_transition_response";

  body: {
    transitioned: boolean;
    reason: string | null;
  };
}

interface TaskDelegationRequestEvent extends BaseEvent {
  topic: "task";
  type: "task_delegation_request";

  body: {
    taskId: TaskId;
  };
}

interface TaskDelegationResponseEvent extends BaseEvent {
  topic: "task";
  type: "task_delegation_response";

  body: {
    accepted: boolean;
    reason: string | null;
  };
}

export type TaskEvent =
  | TaskCreateRequestEvent
  | TaskCreateResponseEvent
  | TaskUpdateRequestEvent
  | TaskUpdateResponseEvent
  | TaskTransitionRequestEvent
  | TaskTransitionResponseEvent
  | TaskDelegationRequestEvent
  | TaskDelegationResponseEvent;
