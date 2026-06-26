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
// that can create tasks — and creating one assigns it to a worker atomically
// (create_and_assign_task), so a task is never left ownerless.
const MANAGEMENT_TOOLS = [
  "create_and_assign_task",
  ...STAFFING_TOOLS,
] as const satisfies readonly ToolName[];

export const ROLE_TOOLS = {
  // Only workers do hands-on investigation, so web_search lives here — heads and
  // managers define and delegate rather than researching personally.
  worker: ["request_review", "web_search", ...BASE_TOOLS],
  manager: [...MANAGEMENT_TOOLS],
  head: [...STAFFING_TOOLS],
  executive: ["respond_to_principal", ...STAFFING_TOOLS],
} as const satisfies Record<Role, readonly ToolName[]>;

// Twitter automation, granted by department. Marketing runs the full surface;
// support gets just the customer-response actions.
const TWITTER_TOOLS = [
  "twitter_post",
  "twitter_reply",
  "twitter_dm",
  "twitter_like",
  "twitter_retweet",
  "twitter_quote",
  "twitter_follow",
] as const satisfies readonly ToolName[];

export const DEPARTMENT_WORKER_TOOLS = {
  organization: [],
  engineering: [],
  research: [],
  marketing: [...TWITTER_TOOLS],
  support: ["twitter_reply", "twitter_dm"],
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
