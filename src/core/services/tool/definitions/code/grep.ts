import { tool } from "ai";
import { z } from "zod";

import { clip } from "./zutils";
import { defineTool } from "../../ztypes";
import { DockerSandbox } from "../../../../sandbox";

const inputSchema = z.object({
  pattern: z.string(),
  path: z
    .string()
    .optional()
    .describe("Base directory (defaults to /workspace)"),
});

type Input = z.infer<typeof inputSchema>;

export const grep = (sandbox: DockerSandbox) =>
  defineTool({
    name: "grep",

    tool: tool({
      description: "Search file contents with a regular expression (recursive).",
      inputSchema,
    }),

    handler: async (_ctx, input: Input) => {
      const { pattern, path } = input;

      const escaped = pattern.replace(/"/g, '\\"');

      const r = await sandbox.exec(
        `grep -rnE -- "${escaped}" "${path ?? "."}" 2>/dev/null | head -200`,
      );

      return {
        success: true,
        result: clip(r.stdout.trim() || "(no matches)"),
      };
    },
  });
