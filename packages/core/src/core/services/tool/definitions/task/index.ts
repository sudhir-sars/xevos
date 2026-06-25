import { createAndAssignTask } from "./create-and-assign-task";
import { updateTaskStatus } from "./update-task-status";

/** Task lifecycle tools: create+assign atomically, and transition work. */
export const taskDefinitions = [createAndAssignTask, updateTaskStatus] as const;
