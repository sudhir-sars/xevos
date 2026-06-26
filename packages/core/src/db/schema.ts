import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { ModelMessage } from "ai";
import type {
  AgentId,
  Department,
  Learning,
  ReportTargetId,
  Review,
  Role,
  TaskBudget,
  TaskId,
  TaskPriority,
  TaskStatus,
  AgentStatus,
  ClosedReason,
} from "../core/schema";

/**
 * Embedding width for memory-warehouse vectors. Matches Google's
 * text-embedding-004 / gemini-embedding default; change here AND in the
 * vec0 virtual table (see db/client.ts) if you swap embedding models.
 */
export const EMBEDDING_DIMS = 768;

const now = () => sql`(unixepoch('subsec') * 1000)`;

/** JSON column helper: stored as TEXT, (de)serialized by Drizzle. */
function json<T>(name: string) {
  return text(name, { mode: "json" }).$type<T>();
}

// ---- Org roster (was AgentRepository) ----
export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey().$type<AgentId>(), // readable id
    role: text("role").$type<Role>().notNull(),
    department: text("department").$type<Department>().notNull(),
    objective: text("objective").notNull(),
    kpis: json<string[]>("kpis").notNull(),
    responsibilities: json<string[]>("responsibilities").notNull(),
    manages: json<AgentId[]>("manages").notNull(),
    reportsTo: text("reports_to").$type<ReportTargetId>().notNull(),
    tools: json<string[]>("tools").notNull(),
    status: text("status").$type<AgentStatus>().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("agents_by_status").on(t.status),
    index("agents_by_reports_to").on(t.reportsTo),
  ],
);

// ---- Tasks (was TaskRepository) ----
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey().$type<TaskId>(), // readable id
    status: text("status").$type<TaskStatus>().notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    acceptanceCriteria: json<string[]>("acceptance_criteria").notNull(),
    referceTask: json<TaskId[] | null>("referce_task"),
    dependencies: json<TaskId[]>("dependencies").notNull(),
    assignedTo: text("assigned_to").$type<AgentId>(),
    priority: text("priority").$type<TaskPriority>().notNull(),
    deadline: integer("deadline"),
    budget: json<TaskBudget>("budget").notNull(),
    review: json<Review | null>("review"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("tasks_by_assigned_to").on(t.assignedTo),
    index("tasks_by_status").on(t.status),
  ],
);

// ---- Per-agent working memory (was AgentMemoryRepository) ----
export const agentMemories = sqliteTable("agent_memories", {
  agentId: text("agent_id").primaryKey().$type<AgentId>(),
  messages: json<ModelMessage[]>("messages").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// ---- Long-term cross-task learnings (was MemoryWarehouseRepository) ----
// The embedding lives in the `vec_memory` virtual table (db/client.ts), keyed by
// this row's integer `rowid`. BM25/Qdrant recall is replaced by sqlite-vec KNN.
export const memoryWarehouse = sqliteTable(
  "memory_warehouse",
  {
    rowid: integer("rowid").primaryKey({ autoIncrement: true }),
    memoryId: text("memory_id").notNull().$type<`memory_${number}`>(),
    taskId: text("task_id").$type<TaskId>().notNull(),
    agentId: text("agent_id").$type<AgentId>().notNull(),
    outcome: text("outcome").$type<ClosedReason>().notNull(),
    learning: json<Learning>("learning").notNull(),
    messages: json<ModelMessage[]>("messages").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("warehouse_by_memory_id").on(t.memoryId),
    index("warehouse_by_agent").on(t.agentId),
    index("warehouse_by_task").on(t.taskId),
  ],
);

// ---- Editable role/department prompts (was PromptRepository) ----
export const prompts = sqliteTable("prompts", {
  key: text("key").primaryKey(), // "role:executive" | "department:research"
  content: text("content").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// ---- Append-only event log: the observability projection ----
export const events = sqliteTable(
  "events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    source: text("source").notNull(),
    target: text("target").notNull(),
    topic: text("topic").notNull(),
    type: text("type").notNull(),
    body: json<unknown>("body"),
    correlationId: text("correlation_id"),
    createdAt: integer("created_at")
      .notNull()
      .default(now()),
  },
  (t) => [
    index("events_by_target").on(t.target),
    index("events_by_topic").on(t.topic),
  ],
);

// ---- Durable per-recipient work queue (replaces in-memory mailboxes) ----
export const inbox = sqliteTable(
  "inbox",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    target: text("target").notNull(),
    event: json<unknown>("event").notNull(),
    status: text("status").$type<"pending" | "consumed">().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("inbox_by_target_status").on(t.target, t.status)],
);

// ---- Readable-id allocation (was the in-repo counter maps) ----
export const counters = sqliteTable("counters", {
  key: text("key").primaryKey(),
  value: integer("value").notNull(),
});

// ---- Platform watcher cursors: the "seen so far" marker per synthetic webhook,
//      so each poll only surfaces genuinely new activity (and survives restarts).
export const platformCursors = sqliteTable("platform_cursors", {
  // `${platform}:${account}:${watcher}`
  key: text("key").primaryKey(),
  cursor: text("cursor"),
  updatedAt: integer("updated_at").notNull(),
});
