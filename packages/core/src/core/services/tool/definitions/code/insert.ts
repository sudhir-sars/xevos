import { tool } from "ai";
import { z } from "zod";

import { defineTool } from "../../ztypes";
import { DockerSandbox } from "../../../../sandbox";

const inputSchema = z.object({
  path: z.string(),
  content: z
    .string()
    .describe("The new code/text to insert (include newlines)"),
  anchor: z
    .string()
    .optional()
    .describe("A unique existing string to position relative to"),
  position: z
    .enum(["before", "after"])
    .default("after")
    .describe(
      "Insert before or after the anchor (or prepend/append if no anchor)",
    ),
});

type Input = z.infer<typeof inputSchema>;

export const insert = (sandbox: DockerSandbox) =>
  defineTool({
    name: "insert",

    tool: tool({
      description:
        "Insert new content into a file relative to a unique anchor string, WITHOUT repeating the anchor or rewriting the file. Use to add a function, import, route, etc. Include your own newlines in content. If anchor is omitted, content is appended (or prepended) to the file.",
      inputSchema,
    }),

    handler: async (_ctx, input: Input) => {
      const { path, content, anchor, position = "after" } = input;

      const file = await sandbox.readFile(path);

      if (!anchor) {
        const updated =
          position === "before" ? `${content}${file}` : `${file}${content}`;

        await sandbox.writeFile(path, updated);

        return {
          success: true,
          result: `${position === "before" ? "prepended" : "appended"} ${content.length} bytes to ${path}`,
        };
      }

      const matches = file.split(anchor).length - 1;

      if (matches === 0) {
        return {
          success: false,
          error: `anchor not found in ${path}`,
        };
      }

      if (matches > 1) {
        return {
          success: false,
          error: `anchor not unique in ${path} (${matches} matches); add more context to the anchor`,
        };
      }

      const replacement =
        position === "after" ? `${anchor}${content}` : `${content}${anchor}`;

      await sandbox.writeFile(path, file.replace(anchor, replacement));

      return {
        success: true,
        result: `inserted ${content.length} bytes ${position} anchor in ${path}`,
      };
    },
  });
