import { tool } from "ai";
import { z } from "zod";

import { defineTool } from "../../ztypes";
import { DockerSandbox } from "../../../../sandbox";

const inputSchema = z.object({
  path: z.string(),
  content: z.string(),
  overwrite: z
    .boolean()
    .optional()
    .describe("Replace the file if it already exists"),
});

type Input = z.infer<typeof inputSchema>;

export const writeFile = (sandbox: DockerSandbox) =>
  defineTool({
    name: "write_file",

    tool: tool({
      description:
        "Create a NEW file in the sandbox (creates parent directories). Fails if the file already exists — to change an existing file use edit_file or multi_edit instead of rewriting it. Pass overwrite:true only to deliberately replace a whole file.",
      inputSchema,
    }),

    handler: async (_ctx, input: Input) => {
      const { path, content, overwrite } = input;

      const exists =
        (
          await sandbox.exec(`test -e "${path}" && echo 1 || echo 0`)
        ).stdout.trim() === "1";

      if (exists && !overwrite) {
        return {
          success: false,
          error: `${path} already exists. Use edit_file/multi_edit to modify it, or set overwrite:true to replace the whole file.`,
        };
      }

      await sandbox.writeFile(path, content);

      return {
        success: true,
        result: `${exists ? "overwrote" : "created"} ${path} (${content.length} bytes)`,
      };
    },
  });
