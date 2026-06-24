import { z } from "zod";

export const roleSchema = z.enum(["executive", "head", "manager", "worker"]);

export type Role = z.infer<typeof roleSchema>;

export const departmentSchema = z.enum([
  "organization",
  "engineering",
  "product",
  "design",
  "marketing",
  "sales",
  "finance",
  "legal",
  "support",
  "research",
]);

export type Department = z.infer<typeof departmentSchema>;

export const agentStatusSchema = z.enum(["active", "suspended"]);

export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const roleDefinitionIdSchema = z.string().refine(
  (value): value is `${Role}_${Department}` => {
    const [role, department] = value.split("_");

    return (
      roleSchema.options.includes(role as Role) &&
      departmentSchema.options.includes(department as Department)
    );
  },
  { message: "Invalid role definition id" },
);

export const principalIdSchema = z.literal("principal");
export type PrincipalId = z.infer<typeof principalIdSchema>;

export type RoleDefinitionId = z.infer<typeof roleDefinitionIdSchema>;

export const agentIdSchema = z.string().refine(
  (value): value is `${Role}_${Department}_${number}` => {
    const parts = value.split("_");

    if (parts.length !== 3) {
      return false;
    }

    const [role, department, id] = parts;

    return (
      roleSchema.options.includes(role as Role) &&
      departmentSchema.options.includes(department as Department) &&
      /^\d+$/.test(id)
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
export type Agent = z.infer<typeof agentSchema>;
