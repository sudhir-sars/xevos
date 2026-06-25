import { z } from "zod";

export const roleSchema = z.enum(["executive", "head", "manager", "worker"]);

export type Role = z.infer<typeof roleSchema>;

export const departmentSchema = z.enum([
  "organization",
  "engineering",
  "research",
  "marketing",
  "support",
  "sales",
  "legal",
]);

export type Department = z.infer<typeof departmentSchema>;

export const agentStatusSchema = z.enum(["active", "suspended"]);

export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const roleDefinitionIdSchema = z
  .string()
  .refine(
    (value): value is `${Role}_${Department}` =>
      roleSchema.options.some((role) =>
        departmentSchema.options.some(
          (department) => value === `${role}_${department}`,
        ),
      ),
    { message: "Invalid role definition id" },
  );

export const principalIdSchema = z.literal("principal");
export type PrincipalId = z.infer<typeof principalIdSchema>;

export type RoleDefinitionId = z.infer<typeof roleDefinitionIdSchema>;

export const agentIdSchema = z.string().refine(
  (value): value is `${Role}_${Department}_${number}` => {
    const match = value.match(/_(\d+)$/);

    if (!match) return false;

    const prefix = value.slice(0, value.length - match[0].length);

    return roleSchema.options.some((role) =>
      departmentSchema.options.some(
        (department) => prefix === `${role}_${department}`,
      ),
    );
  },
  { message: "Invalid agent id" },
);

export type AgentId = z.infer<typeof agentIdSchema>;

export const reportTargetIdSchema = z.union([agentIdSchema, principalIdSchema]);
export type ReportTargetId = z.infer<typeof reportTargetIdSchema>;
export const agentSchema = z.object({
  id: agentIdSchema,
  role: roleSchema,
  department: departmentSchema,
  createdAt: z.number(),
  objective: z.string(),
  kpis: z.array(z.string()),
  responsibilities: z.array(z.string()),
  status: agentStatusSchema,
  reportsTo: reportTargetIdSchema,
  manages: z.array(agentIdSchema),
  tools: z.array(z.string()),
});

export const agentCreateSchema = agentSchema.pick({
  role: true,
  department: true,
  objective: true,
  kpis: true,
  responsibilities: true,
  reportsTo: true,
  tools: true,
  manages: true,
  status: true,
});

export type AgentCreate = z.infer<typeof agentCreateSchema>;

/**
 * What a creator actually DECIDES when spawning a subordinate: nothing, except
 * — for the executive only — which department the new head belongs to. The role
 * is fixed by the ladder (each level spawns the one below it), and everything
 * else (objective, kpis, responsibilities, tools, reporting line, status) is
 * STATIC and set by the system. So a non-executive passes no input at all, and
 * an agent's identity can never drift with the task that spawned it.
 */
export const agentSpawnSchema = z.object({
  department: departmentSchema
    .optional()
    .describe(
      "Executive only: the department for the new head. Omit it otherwise — subordinates inherit your department.",
    ),
});

export type AgentSpawn = z.infer<typeof agentSpawnSchema>;
export type Agent = z.infer<typeof agentSchema>;
