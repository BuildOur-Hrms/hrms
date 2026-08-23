import { z } from "zod";

/**
 * Shared by the API and the forms, like every other module: a field absent
 * from the schema cannot reach the database whatever the client sends
 * (docs/09-security.md §3).
 */

export const taskStatusSchema = z.enum(["not_started", "in_progress", "completed", "cancelled"]);

const period = {
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
};

/**
 * `origin` is deliberately not accepted from the client.
 *
 * Whether a task was assigned or self-added is decided by who is creating it
 * for whom — putting it in the body would let anyone mark their own additions
 * as company-assigned, which is the one thing the split exists to prevent.
 */
export const createTaskSchema = z.object({
  /** Omitted means "for me". Naming somebody else is an assignment. */
  employeeId: z.string().uuid().optional(),
  title: z.string().trim().min(3, "Say what the task is").max(160),
  description: z.string().trim().max(2000).nullish(),
  weight: z.coerce.number().int().min(1).max(100).default(1),
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .nullish(),
  ...period,
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/**
 * Everything about a task is editable except who it belongs to and where it
 * came from. Moving a task between people would silently rewrite two months
 * of history; deleting and re-adding it says so out loud.
 */
export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(3).max(160).optional(),
    description: z.string().trim().max(2000).nullish(),
    weight: z.coerce.number().int().min(1).max(100).optional(),
    progress: z.coerce.number().int().min(0).max(100).optional(),
    status: taskStatusSchema.optional(),
    dueDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .nullish(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: "Nothing to change",
  });
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const listTasksSchema = z.object({
  ...period,
  /** Omitted means the caller's own list. */
  employeeId: z.string().uuid().optional(),
});
export type ListTasksInput = z.infer<typeof listTasksSchema>;

/** The board: everyone the caller may see, for one month. */
export const boardSchema = z.object({
  ...period,
  scope: z.enum(["team", "all"]).default("team"),
  departmentId: z.string().uuid().optional(),
  /** How many months of history the trend covers, counting back from this one. */
  months: z.coerce.number().int().min(1).max(12).default(6),
});
export type BoardInput = z.infer<typeof boardSchema>;

export const idParamSchema = z.object({ id: z.string().uuid() });
