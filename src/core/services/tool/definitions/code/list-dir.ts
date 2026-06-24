import { tool } from "ai";
import { z } from "zod";

import { clip } from "./zutils";
import { defineTool } from "../../ztypes";
import { DockerSandbox } from "../../../../sandbox";

const inputSchema = z.object({
  path: z.string().optional().describe("Directory (defaults to /workspace)"),
});

type Input = z.infer<typeof inputSchema>;

export const listDir = (sandbox: DockerSandbox) =>
  defineTool({
    name: "list_dir",

    tool: tool({
      description: "List the contents of a directory.",
      inputSchema,
    }),

    handler: async (_ctx, input: Input) => {
      const { path } = input;

      const r = await sandbox.exec(`ls -la "${path ?? "."}"`);

      return {
        success: true,
        result: clip(r.stdout || r.stderr || "(empty)"),
      };
    },
  });
