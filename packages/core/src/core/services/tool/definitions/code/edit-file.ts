import { tool } from "ai";
import { z } from "zod";

import { defineTool } from "../../ztypes";
import { DockerSandbox } from "../../../../sandbox";

const inputSchema = z.object({
  path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

type Input = z.infer<typeof inputSchema>;

export const editFile = (sandbox: DockerSandbox) =>
  defineTool({
    name: "edit_file",

    tool: tool({
      description:
        "Replace an exact string in an existing file. old_string must be unique unless replace_all is true.",
      inputSchema,
    }),

    handler: async (_ctx, input: Input) => {
      const { path, old_string, new_string, replace_all } = input;

      const content = await sandbox.readFile(path);
      const matches = content.split(old_string).length - 1;

      if (matches === 0) {
        return {
          success: false,
          error: `old_string not found in ${path}`,
        };
      }

      if (matches > 1 && !replace_all) {
        return {
          success: false,
          error: `old_string is not unique in ${path} (${matches} matches); add more context or set replace_all`,
        };
      }

      const updated = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string);

      await sandbox.writeFile(path, updated);

      return {
        success: true,
        result: `edited ${path} (${matches} replacement${matches > 1 ? "s" : ""})`,
      };
    },
  });
