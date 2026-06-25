import { and, asc, desc, eq, getTableColumns, gt, lt, or, sql } from "drizzle-orm";

import type {
  AgentStatus,
  Role,
  Task,
  TaskStatus,
} from "../core/schema";
import { getDb, getSqlite } from "../db/client";
import { events, tasks } from "../db/schema";

import type {
  Message,
  OrgStats,
  OrgState,
  Page,
  PromptsSnapshot,
} from "./protocol";
import { PROTOCOL_VERSION } from "./protocol";
import type { SnapshotSources } from "./snapshot";

/** Aggregate stats: agent roster (in memory, small) + SQL counts for the rest. */
export function buildOrgState(sources: SnapshotSources): OrgState {
  const agents = sources.agents.list();
  const prompts = sources.prompts.all() as PromptsSnapshot;

  const byRole: Partial<Record<Role, number>> = {};
  const byStatus: Partial<Record<AgentStatus, number>> = {};
  let activeWorkers = 0;
  for (const a of agents) {
    byRole[a.role] = (byRole[a.role] ?? 0) + 1;
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    if (a.status === "active" && a.role === "worker") activeWorkers++;
  }

  const taskRows = getSqlite()
    .prepare("SELECT status, count(*) AS c FROM tasks GROUP BY status")
    .all() as { status: TaskStatus; c: number }[];
  const tasksByStatus: Partial<Record<TaskStatus, number>> = {};
  let taskTotal = 0;
  for (const r of taskRows) {
    tasksByStatus[r.status] = r.c;
    taskTotal += r.c;
  }

  const queueDepth =
    (
      getSqlite()
        .prepare("SELECT count(*) AS c FROM inbox WHERE status = 'pending'")
        .get() as { c: number }
    ).c ?? 0;

  const stats: OrgStats = {
    agents: agents.length,
    activeAgents: byStatus.active ?? 0,
    activeWorkers,
    byRole,
    byStatus,
    tasks: taskTotal,
    runningTasks: tasksByStatus.in_progress ?? 0,
    tasksByStatus,
    queueDepth,
  };

  return {
    protocolVersion: PROTOCOL_VERSION,
    capturedAt: Date.now(),
    agents,
    prompts,
    stats,
  };
}

/**
 * A page of tasks, newest first, cursored by the table's implicit rowid —
 * unique and monotonic with insertion order, so tasks created within the same
 * millisecond (a manager batch-creating tasks) are never skipped by a tie.
 */
export function pageTasks(before: number | null, limit: number): Page<Task> {
  const db = getDb();
  const rows = db
    .select({ ...getTableColumns(tasks), _rowid: sql<number>`rowid` })
    .from(tasks)
    .where(before === null ? undefined : sql`rowid < ${before}`)
    .orderBy(sql`rowid desc`)
    .limit(limit)
    .all();

  const items = rows.map(({ _rowid, ...task }) => task as Task);
  return {
    items,
    nextCursor: rows.length < limit ? null : rows[rows.length - 1]._rowid,
  };
}

/** Tasks changed since a watermark (ascending updatedAt) — the upsert delta. */
export function tasksChangedSince(watermark: number): Task[] {
  return getDb()
    .select()
    .from(tasks)
    .where(gt(tasks.updatedAt, watermark))
    .orderBy(asc(tasks.updatedAt))
    .all();
}

/** A page of conversation messages, newest first, cursored by events.seq. */
export function pageMessages(before: number | null, limit: number): Page<Message> {
  const db = getDb();
  const where = and(
    eq(events.type, "message"),
    or(eq(events.source, "principal"), eq(events.target, "principal")),
    before === null ? undefined : lt(events.seq, before),
  );

  const rows = db
    .select()
    .from(events)
    .where(where)
    .orderBy(desc(events.seq))
    .limit(limit)
    .all();

  return {
    items: rows.map(messageFromRow),
    nextCursor: rows.length < limit ? null : rows[rows.length - 1].seq,
  };
}

type EventRow = typeof events.$inferSelect;

function messageFromRow(row: EventRow): Message {
  const content =
    (row.body as { content?: unknown } | null)?.content;
  return {
    id: `event_${row.seq}` as Message["id"],
    seq: row.seq,
    ts: row.createdAt,
    from: row.source,
    to: row.target,
    outgoing: row.source === "principal",
    content: typeof content === "string" ? content : "",
  };
}
