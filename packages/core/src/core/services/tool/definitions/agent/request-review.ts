import { tool } from "ai";
import { z } from "zod";

import type {
  ReviewPresentationRequestEvent,
  TaskId,
} from "../../../../schema";
import { publish, rationale, taskId, defineTool } from "../../ztypes";
import { AUDITOR_ID } from "../../../audit";

const inputSchema = z.object({
  taskId,
  summary: z
    .string()
    .describe("What you built and how it satisfies each acceptance criterion."),
  evidence: z
    .string()
    .describe(
      "Concrete proof the work is done: the exact commands you ran and their real output (tests passing, build succeeding, the server's actual responses). A summary without command output is not evidence and will be rejected.",
    ),
  rationale,
});

type Input = z.infer<typeof inputSchema>;

export const requestReview = defineTool({
  name: "request_review",

  tool: tool({
    description: "Submit completed work for review.",
    inputSchema,
  }),

  handler: (ctx, args: Input) => {
    // Review is owned by the standalone, independent Auditor — not the producing
    // team and not anyone in the org hierarchy.
    const event: Omit<ReviewPresentationRequestEvent, "id"> = {
      source: ctx.agent.id,
      target: AUDITOR_ID,
      topic: "agent",
      type: "review_presentation_request",
      body: {
        summary: `${args.summary}\n\nEvidence:\n${args.evidence}`,
        taskId: (args.taskId ?? null) as TaskId | null,
      },
    };

    return publish(ctx.bus, event, "review_presentation_response");
  },
});
