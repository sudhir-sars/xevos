export type Role = "executive" | "head" | "manager" | "worker";

export type Department =
  | "organization"
  | "engineering"
  | "product"
  | "design"
  | "marketing"
  | "sales"
  | "finance"
  | "legal"
  | "support"
  | "research";

export type AgentStatus = "active" | "suspended";

export type AgentKind = "operator" | "reviewer";

export type ToolName = string;

export type RoleDefinitionId = `${Role}_${Department}`;

export type AgentId = `${RoleDefinitionId}_${number}`;

export type SystemPromptRef = `prompts_${Role}_${Department}.md`;

export interface Agent {
  id: AgentId;
  role: Role;
  department: Department;
  kind: AgentKind;
  createdAt: number;
  objective: string;
  kpis: string[];
  responsibilities: string[];
  status: AgentStatus;
  systemPromptRef: SystemPromptRef;
  reportsTo: AgentId | null;
  manages: AgentId[];
  tools: ToolName[];
}
