import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { ModelMessage } from "ai";
import type {
  ActorId,
  AgentId,
  ClosedReason,
  Department,
  Event,
  EventType,
  Learning,
  Review,
  Role,
  TaskId,
  TaskPriority,
  TaskStatus,
  AgentStatus,
} from "../core/schema";



export const EMBEDDING_DIMS = 768;

const now = () => sql`(unixepoch('subsec') * 1000)`;

function json<T>(name: string) {
  return text(name, { mode: "json" }).$type<T>();
}

/*
 * All actors in the system — orchestrators(human/meta-agent), CEO, heads, managers, and workers.
 *
 * role and department are null for orchestrator and CEO since they
 * operate above the role-department hierarchy.
 */
export const actors = sqliteTable(
  "actors",
  {
    actor_id: text("actor_id").$type<ActorId>().primaryKey(),
    role: text("role").$type<Role>(),
    department: text("department").$type<Department>(),
    manages: json<AgentId[]>("manages").notNull(),
    reports_to: text("reports_to").$type<ActorId>().notNull(),
    tools: json<string[]>("tools").notNull(),
    status: text("status").$type<AgentStatus>().notNull(),
    created_at: integer("created_at").notNull().default(now()),
    updated_at: integer("updated_at").notNull().default(now()),
  },
  (t) => [
    index("actors_by_status").on(t.status),
    index("actors_by_reports_to").on(t.reports_to),
  ],
);

/*
 * All tasks in the system.
 *
 * task_id encodes the hierarchy — TASK-1 is a head-level task,
 * TASK-1.1 is a manager-level task, TASK-1.1.1 is a worker-level task.
 * Parent is derivable by stripping the last segment from task_id.
 */
export const tasks = sqliteTable(
  "tasks",
  {
    task_id: text("task_id").$type<TaskId>().primaryKey(),
    title: text("title").notNull(),
    status: text("status").$type<TaskStatus>().notNull(),
    description: text("description").notNull(),
    acceptance_criteria: json<string[]>("acceptance_criteria").notNull(),
    context_tasks: json<TaskId[]>("context_tasks"),
    dependencies: json<TaskId[]>("dependencies").notNull(),
    assigned_to: text("assigned_to").$type<ActorId>().references(() => actors.actor_id),
    priority: text("priority").$type<TaskPriority>().notNull(),
    review: json<Review | null>("review"),
    created_at: integer("created_at").notNull().default(now()),
    updated_at: integer("updated_at").notNull().default(now()),
  },
  (t) => [
    index("tasks_by_assigned_to").on(t.assigned_to),
    index("tasks_by_status").on(t.status),
  ],
);

/*
 * Per-agent working memory.
 *
 * Stores the short-term conversation history for each agent scoped
 * to a task. Pruning follows the role hierarchy:
 *
 *   worker/manager — pruned on task close after distillation into long_term_memory.
 *   head/ceo       — pruned on task close after distillation into long_term_memory.
 *   orchestrator   — never pruned; summarized periodically into long_term_memory.
 *
 * task_id is nullable to accommodate event-driven interactions
 * (escalations, information requests) that have no formal task scope.
 */
export const agent_memories = sqliteTable(
  "agent_memories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    agent_id: text("agent_id").$type<ActorId>().notNull().references(() => actors.actor_id),
    task_id: text("task_id").$type<TaskId>().references(() => tasks.task_id),
    message: json<ModelMessage>("message").notNull(),
    created_at: integer("created_at").notNull().default(now()),
  },
  (t) => [
    index("agent_memories_by_agent_task").on(t.agent_id, t.task_id),
  ],
);

/*
 * Long-term memory store for agent learnings.
 *
 * Each row captures the distilled outcome of a completed task —
 * what happened, how it closed, and what was learned. Embeddings
 * for KNN recall are stored in the vec_memory virtual table,
 * keyed by this row's id.
 */
export const long_term_memory = sqliteTable(
  "long_term_memory",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    task_id: text("task_id").$type<TaskId>().notNull().references(() => tasks.task_id),
    closed_as: text("closed_as").$type<ClosedReason>().notNull(),
    learning: json<Learning>("learning").notNull(),
    created_at: integer("created_at").notNull().default(now()),
  },
  (t) => [
    index("long_term_memory_by_task").on(t.task_id),
  ],
);

/*
 * Canonical log of all system events.
 *
 * Append-only record of everything that happens in the system —
 * escalations, delegations, and information requests/responses.
 * agent_inbox references these rows for inter-agent delivery tracking.
 */
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull().references(() => actors.actor_id),
    type: text("type").$type<EventType>().notNull(),
    payload: json<Event>("payload"),
    parent_event_id: integer("parent_event_id").references((): any => events.id),
    created_at: integer("created_at").notNull().default(now()),
  },
  (t) => [
    index("events_by_source").on(t.source),
    index("events_by_type").on(t.type),
  ],
);

/*
 * Agent inbox — delivery queue for inter-agent events.
 *
 * One row per (event, target) pair. An event stays pending until
 * the target agent consumes it, then marked consumed. The event
 * payload lives in the events table; this table is pure routing.
 */
export const agent_inbox = sqliteTable(
  "agent_inbox",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    target: text("target").notNull().references(() => actors.actor_id),
    source: text("source").notNull().references(() => actors.actor_id),
    event_id: integer("event_id").notNull().references(() => events.id),
    status: text("status").$type<"pending" | "consumed">().notNull().default("pending"),
    updated_at: integer("updated_at").notNull().default(now()),
    created_at: integer("created_at").notNull().default(now()),
  },
  (t) => [
    index("inbox_by_target_status").on(t.target, t.status),
  ],
);