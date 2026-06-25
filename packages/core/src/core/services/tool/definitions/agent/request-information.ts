import { tool } from "ai";
import { z } from "zod";

import type { AgentId, InformationRequestEvent } from "../../../../schema";
import { publish, agentId, rationale, defineTool } from "../../ztypes";

const inputSchema = z.object({
  agentId,
  query: z.string().describe("The question you need answered"),
  rationale,
});

type Input = z.infer<typeof inputSchema>;

export const requestInformation = defineTool({
  name: "request_information",
  tool: tool({
    description: "Ask another agent for information you need to proceed.",
    inputSchema,
  }),

  handler: (ctx, args: Input) => {
    const event: Omit<InformationRequestEvent, "id"> = {
      source: ctx.agent.id,
      target: args.agentId as AgentId,
      topic: "agent",
      type: "information_request",
      body: {
        query: args.query,
      },
    };

    return publish(ctx.bus, event, "information_response");
  },
});
