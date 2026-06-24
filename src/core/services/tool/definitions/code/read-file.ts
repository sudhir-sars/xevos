import { tool } from "ai";
import { z } from "zod";

import { clip } from "./zutils";
import { defineTool } from "../../ztypes";
import { DockerSandbox } from "../../../../sandbox";

const inputSchema = z.object({
  path: z.string().describe("File path (relative to /workspace or absolute)"),
});

type Input = z.infer<typeof inputSchema>;

export const readFile = (sandbox: DockerSandbox) =>
  defineTool({
    name: "read_file",

    tool: tool({
      description:
        "Read a file from the sandbox. Returns content with line numbers.",
      inputSchema,
    }),

    handler: async (_ctx, input: Input) => {
      const { path } = input;

      const content = await sandbox.readFile(path);

      const numbered = content
        .split("\n")
        .map((line, i) => `${i + 1}\t${line}`)
        .join("\n");

      return {
        success: true,
        result: clip(numbered),
      };
    },
  });
