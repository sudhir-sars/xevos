import { tool } from "ai";
import { z } from "zod";

import { rationale, defineTool } from "../../ztypes";

const inputSchema = z.object({ rationale });

export const waitUntilResponse = defineTool({
  name: "wait_until_response",
  tool: tool({
    description:
      "Idle: take no action and wait for inbound events after delegating work.",
    inputSchema,
  }),

  handler: () => {
    return {
      success: true,
      result: {
        status: "idle",
      },
    };
  },
});
