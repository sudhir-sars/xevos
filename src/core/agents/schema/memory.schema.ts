import { AgentId, Department } from "./agent.schema";
import { ClosedReason, TaskId } from "./task.schema";

type MessageRole = "system" | "agent" | "tool" | "inbound";

type MessagePart =
  | { type: "text"; text: string }
  | {
      type: "tool_call";
      id: string;
      tool: string;
      action: string;
      args: Record<string, unknown>;
    }
  | { type: "tool_result"; callId: string; ok: boolean; output: unknown } // links to the call's id
  | { type: "artifact"; ref: string; mime: string; label?: string }
  | { type: "agent_message"; from: AgentId; kind: string; body: string };

interface Message {
  id: string;
  role: MessageRole;
  parts: MessagePart[];
  createdAt: number;
}

interface WorkingMemory {
  owner: AgentId;
  taskId: TaskId;
  messages: Message[];
}

interface WarehouseRecord {
  id: string;
  taskId: TaskId;
  department: Department;
  owner: AgentId;
  messages: Message[];
  summary: string;
  closedReason: ClosedReason;
  closedAt: number;
}
