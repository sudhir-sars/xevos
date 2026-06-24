import { tool } from "ai";
import { z } from "zod";

import { DockerSandbox } from "../../../../sandbox";
import { defineTool } from "../../ztypes";
import { clip } from "./zutils";

const inputSchema = z.object({
  command: z.string().describe("The bash command to run"),
  cwd: z
    .string()
    .optional()
    .describe("Working directory (defaults to /workspace)"),
});

type Input = z.infer<typeof inputSchema>;

export const bash = (sandbox: DockerSandbox) =>
  defineTool({
    name: "bash",
    tool: tool({
      description:
        "Run a bash command inside the sandbox container (install deps, build, run tests, git, etc.). Returns exit code, stdout and stderr.",
      inputSchema,
    }),

    handler: async (_ctx, input: Input) => {
      const r = await sandbox.exec(input.command, input.cwd);

      return {
        success: true,
        result: clip(
          `exit=${r.exitCode}\n[stdout]\n${r.stdout}\n[stderr]\n${r.stderr}`,
        ),
      };
    },
  });
