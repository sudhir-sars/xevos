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

// Leaders (executive, head) staff the next tier and delegate by handing down an
// objective with send_message. They CANNOT create or assign tasks — only the
// manager tier owns a task board. This is what prevents the same objective from
// being re-minted as a near-duplicate task at every level on the way down.
const STAFFING_TOOLS = [
  "create_subordinate_agent",
  ...BASE_TOOLS,
] as const satisfies readonly ToolName[];

// A manager additionally owns its initiative's task board: it is the only tier
// that can create tasks and assign them to the workers that execute them.
const MANAGEMENT_TOOLS = [
  "create_task",
  "assign_task",
  ...STAFFING_TOOLS,
] as const satisfies readonly ToolName[];

export const ROLE_TOOLS = {
  worker: ["request_review", ...BASE_TOOLS],
  manager: [...MANAGEMENT_TOOLS],
  head: [...STAFFING_TOOLS],
  executive: ["respond_to_principal", ...STAFFING_TOOLS],
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
