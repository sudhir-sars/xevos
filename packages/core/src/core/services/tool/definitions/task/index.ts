import { createTask } from "./create-task";
import { updateTaskStatus } from "./update-task-status";

/** Task lifecycle tools: create, delegate, and transition work. */
export const taskDefinitions = [createTask, updateTaskStatus] as const;
