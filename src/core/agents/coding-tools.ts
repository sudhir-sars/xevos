import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { DockerSandbox } from "../sandbox";

const MAX_OUTPUT = 30_000;

function clip(text: string): string {
  return text.length > MAX_OUTPUT
    ? `${text.slice(0, MAX_OUTPUT)}\n…[truncated ${text.length - MAX_OUTPUT} chars]`
    : text;
}

/**
 * Claude-Code-style tools, scoped to a single sandbox container.
 *
 * Each tool's `execute` runs against the bound DockerSandbox, so the AI SDK's
 * multi-step loop (see EngineeringWorker) drives real filesystem + bash work.
 */
export function createCodingTools(sandbox: DockerSandbox): ToolSet {
  return {
    bash: tool({
      description:
        "Run a bash command inside the sandbox container (install deps, build, run tests, git, etc.). Returns exit code, stdout and stderr.",
      inputSchema: z.object({
        command: z.string().describe("The bash command to run"),
        cwd: z
          .string()
          .optional()
          .describe("Working directory (defaults to /workspace)"),
      }),
      execute: async ({ command, cwd }) => {
        const r = await sandbox.exec(command, cwd);
        return clip(
          `exit=${r.exitCode}\n[stdout]\n${r.stdout}\n[stderr]\n${r.stderr}`,
        );
      },
    }),

    read_file: tool({
      description: "Read a file from the sandbox. Returns content with line numbers.",
      inputSchema: z.object({
        path: z.string().describe("File path (relative to /workspace or absolute)"),
      }),
      execute: async ({ path }) => {
        const content = await sandbox.readFile(path);
        const numbered = content
          .split("\n")
          .map((line, i) => `${i + 1}\t${line}`)
          .join("\n");
        return clip(numbered);
      },
    }),

    write_file: tool({
      description:
        "Write (create or overwrite) a file in the sandbox. Creates parent directories.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async ({ path, content }) => {
        await sandbox.writeFile(path, content);
        return `wrote ${path} (${content.length} bytes)`;
      },
    }),

    edit_file: tool({
      description:
        "Replace an exact string in an existing file. old_string must be unique unless replace_all is true.",
      inputSchema: z.object({
        path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean().optional(),
      }),
      execute: async ({ path, old_string, new_string, replace_all }) => {
        const content = await sandbox.readFile(path);
        const matches = content.split(old_string).length - 1;

        if (matches === 0) {
          throw new Error(`old_string not found in ${path}`);
        }
        if (matches > 1 && !replace_all) {
          throw new Error(
            `old_string is not unique in ${path} (${matches} matches); add more context or set replace_all`,
          );
        }

        const updated = replace_all
          ? content.split(old_string).join(new_string)
          : content.replace(old_string, new_string);

        await sandbox.writeFile(path, updated);
        return `edited ${path} (${matches} replacement${matches > 1 ? "s" : ""})`;
      },
    }),

    list_dir: tool({
      description: "List the contents of a directory.",
      inputSchema: z.object({
        path: z.string().optional().describe("Directory (defaults to /workspace)"),
      }),
      execute: async ({ path }) => {
        const r = await sandbox.exec(`ls -la "${path ?? "."}"`);
        return clip(r.stdout || r.stderr || "(empty)");
      },
    }),

    glob: tool({
      description:
        "Find files matching a glob pattern (e.g. '**/*.ts', 'src/*.json'). Supports ** for recursive match.",
      inputSchema: z.object({
        pattern: z.string(),
        path: z.string().optional().describe("Base directory (defaults to /workspace)"),
      }),
      execute: async ({ pattern, path }) => {
        const r = await sandbox.exec(
          `shopt -s globstar nullglob; printf '%s\\n' ${pattern}`,
          path,
        );
        return clip(r.stdout.trim() || "(no matches)");
      },
    }),

    grep: tool({
      description: "Search file contents with a regular expression (recursive).",
      inputSchema: z.object({
        pattern: z.string(),
        path: z.string().optional().describe("Base directory (defaults to /workspace)"),
      }),
      execute: async ({ pattern, path }) => {
        const escaped = pattern.replace(/"/g, '\\"');
        const r = await sandbox.exec(
          `grep -rnE -- "${escaped}" "${path ?? "."}" 2>/dev/null | head -200`,
        );
        return clip(r.stdout.trim() || "(no matches)");
      },
    }),
  };
}
