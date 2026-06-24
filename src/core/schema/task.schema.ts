import { z } from "zod";

import { agentIdSchema } from "./agent.schema";

export const taskIdSchema = z
  .string()
  .transform((value, ctx): `task_${number}` => {
    if (!/^task_\d+$/.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid task id",
      });

      return z.NEVER;
    }

    return value as `task_${number}`;
  });

export type TaskId = z.infer<typeof taskIdSchema>;

export const taskStatusSchema = z.enum([
  "backlog",
  "assigned",
  "in_progress",
  "blocked",
  "in_review",
  "completed",
  "failed",
  "cancelled",
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const closedReasonSchema = z.enum(["completed", "failed", "cancelled"]);

export type ClosedReason = z.infer<typeof closedReasonSchema>;

export const taskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const reviewVerdictSchema = z.enum(["approved", "changes_requested"]);

export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

export const reviewSchema = z.object({
  reviewer: agentIdSchema,
  verdict: reviewVerdictSchema,
  notes: z.string(),
});

export type Review = z.infer<typeof reviewSchema>;

export const taskBudgetSchema = z.object({
  maxTokens: z.number().int().nonnegative(),
  maxUsd: z.number().nonnegative(),
});

export type TaskBudget = z.infer<typeof taskBudgetSchema>;

export const taskSchema = z.object({
  id: taskIdSchema,
  status: taskStatusSchema,
  referceTask: z.array(taskIdSchema).nullable(),
  review: reviewSchema.nullable(),
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  dependencies: z.array(taskIdSchema),
  assignedTo: agentIdSchema.nullable(),
  priority: taskPrioritySchema,
  deadline: z.number().nullable(),
  budget: taskBudgetSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Task = z.infer<typeof taskSchema>;

export const mutableTaskSchema = taskSchema.pick({
  status: true,
  review: true,
  assignedTo: true,
  priority: true,
  deadline: true,
});

export type MutableTask = z.infer<typeof mutableTaskSchema>;

export const taskCreateSchema = taskSchema.pick({
  referceTask: true,
  title: true,
  description: true,
  acceptanceCriteria: true,
  dependencies: true,
  priority: true,
  deadline: true,
  budget: true,
});

export type TaskCreate = z.infer<typeof taskCreateSchema>;
