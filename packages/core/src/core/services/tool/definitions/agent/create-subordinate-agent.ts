import { tool } from "ai";
import { z } from "zod";

import {
  type AgentCreationRequestEvent,
  agentCreateSchema,
} from "../../../../schema";
import { AGENT_SERVICE_ID } from "../../../agent";
import { publish, defineTool } from "../../ztypes";

type Input = z.infer<typeof agentCreateSchema>;

export const createSubordinateAgent = defineTool({
  name: "create_subordinate_agent",
  tool: tool({
    description: "Create a new subordinate agent reporting to you.",
    inputSchema: agentCreateSchema,
  }),

  handler: (ctx, args: Input) => {
    const event: Omit<AgentCreationRequestEvent, "id"> = {
      source: ctx.agent.id,
      target: AGENT_SERVICE_ID,
      topic: "agent",
      type: "agent_creation_request",
      body: args,
    };

    return publish(ctx.bus, event, "agent_creation_response");
  },
});
