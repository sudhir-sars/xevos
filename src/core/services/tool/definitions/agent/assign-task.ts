import { tool } from "ai";
import { z } from "zod";

import type {
  AgentId,
  TaskDelegationRequestEvent,
  TaskId,
} from "../../../../schema";
import {
  publish,
  agentId,
  rationale,
  taskId,
  defineTool,
} from "../../ztypes";

const inputSchema = z.object({ taskId, agentId, rationale });

type Input = z.infer<typeof inputSchema>;

export const assignTask = defineTool({
  name: "assign_task",
  tool: tool({
    description: "Delegate an existing task to a subordinate agent.",
    inputSchema,
  }),

  handler: (ctx, args: Input) => {
    const event: Omit<TaskDelegationRequestEvent, "id"> = {
      source: ctx.agent.id,
      target: args.agentId as AgentId,
      topic: "agent",
      type: "task_delegation_request",
      body: {
        taskId: args.taskId as TaskId,
      },
    };

    return publish(ctx.bus, event);
  },
});
