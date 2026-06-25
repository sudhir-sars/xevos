import { tool } from "ai";
import { z } from "zod";

import { rationale, defineTool } from "../../ztypes";

const inputSchema = z.object({
  rationale,
});

export const getStatus = defineTool({
  name: "get_status",
  tool: tool({
    description:
      "Read status of yourself, your team, or the whole organization.",
    inputSchema,
  }),

  handler: async (ctx) => {
    return {
      success: true,
      result: {
        agent: ctx.agent.id,
        agentStatus: ctx.agent.status,
        tasks: await ctx.tasks.listByAgent(ctx.agent.id),
      },
    };
  },
});
