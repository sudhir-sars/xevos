import { tool } from "ai";
import { z } from "zod";

import {
  type TaskCreate,
  type TaskCreateRequestEvent,
  type TaskId,
  taskCreateSchema,
} from "../../../../schema";
import { TASK_SERVICE_ID } from "../../../task";
import { publish, defineTool } from "../../ztypes";

const DEFAULT_TASK_BUDGET = {
  maxTokens: 50_000,
  maxUsd: 1,
};

type Input = z.infer<typeof taskCreateSchema>;

export const createTask = defineTool({
  name: "create_task",
  tool: tool({
    description: "Create a new task in the backlog.",
    inputSchema: taskCreateSchema,
  }),

  handler: (ctx, args: Input) => {
    const body: TaskCreate = {
      referceTask: args.referceTask,
      title: args.title,
      description: args.description,
      acceptanceCriteria: args.acceptanceCriteria,
      dependencies: args.dependencies as TaskId[],
      priority: args.priority,
      deadline: args.deadline,
      budget: DEFAULT_TASK_BUDGET,
    };

    const event: Omit<TaskCreateRequestEvent, "id"> = {
      source: ctx.agent.id,
      target: TASK_SERVICE_ID,
      topic: "task",
      type: "task_create_request",
      body,
    };

    return publish(ctx.bus, event);
  },
});
