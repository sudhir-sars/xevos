import { tool } from "ai";
import { z, type ZodTypeAny } from "zod";

import { defineTool, rationale, type ToolResult } from "../../ztypes";

/**
 * Build a static tool that drives a live platform connector's action. The tool
 * name is fixed (so roles can grant it and ToolName stays exact); at call time
 * it finds the connector in the registry and runs the named action. If the
 * platform isn't connected, it returns a clean error instead of throwing.
 */
function platformTool<const TName extends string, S extends ZodTypeAny>(
  platform: string,
  name: TName,
  description: string,
  inputSchema: S,
  toActionInput: (args: z.infer<S>) => unknown,
) {
  return defineTool<TName, z.infer<S>>({
    name,
    direct: true, // outward action applied directly; emits an observation
    tool: tool({ description, inputSchema }),
    handler: async (ctx, args): Promise<ToolResult> => {
      const connector = ctx.connectors?.get(platform);
      if (!connector) {
        return {
          success: false,
          error: `${platform} is not connected — configure the account, run the Obscura engine, and capture a session`,
        };
      }
      const action = connector.actions.find((a) => a.name === name);
      if (!action) {
        return { success: false, error: `action ${name} is unavailable` };
      }
      try {
        return { success: true, result: await action.run(toActionInput(args)) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}

const target = z
  .string()
  .describe("The target tweet's full URL or numeric status id.");
const text = z.string().describe("The message text.");

export const twitterTools = [
  platformTool(
    "twitter",
    "twitter_post",
    "Publish a tweet from the org's connected account.",
    z.object({ text, rationale }),
    (a) => ({ text: a.text }),
  ),
  platformTool(
    "twitter",
    "twitter_reply",
    "Reply to a tweet (by URL or status id).",
    z.object({ target, text, rationale }),
    (a) => ({ target: a.target, text: a.text }),
  ),
  platformTool(
    "twitter",
    "twitter_dm",
    "Send a direct message to a handle.",
    z.object({
      to: z.string().describe("Recipient handle, without the @."),
      text,
      rationale,
    }),
    (a) => ({ to: a.to, text: a.text }),
  ),
  platformTool(
    "twitter",
    "twitter_like",
    "Like a tweet.",
    z.object({ target, rationale }),
    (a) => ({ target: a.target }),
  ),
  platformTool(
    "twitter",
    "twitter_retweet",
    "Repost (retweet) a tweet.",
    z.object({ target, rationale }),
    (a) => ({ target: a.target }),
  ),
  platformTool(
    "twitter",
    "twitter_quote",
    "Quote-tweet: repost a tweet with a comment.",
    z.object({ target, text, rationale }),
    (a) => ({ target: a.target, text: a.text }),
  ),
  platformTool(
    "twitter",
    "twitter_follow",
    "Follow a handle.",
    z.object({
      handle: z.string().describe("Handle to follow, without the @."),
      rationale,
    }),
    (a) => ({ handle: a.handle }),
  ),
] as const;
