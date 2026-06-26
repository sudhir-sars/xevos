import { DockerSandbox } from "../../../sandbox";
import { agentDefinitions } from "./agent";
import { taskDefinitions } from "./task";
import { twitterTools } from "./platform/twitter";
import { codingTools } from "./code";

export const definitions = [
  ...agentDefinitions,
  ...taskDefinitions,
  ...twitterTools,
] as const;

export type ToolDefinition =
  | (typeof definitions)[number]
  | ReturnType<typeof codingTools>[number];

export type ToolName = ToolDefinition["name"];

export function createDefinitionMap(
  sandbox?: DockerSandbox,
): Record<ToolName, ToolDefinition> {
  const defs = sandbox
    ? [...definitions, ...codingTools(sandbox)]
    : definitions;

  return Object.fromEntries(
    defs.map((def) => [def.name, def] as const),
  ) as Record<ToolName, ToolDefinition>;
}
