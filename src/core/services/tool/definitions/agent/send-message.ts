import { tool } from "ai";
import { z } from "zod";

import type { AgentId, AgentMessageEvent } from "../../../../schema";
import { publish, agentId, rationale, defineTool } from "../../ztypes";

const inputSchema = z.object({ agentId, content: z.string(), rationale });

type Input = z.infer<typeof inputSchema>;

export const sendMessage = defineTool({
  name: "send_message",
  tool: tool({
    description: "Send a direct message to another agent.",
    inputSchema,
  }),

  handler: (ctx, args: Input) => {
    const event: Omit<AgentMessageEvent, "id"> = {
      source: ctx.agent.id,
      target: args.agentId as AgentId,
      topic: "agent",
      type: "message",
      body: {
        content: args.content,
      },
    };

    return publish(ctx.bus, event);
  },
});
