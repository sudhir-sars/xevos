import { tool } from "ai";
import { z } from "zod";

import { agentSpawnSchema } from "../../../../schema";
import { defineTool } from "../../ztypes";

type Input = z.infer<typeof agentSpawnSchema>;

// TRIVIAL: creating a subordinate doesn't depend on a peer agent acting, so it
// runs directly and returns the real agentId immediately — and the new agent is
// already launched (subscribed) by the time this returns, so you can message it
// right away with no race and no wait_until_response round-trip.
//
// The role is fixed by the ladder — you always spawn exactly the role one rung
// below you (executive→head, head→manager, manager→worker) — so you do not pick
// it. Only the executive chooses a department (for the new head); everyone else
// passes nothing. Objective, KPIs, responsibilities, tools, and reporting line
// are all fixed by the system.
export const createSubordinateAgent = defineTool({
  name: "create_subordinate_agent",
  direct: true,
  tool: tool({
    description:
      "Create your direct subordinate (the next role below you). You pass no fields — except the executive, which passes the department for the new head. Everything about the new agent (role, objective, KPIs, responsibilities, tools, reporting line) is set automatically.",
    inputSchema: agentSpawnSchema,
  }),

  handler: async (ctx, args: Input) => {
    if (!ctx.org) {
      return { success: false, error: "org operations unavailable" };
    }

    const result = await ctx.org.createAgent(ctx.agent.id, args);

    if (result.approved) {
      return { success: true, result };
    }

    return {
      success: false,
      error: result.reason ?? "agent creation rejected",
    };
  },
});
