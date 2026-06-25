import type { Department, Role } from "../../schema";

import type { ToolName } from "./definitions";
import { definitions } from "./definitions";

const BASE_TOOLS = [
  "request_information",
  "escalate_blocker",
  "search_memory",
  "send_message",
  "update_task_status",
  "wait_until_response",
  "get_status",
  "web_search",
] as const satisfies readonly ToolName[];

const MANAGEMENT_TOOLS = [
  "create_task",
  "assign_task",
  "create_subordinate_agent",
  ...BASE_TOOLS,
] as const satisfies readonly ToolName[];

export const ROLE_TOOLS = {
  worker: ["request_review", ...BASE_TOOLS],
  manager: [...MANAGEMENT_TOOLS],
  head: [...MANAGEMENT_TOOLS],
  executive: ["respond_to_principal", ...MANAGEMENT_TOOLS],
} as const satisfies Record<Role, readonly ToolName[]>;

export const DEPARTMENT_WORKER_TOOLS = {
  organization: [],
  engineering: [],
  research: [],
  marketing: [],
  support: [],
  sales: [],
  legal: [],
} as const satisfies Record<Department, readonly ToolName[]>;

export function toolNamesFor(role: Role, department: Department): ToolName[] {
  return [...ROLE_TOOLS[role], ...DEPARTMENT_WORKER_TOOLS[department]];
}

export const toolSet = Object.fromEntries(
  definitions.map((def) => [def.name, def] as const),
) as {
  [K in (typeof definitions)[number]["name"]]: Extract<
    (typeof definitions)[number],
    { name: K }
  >;
};
