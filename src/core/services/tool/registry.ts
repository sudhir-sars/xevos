import { ToolSet } from "ai";

import { Agent } from "../../schema";
import { DockerSandbox } from "../../sandbox";

import { DEPARTMENT_WORKER_TOOLS, ROLE_TOOLS, toolSet } from "./default-tools";
import { codingTools } from "./definitions/code";
export class ToolRegistry {
  getTools(agent: Agent, sandbox?: DockerSandbox): ToolSet {
    const names = [
      ...ROLE_TOOLS[agent.role],
      ...DEPARTMENT_WORKER_TOOLS[agent.department],
    ];

    const tools: ToolSet = {};

    for (const name of names) {
      const toolDef = toolSet[name];

      if (!toolDef) {
        console.error(
          `[ToolRegistry] Tool "${name}" is configured for ${agent.role}/${agent.department} but is not registered`,
        );
        continue;
      }

      tools[name] = toolDef.tool;
    }

    if (sandbox) {
      for (const def of codingTools(sandbox)) {
        tools[def.name] = def.tool;
      }
    }

    return tools;
  }
}
