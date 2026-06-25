import { tool } from "ai";
import { z } from "zod";

import { type TaskId, taskStatusSchema } from "../../../../schema";
import { rationale, taskId, defineTool } from "../../ztypes";

const inputSchema = z.object({
  taskId,
  newTaskStatus: taskStatusSchema,
  rationale,
});

type Input = z.infer<typeof inputSchema>;

// TRIVIAL: a status transition is validated and applied in-process, returning
// the real result immediately — no bus round-trip, no wait_until_response.
export const updateTaskStatus = defineTool({
  name: "update_task_status",
  direct: true,
  tool: tool({
    description: "Transition a task to a new status.",
    inputSchema,
  }),

  handler: async (ctx, args: Input) => {
    if (!ctx.org) {
      return { success: false, error: "org operations unavailable" };
    }

    const result = await ctx.org.transitionTask(
      ctx.agent.id,
      args.taskId as TaskId,
      args.newTaskStatus,
      null,
    );

    if (result.transitioned) {
      return { success: true, result };
    }

    return { success: false, error: result.reason ?? "transition failed" };
  },
});
