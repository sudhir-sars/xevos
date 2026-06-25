import { tool } from "ai";
import { z } from "zod";

import type {
  ReviewPresentationRequestEvent,
  TaskId,
} from "../../../../schema";
import { publish, rationale, taskId, defineTool } from "../../ztypes";

const inputSchema = z.object({ taskId, summary: z.string(), rationale });

type Input = z.infer<typeof inputSchema>;

export const requestReview = defineTool({
  name: "request_review",

  tool: tool({
    description: "Submit completed work for review.",
    inputSchema,
  }),

  handler: (ctx, args: Input) => {
    const event: Omit<ReviewPresentationRequestEvent, "id"> = {
      source: ctx.agent.id,
      target: ctx.agent.reportsTo,
      topic: "agent",
      type: "review_presentation_request",
      body: {
        summary: args.summary,
        taskId: (args.taskId ?? null) as TaskId | null,
      },
    };

    return publish(ctx.bus, event);
  },
});
