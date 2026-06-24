import { tool } from "ai";
import { z } from "zod";

import {
  type TaskId,
  type TaskTransitionRequestEvent,
  taskStatusSchema,
} from "../../../../schema";
import { TASK_SERVICE_ID } from "../../../task";
import { publish, rationale, taskId, defineTool } from "../../ztypes";

const inputSchema = z.object({
  taskId,
  newTaskStatus: taskStatusSchema,
  rationale,
});

type Input = z.infer<typeof inputSchema>;

export const updateTaskStatus = defineTool({
  name: "update_task_status",
  tool: tool({
    description: "Transition a task to a new status.",
    inputSchema,
  }),

  handler: (ctx, args: Input) => {
    const event: Omit<TaskTransitionRequestEvent, "id"> = {
      source: ctx.agent.id,
      target: TASK_SERVICE_ID,
      topic: "task",
      type: "task_transition_request",
      body: {
        taskId: args.taskId as TaskId,
        to: args.newTaskStatus,
        note: null,
      },
    };

    return publish(ctx.bus, event);
  },
});
