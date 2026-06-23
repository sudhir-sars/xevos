import type { AgentId } from "./agent.schema";

export type TaskId = `task_${number}`;

export type TaskStatus =
  | "backlog"
  | "assigned"
  | "in_progress"
  | "blocked"
  | "in_review"
  | "completed"
  | "failed"
  | "cancelled";

export type ClosedReason = "completed" | "failed" | "cancelled";

export type TaskPriority = "low" | "normal" | "high" | "urgent";

export type ReviewVerdict = "approved" | "changes_requested";

export interface Review {
  reviewer: AgentId;
  verdict: ReviewVerdict;
  notes: string;
}

export interface TaskBudget {
  maxTokens: number;
  maxUsd: number;
}

export interface Task {
  id: TaskId;
  status: TaskStatus;
  referceTask: TaskId[] | null;
  review: Review | null;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  dependencies: TaskId[];
  assignedTo: AgentId | null;
  priority: TaskPriority;
  deadline: number | null;
  budget: TaskBudget;
  createdAt: number;
  updatedAt: number;
}

export type MutableTask = Pick<
  Task,
  "status" | "review" | "assignedTo" | "priority" | "deadline"
>;

export type TaskCreate = Pick<
  Task,
  | "referceTask"
  | "title"
  | "description"
  | "acceptanceCriteria"
  | "dependencies"
  | "priority"
  | "deadline"
  | "budget"
>;
