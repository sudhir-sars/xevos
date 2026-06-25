import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc } from "./_generated/dataModel";

/**
 * EXEMPLAR module — the AgentRepository ported to Convex.
 *
 * This is the canonical pattern every repository port follows: queries for
 * reads (reactive — the dashboard and the runtime can subscribe), mutations for
 * transactional writes (no more lost-update races). The runtime calls these via
 * the generated `api.agents.*` references behind the existing `AgentRepository`
 * interface, so services don't change shape.
 *
 * NOTE: `./_generated/server` and `./_generated/dataModel` are produced by
 * `npx convex dev`; until you run it locally these imports won't resolve and
 * this file won't typecheck. That is expected for a fresh Convex project.
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

// ---- Reads ----

export const get = query({
  args: { agentId: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, { agentId }): Promise<Doc<"agents"> | null> => {
    return await ctx.db
      .query("agents")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .unique();
  },
});

export const list = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx): Promise<Doc<"agents">[]> => {
    return await ctx.db.query("agents").collect();
  },
});

export const listByStatus = query({
  args: {
    status: v.union(
      v.literal("active"),
      v.literal("suspended"),
      v.literal("terminated"),
    ),
  },
  returns: v.array(v.any()),
  handler: async (ctx, { status }): Promise<Doc<"agents">[]> => {
    return await ctx.db
      .query("agents")
      .withIndex("by_status", (q) => q.eq("status", status))
      .collect();
  },
});

// ---- Writes ----

/**
 * Allocate the next readable id for a (role, department) and insert the agent,
 * atomically. Replaces the non-atomic "increment counter, push, write" path in
 * lowdb that could duplicate ids on a crash.
 */
export const create = mutation({
  args: {
    role,
    department,
    objective: v.string(),
    kpis: v.array(v.string()),
    responsibilities: v.array(v.string()),
    reportsTo: v.string(),
    manages: v.array(v.string()),
    tools: v.array(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("suspended"),
      v.literal("terminated"),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Doc<"agents">> => {
    const counterKey = `${args.role}_${args.department}`;
    const existing = await ctx.db
      .query("counters")
      .withIndex("by_key", (q) => q.eq("key", counterKey))
      .unique();

    const next = (existing?.value ?? 0) + 1;
    if (existing) {
      await ctx.db.patch(existing._id, { value: next });
    } else {
      await ctx.db.insert("counters", { key: counterKey, value: next });
    }

    const agentId = `${args.role}_${args.department}_${next}`;
    const _id = await ctx.db.insert("agents", {
      agentId,
      ...args,
      createdAt: Date.now(),
    });

    const doc = await ctx.db.get(_id);
    if (!doc) throw new Error(`failed to read back agent ${agentId}`);
    return doc;
  },
});

export const update = mutation({
  args: {
    agentId: v.string(),
    patch: v.object({
      manages: v.optional(v.array(v.string())),
      status: v.optional(
        v.union(
          v.literal("active"),
          v.literal("suspended"),
          v.literal("terminated"),
        ),
      ),
      tools: v.optional(v.array(v.string())),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { agentId, patch }): Promise<Doc<"agents">> => {
    const doc = await ctx.db
      .query("agents")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .unique();
    if (!doc) throw new Error(`unknown agent ${agentId}`);

    await ctx.db.patch(doc._id, patch);
    const updated = await ctx.db.get(doc._id);
    if (!updated) throw new Error(`failed to read back agent ${agentId}`);
    return updated;
  },
});

export const remove = mutation({
  args: { agentId: v.string() },
  returns: v.null(),
  handler: async (ctx, { agentId }): Promise<null> => {
    const doc = await ctx.db
      .query("agents")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .unique();
    if (doc) await ctx.db.delete(doc._id);
    return null;
  },
});
