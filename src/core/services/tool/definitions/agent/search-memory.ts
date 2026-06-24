import { tool } from "ai";
import { z } from "zod";

import { rationale, defineTool } from "../../ztypes";

const inputSchema = z.object({
  query: z.string().describe("What to recall from memory"),
  rationale,
});

type Input = z.infer<typeof inputSchema>;

export const searchMemory = defineTool({
  name: "search_memory",
  tool: tool({
    description: "Recall relevant learnings from memory/past task events.",
    inputSchema,
  }),

  handler: async (ctx, args: Input) => {
    const results = await ctx.memory.recall(args.query);

    return {
      success: true,
      result: {
        query: args.query,
        results,
      },
    };
  },
});
