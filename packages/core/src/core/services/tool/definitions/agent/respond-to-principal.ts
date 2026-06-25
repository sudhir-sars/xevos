import { tool } from "ai";
import { z } from "zod";

import { rationale, defineTool, citations, renderCitations } from "../../ztypes";

const inputSchema = z.object({ message: z.string(), citations, rationale });

type Input = z.infer<typeof inputSchema>;

export const respondToPrincipal = defineTool({
  name: "respond_to_principal",
  tool: tool({
    description:
      "Reply to the human principal who is interacting with the organization.",
    inputSchema,
  }),

  handler: (ctx, args: Input) => {
    ctx.principalSink(
      ctx.agent.id,
      `${args.message}${renderCitations(args.citations)}`,
    );

    return {
      success: true,
      result: {
        delivered: true,
      },
    };
  },
});
