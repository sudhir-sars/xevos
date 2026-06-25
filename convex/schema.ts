import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The xevos data model, ported from the lowdb repositories to Convex.
 *
 * Design notes:
 * - We keep the system's READABLE ids (e.g. "executive_organization_1",
 *   "task_1") as explicit string fields, because agents reference each other by
 *   those ids in prompts and event bodies. Convex's own `_id` stays internal.
 *   The `counters` table reproduces the per-(role|department) id allocation.
 * - Opaque LLM payloads (chat messages, event bodies) are stored as `v.any()`:
 *   they are model-shaped blobs we persist and replay, not data we query into.
 * - `events` is the append-only projection that REPLACES the EventBus broadcast
 *   + the WebSocket observer: the dashboard subscribes to it via a reactive
 *   query. `inbox` is the durable per-agent work queue that replaces in-memory
 *   mailbox delivery (so a crash no longer drops in-flight work).
 */

const role = v.union(
  v.literal("executive"),
  v.literal("head"),
  v.literal("manager"),
  v.literal("worker"),
);

const department = v.union(
  v.literal("organization"),
  v.literal("engineering"),
  v.literal("research"),
  v.literal("marketing"),
  v.literal("support"),
  v.literal("sales"),
  v.literal("legal"),
);

const agentStatus = v.union(
  v.literal("active"),
  v.literal("suspended"),
  v.literal("terminated"),
);

const taskStatus = v.union(
  v.literal("pending"),
  v.literal("in_progress"),
  v.literal("in_review"),
  v.literal("completed"),
  v.literal("blocked"),
  v.literal("cancelled"),
);

const reviewVerdict = v.union(
  v.literal("approved"),
  v.literal("changes_requested"),
);

export default defineSchema({
  // ---- Org roster (was AgentRepository / agents.json) ----
  agents: defineTable({
    agentId: v.string(), // readable id, e.g. "manager_research_1"
    role,
    department,
    objective: v.string(),
    kpis: v.array(v.string()),
    responsibilities: v.array(v.string()),
    manages: v.array(v.string()), // readable agent ids
    reportsTo: v.string(), // "principal" or a readable agent id
    tools: v.array(v.string()),
    status: agentStatus,
    createdAt: v.number(),
  })
    .index("by_agentId", ["agentId"])
    .index("by_status", ["status"])
    .index("by_reportsTo", ["reportsTo"]),

  // ---- Tasks (was TaskRepository) ----
  tasks: defineTable({
    taskId: v.string(), // readable id, e.g. "task_1"
    title: v.string(),
    description: v.string(),
    parent: v.optional(v.string()),
    assignedTo: v.optional(v.string()),
    createdBy: v.string(), // the manager that owns the task
    acceptanceCriteria: v.array(v.string()),
    dependencies: v.array(v.string()),
    status: taskStatus,
    budget: v.object({ maxTokens: v.number(), maxUsd: v.number() }),
    review: v.object({
      auditor: v.optional(v.string()),
      verdict: v.optional(reviewVerdict),
      notes: v.optional(v.string()),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_taskId", ["taskId"])
    .index("by_assignedTo", ["assignedTo"])
    .index("by_status", ["status"])
    .index("by_parent", ["parent"]),

  // ---- Per-agent working memory (was AgentMemoryRepository) ----
  agentMemories: defineTable({
    agentId: v.string(),
    messages: v.array(v.any()), // ModelMessage[] blobs
    updatedAt: v.number(),
  }).index("by_agentId", ["agentId"]),

  // ---- Long-term, cross-task learnings (was MemoryWarehouseRepository) ----
  // BM25/Qdrant recall is replaced by Convex's native vector search: store an
  // embedding of the learning and query it with a vectorIndex.
  memoryWarehouse: defineTable({
    taskId: v.string(),
    agentId: v.string(),
    outcome: v.string(),
    learning: v.object({
      summary: v.string(),
      keyFindings: v.array(v.string()),
      decisions: v.array(v.string()),
      lessonsLearned: v.array(v.string()),
    }),
    messages: v.array(v.any()),
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
  })
    .index("by_taskId", ["taskId"])
    .index("by_agentId", ["agentId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      // text-embedding-004 / gemini-embedding default; adjust to your model.
      dimensions: 768,
      filterFields: ["agentId", "outcome"],
    }),

  // ---- Editable role/department/auditor prompts (was PromptRepository) ----
  prompts: defineTable({
    key: v.string(), // e.g. "role:executive", "department:research", "auditor"
    content: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // ---- Append-only event log: the observability projection (replaces the
  //      EventBus broadcast + WebSocket observer). The dashboard subscribes. ----
  events: defineTable({
    source: v.string(),
    target: v.string(),
    topic: v.string(),
    type: v.string(),
    body: v.any(),
    correlationId: v.optional(v.string()),
  })
    .index("by_target", ["target"])
    .index("by_topic", ["topic"]),
  // ordering comes from the built-in _creationTime; no manual seq needed.

  // ---- Durable per-recipient work queue (replaces in-memory mailboxes) ----
  inbox: defineTable({
    target: v.string(), // agent id or service id
    event: v.any(), // the full Event envelope to process
    status: v.union(v.literal("pending"), v.literal("consumed")),
    createdAt: v.number(),
  }).index("by_target_status", ["target", "status"]),

  // ---- Readable-id allocation (was the in-repo `counters` maps) ----
  counters: defineTable({
    key: v.string(), // e.g. "manager_research"
    value: v.number(),
  }).index("by_key", ["key"]),
});
