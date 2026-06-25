import { Agent } from "../../schema";
import { DockerSandbox } from "../../sandbox";

import { DEPARTMENT_WORKER_TOOLS, ROLE_TOOLS, toolSet } from "./default-tools";
import { codingTools } from "./definitions/code";
import type { ToolDefinition } from "./definitions";

/**
 * Resolves an agent's granted tool names into their full definitions (schema +
 * handler). It only *selects* tools — binding each handler to the agent's
 * context and exposing it as an executable ai-SDK tool is the ToolService's job,
 * so execution stays local to the reasoning loop.
 */
export class ToolRegistry {
  resolve(agent: Agent, sandbox?: DockerSandbox): ToolDefinition[] {
    const names = [
      ...ROLE_TOOLS[agent.role],
      ...DEPARTMENT_WORKER_TOOLS[agent.department],
    ];

    const defs: ToolDefinition[] = [];

    for (const name of names) {
      const def = toolSet[name];

      if (!def) {
        console.error(
          `[ToolRegistry] Tool "${name}" is configured for ${agent.role}/${agent.department} but is not registered`,
        );
        continue;
      }

      defs.push(def);
    }

    // An engineering worker's code tools are factories that close over its
    // sandbox — they carry their own binding, so no extra context is needed.
    if (sandbox) {
      defs.push(...codingTools(sandbox));
    }

    return defs;
  }
}
