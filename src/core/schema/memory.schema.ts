import type { ModelMessage } from "ai";

import { AgentId } from "./agent.schema";
import { ClosedReason, TaskId } from "./task.schema";

export interface AgentMemory {
  agentId: AgentId;
  messages: ModelMessage[];
  updatedAt: number;
}

export interface Learning {
  summary: string;
  keyFindings: string[];
  decisions: string[];
  lessonsLearned: string[];
}

export type MemoryWarehouseId = `memory_${number}`;

export interface MemoryWarehouse {
  id: MemoryWarehouseId;
  taskId: TaskId;
  agentId: AgentId;
  outcome: ClosedReason;
  learning: Learning;
  messages: ModelMessage[];
  createdAt: number;
}
