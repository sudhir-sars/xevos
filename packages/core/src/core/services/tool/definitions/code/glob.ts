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

export const glob = (sandbox: DockerSandbox) =>
  defineTool({
    name: "glob",

    tool: tool({
      description:
        "Find files matching a glob pattern (e.g. '**/*.ts', 'src/*.json'). Supports ** for recursive match.",
      inputSchema,
    }),

    handler: async (_ctx, input: Input) => {
      const { pattern, path } = input;

      const r = await sandbox.exec(
        `shopt -s globstar nullglob; printf '%s\\n' ${pattern}`,
        path,
      );

      return {
        success: true,
        result: clip(r.stdout.trim() || "(no matches)"),
      };
    },
  });
