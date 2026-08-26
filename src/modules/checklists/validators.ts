import { z } from "zod";

import { queryBoolean } from "@/lib/validation";

/**
 * What may be said to the checklist endpoints.
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Not a real date");

export const checklistKinds = ["onboarding", "offboarding"] as const;
export const checklistAssignees = ["hr", "it", "manager", "employee"] as const;

export const idParamSchema = z.object({ id: z.string().uuid() });

const templateTaskFields = {
  title: z.string().trim().min(1, "Required").max(160),
  description: z.string().trim().max(2000).nullish(),
  assignee: z.enum(checklistAssignees),
  /** Negative lands before the anchor — hand the laptop back before the last day. */
  dueOffsetDays: z.coerce.number().int().min(-365).max(365).default(0),
  isRequired: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
};

export const templateTaskSchema = z.object(templateTaskFields);

export const createTemplateSchema = z.object({
  kind: z.enum(checklistKinds),
  name: z.string().trim().min(1, "Required").max(120),
  description: z.string().trim().max(2000).nullish(),
  isDefault: z.boolean().default(false),
  /**
   * The tasks arrive with the template.
   *
   * A checklist with no tasks is a name and nothing else, and one saved in
   * that state would sit in the picker waiting to disappoint somebody.
   */
  tasks: z.array(templateTaskSchema).min(1, "Add at least one task"),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullish(),
  isDefault: z.boolean().optional(),
  tasks: z.array(templateTaskSchema).min(1, "Add at least one task").optional(),
});
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export const listTemplatesSchema = z.object({ kind: z.enum(checklistKinds).optional() });
export type ListTemplatesInput = z.infer<typeof listTemplatesSchema>;

export const startChecklistSchema = z.object({
  templateId: z.string().uuid().nullish(),
  /**
   * Optional override for the date everything counts from. Defaults to the
   * join date going in, the last working day coming out.
   */
  anchorDate: dateOnly.nullish(),
  /** Whoever handles IT tasks in this company; there is no such role. */
  itEmployeeId: z.string().uuid().nullish(),
});
export type StartChecklistInput = z.infer<typeof startChecklistSchema>;

export const completeTaskSchema = z.object({
  status: z.enum(["completed", "skipped"]),
  /** Required when skipping; a checklist skipped in silence is theatre. */
  skipReason: z.string().trim().max(500).nullish(),
});
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;

export const listTasksSchema = z.object({
  kind: z.enum(checklistKinds).optional(),
  employeeId: z.string().uuid().optional(),
  mine: queryBoolean.optional(),
  pendingOnly: queryBoolean.optional(),
});
export type ListTasksInput = z.infer<typeof listTasksSchema>;

export const resignSchema = z.object({
  /** HR may file on somebody's behalf; an employee files for themselves. */
  employeeId: z.string().uuid().nullish(),
  reason: z.string().trim().min(1, "Say why").max(2000),
  requestedLastWorkingDay: dateOnly,
});
export type ResignInput = z.infer<typeof resignSchema>;

export const confirmExitSchema = z.object({
  /** HR's say on the date. Notice periods get waived; the computed day is a default. */
  lastWorkingDay: dateOnly.nullish(),
  templateId: z.string().uuid().nullish(),
  itEmployeeId: z.string().uuid().nullish(),
});
export type ConfirmExitInput = z.infer<typeof confirmExitSchema>;

export const settlementSchema = z.object({
  leaveEncashmentDays: z.coerce.number().min(0).max(999).nullish(),
  settlementNotes: z.string().trim().max(2000).nullish(),
});
export type SettlementInput = z.infer<typeof settlementSchema>;

export const cancelExitSchema = z.object({
  cancellationReason: z.string().trim().min(1, "Say why").max(2000),
});
export type CancelExitInput = z.infer<typeof cancelExitSchema>;

export const listExitsSchema = z.object({
  status: z
    .enum(["initiated", "in_progress", "cleared", "settled", "completed", "cancelled"])
    .optional(),
  /**
   * Only the caller's own.
   *
   * Scope alone is not enough: HR can see every exit in the company, so a
   * screen asking "have I resigned" would otherwise be handed somebody
   * else's resignation and show it as theirs.
   */
  mine: queryBoolean.optional(),
});
export type ListExitsInput = z.infer<typeof listExitsSchema>;
