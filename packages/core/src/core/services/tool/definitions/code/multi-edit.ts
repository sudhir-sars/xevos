import { tool } from "ai";
import { z } from "zod";

import { defineTool } from "../../ztypes";
import { DockerSandbox } from "../../../../sandbox";

const inputSchema = z.object({
  path: z.string(),
  edits: z
    .array(
      z.object({
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean().optional(),
      }),
    )
    .min(1),
});

type Input = z.infer<typeof inputSchema>;

export const multiEdit = (sandbox: DockerSandbox) =>
  defineTool({
    name: "multi_edit",

    tool: tool({
      description:
        "Apply several exact-string edits to ONE file in a single call, in order (cheaper than multiple edit_file calls). Edits are applied sequentially in memory and written once — if any edit fails, none are applied. Each old_string must be unique unless replace_all is set.",
      inputSchema,
    }),

    handler: async (_ctx, input: Input) => {
      const { path, edits } = input;

      let content = await sandbox.readFile(path);

      for (const [i, edit] of edits.entries()) {
        const matches = content.split(edit.old_string).length - 1;

        if (matches === 0) {
          return {
            success: false,
            error: `edit #${i + 1}: old_string not found in ${path}`,
          };
        }

        if (matches > 1 && !edit.replace_all) {
          return {
            success: false,
            error: `edit #${i + 1}: old_string not unique (${matches} matches); add context or set replace_all`,
          };
        }

        content = edit.replace_all
          ? content.split(edit.old_string).join(edit.new_string)
          : content.replace(edit.old_string, edit.new_string);
      }

      await sandbox.writeFile(path, content);

      return {
        success: true,
        result: `applied ${edits.length} edit${edits.length > 1 ? "s" : ""} to ${path}`,
      };
    },
  });
