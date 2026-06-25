import { tool } from "ai";
import { z } from "zod";

import type { EscalationRequestEvent, TaskId } from "../../../../schema";
import { publish, rationale, taskId, defineTool } from "../../ztypes";

const inputSchema = z.object({
  reason: z.string().describe("What is blocking you"),
  blockedTaskId: taskId.optional(),
  rationale,
});

type Input = z.infer<typeof inputSchema>;

export const escalateBlocker = defineTool({
  name: "escalate_blocker",
  tool: tool({
    description: "Escalate a blocker to the agent you report to.",
    inputSchema,
  }),

  handler: (ctx, args: Input) => {
    if (!ctx.agent.reportsTo) {
      return {
        success: false,
        error: "Agent has no supervisor",
      };
    }

    const event: Omit<EscalationRequestEvent, "id"> = {
      source: ctx.agent.id,
      target: ctx.agent.reportsTo,
      topic: "agent",
      type: "escalation_request",
      body: {
        reason: args.reason,
        blockedTaskId: (args.blockedTaskId ?? null) as TaskId | null,
      },
    };

    return publish(ctx.bus, event, "escalation_response");
  },
});
