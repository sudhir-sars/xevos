import { Department, Role } from "../schema";

const BASE_TOOLS = [
  "request_information",
  "escalate_blocker",
  "search_memory",
  "send_message",
];
export const ROLE_TOOLS = {
  worker: ["update_task_status", "request_review", ...BASE_TOOLS],

  manager: [
    "create_task",
    "assign_task",
    "create_department_worker",
    "get_status",
    ...BASE_TOOLS,
  ],

  head: [
    "create_task",
    "assign_task",
    "create_department_manager",
    "get_status",
    ...BASE_TOOLS,
  ],

  executive: [
    "create_objective",
    "allocate_budget",
    "get_status",
    "create_department_head",
    ...BASE_TOOLS,
  ],
} as const;

export const DEPARTMENT_TOOLS = {
  organization: [
    "organization_directory",
    "organization_metrics",
    "organization_policies",
  ],

  engineering: [
    "code_repository",
    "documentation_store",
    "architecture_store",
    "engineering_knowledge",
  ],

  product: [
    "roadmap_store",
    "requirements_store",
    "analytics",
    "customer_feedback",
  ],

  design: ["design_system", "figma", "design_library", "user_research"],

  marketing: [
    "campaign_store",
    "seo_tools",
    "content_library",
    "market_analytics",
  ],

  sales: ["crm", "lead_database", "email_outreach", "pipeline_analytics"],

  finance: [
    "budget_store",
    "expense_tracker",
    "financial_reports",
    "forecasting",
  ],

  legal: [
    "contract_store",
    "policy_library",
    "compliance_database",
    "legal_research",
  ],

  support: [
    "ticket_system",
    "knowledge_base",
    "customer_history",
    "incident_store",
  ],

  research: ["web_search", "browser", "research_library", "citation_store"],
} as const;

export type RoleTool = (typeof ROLE_TOOLS)[keyof typeof ROLE_TOOLS][number];

export type DepartmentTool =
  (typeof DEPARTMENT_TOOLS)[keyof typeof DEPARTMENT_TOOLS][number];

export type ToolId = RoleTool | DepartmentTool;

export function getAgentTools(role: Role, department: Department): ToolId[] {
  return [...ROLE_TOOLS[role], ...DEPARTMENT_TOOLS[department]];
}
