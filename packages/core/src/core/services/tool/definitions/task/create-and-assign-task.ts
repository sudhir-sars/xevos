import { tool } from "ai";
import { z } from "zod";

import { type TaskCreate, type TaskId, taskCreateSchema } from "../../../../schema";
import { defineTool } from "../../ztypes";

const DEFAULT_TASK_BUDGET = {
  maxTokens: 50_000,
  maxUsd: 1,
};

// TRIVIAL: the spec's own `assignedTo` names the worker, and creating the task is
// a direct in-process write that returns the real taskId immediately — no bus
// round-trip, no wait_until_response. (Only the delegation that WAKES the worker
// is a bus event; a peer agent must act on that part.)
type Input = z.infer<typeof taskCreateSchema>;

export const createAndAssignTask = defineTool({
  name: "create_and_assign_task",
  direct: true,
  tool: tool({
    description:
      "Create a task and assign it to one of your workers in a single atomic step. The worker is woken with the task immediately.",
    inputSchema: taskCreateSchema,
  }),

  handler: async (ctx, args: Input) => {
    if (!ctx.org) {
      return { success: false, error: "org operations unavailable" };
    }

    const spec: TaskCreate = {
      referceTask: args.referceTask,
      title: args.title,
      description: args.description,
      acceptanceCriteria: args.acceptanceCriteria,
      dependencies: args.dependencies as TaskId[],
      priority: args.priority,
      deadline: args.deadline,
      budget: DEFAULT_TASK_BUDGET,
      assignedTo: args.assignedTo,
    };

    const result = await ctx.org.createTask(ctx.agent.id, spec);

    if (result.created) {
      return { success: true, result };
    }

    return { success: false, error: result.reason ?? "failed to create task" };
  },
});
