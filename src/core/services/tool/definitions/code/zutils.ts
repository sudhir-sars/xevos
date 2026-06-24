const MAX_OUTPUT = 30_000;

/** Truncate tool output so a single result can't blow the model's context. */
export function clip(text: string): string {
  return text.length > MAX_OUTPUT
    ? `${text.slice(0, MAX_OUTPUT)}\n…[truncated ${text.length - MAX_OUTPUT} chars]`
    : text;
}

const ALLOWED_GIT = new Set([
  "init",
  "config",
  "status",
  "add",
  "commit",
  "diff",
  "log",
  "show",
  "rev-parse",
  "ls-files",
  "branch",
  "blame",
  "describe",
  "shortlog",
  "cat-file",
]);

const GIT_SEGMENT = /\bgit\b([^&|;\n]*)/g;

/**
 * In append-only mode, reject any git subcommand that could rewrite history or
 * leave the agent's own branch. Throws with guidance the model can act on.
 */
export function assertAllowed(command: string): void {
  for (const match of command.matchAll(GIT_SEGMENT)) {
    const args = match[1].trim().split(/\s+/).filter(Boolean);

    let i = 0;
    while (i < args.length && args[i].startsWith("-")) {
      i += args[i] === "-c" || args[i] === "-C" ? 2 : 1;
    }
    const sub = args[i];
    if (!sub) continue;

    if (!ALLOWED_GIT.has(sub)) {
      throw new Error(
        `Blocked: "git ${sub}" is not allowed in append-only mode. ` +
          `Permitted git subcommands: ${[...ALLOWED_GIT].join(", ")}. ` +
          `Stay on your own branch and only add/commit — no checkout, push, reset, rebase, or discarding changes.`,
      );
    }
    if (sub === "commit" && args.includes("--amend")) {
      throw new Error(
        `Blocked: "git commit --amend" rewrites history. Make a new commit instead.`,
      );
    }
  }
}
