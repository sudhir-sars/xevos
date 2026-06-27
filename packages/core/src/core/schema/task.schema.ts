import { z } from "zod";

import { agentIdSchema } from "./agent.schema";



export type TaskId =
  | `TASK-${number}`                          // head level
  | `TASK-${number}.${number}`                // manager level
  | `TASK-${number}.${number}.${number}`;     // worker level

export const taskIdSchema = z
  .string()
  .refine(
    (value): value is TaskId =>
      /^TASK-\d+(\.\d+){0,2}$/.test(value),
    { message: "Invalid task id — expected TASK-1 up to TASK-1.1.1" }
  );


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
  verdict: reviewVerdictSchema,
  notes: z.string(),
});

export type Review = z.infer<typeof reviewSchema>;

export const taskBudgetSchema = z.object({
  max_tokens: z.number().int().nonnegative(),
});

export type TaskBudget = z.infer<typeof taskBudgetSchema>;

export const taskSchema = z.object({
  id: taskIdSchema,
  status: taskStatusSchema,
  // Tolerant of fabricated ids: an LLM often invents a placeholder like
  // "task_initialization" before any real task exists. Rather than failing the
  // whole create_and_assign_task call, drop anything that isn't a valid task id.
  referceTask: z.array(taskIdSchema).catch([]).nullable(),
  review: reviewSchema.nullable(),
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  dependencies: z.array(taskIdSchema).catch([]),
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
  assignedTo: true,
  deadline: true,
  budget: true,
});

export type TaskCreate = z.infer<typeof taskCreateSchema>;
