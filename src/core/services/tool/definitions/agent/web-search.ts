import { tool } from "ai";
import { z } from "zod";

import { rationale, defineTool } from "../../ztypes";

const inputSchema = z.object({ query: z.string(), rationale });

export const webSearch = defineTool({
  name: "web_search",
  tool: tool({
    description: "Search the web for information.",
    inputSchema,
  }),

  handler: () => {
    return {
      success: false,
      error: "web search is not connected yet",
    };
  },
});
