import { z } from "zod";

/**
 * What may be said to the payroll endpoints.
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Not a real date");

/** Whole minor units. A fraction of a paise is not a thing. */
const minor = z.coerce.number().int().min(0).max(1_000_000_000);

export const idParamSchema = z.object({ id: z.string().uuid() });

export const componentSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(1)
      .max(20)
      .regex(/^[A-Z0-9_]+$/, "Letters, numbers and underscore only"),
    name: z.string().trim().min(1, "Required").max(80),
    kind: z.enum(["earning", "deduction"]),
    calcType: z.enum(["fixed", "percentage"]).default("fixed"),
    baseComponentId: z.string().uuid().nullish(),
    prorates: z.boolean().default(true),
    sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  })
  .refine((v) => v.calcType !== "percentage" || !!v.baseComponentId, {
    message: "A percentage of what?",
    path: ["baseComponentId"],
  });
export type ComponentInput = z.infer<typeof componentSchema>;

export const salaryItemSchema = z
  .object({
    componentId: z.string().uuid(),
    amountMinor: minor.nullish(),
    percent: z.coerce.number().min(0).max(100).nullish(),
  })
  .refine((v) => (v.amountMinor == null) !== (v.percent == null), {
    message: "Give an amount or a percentage, not both",
    path: ["amountMinor"],
  });

export const assignSalarySchema = z.object({
  effectiveFrom: dateOnly,
  note: z.string().trim().max(500).nullish(),
  /**
   * The whole salary at once.
   *
   * A revision is a new set of lines, not an edit to the old one — that is
   * what makes last month's payslip still explicable next year.
   */
  items: z.array(salaryItemSchema).min(1, "A salary needs at least one component"),
});
export type AssignSalaryInput = z.infer<typeof assignSalarySchema>;

export const createRunSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  note: z.string().trim().max(500).nullish(),
});
export type CreateRunInput = z.infer<typeof createRunSchema>;

export const listRunsSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  status: z.enum(["draft", "approved", "paid"]).optional(),
});
export type ListRunsInput = z.infer<typeof listRunsSchema>;

export const runStatusSchema = z.object({ status: z.enum(["approved", "paid"]) });
export type RunStatusInput = z.infer<typeof runStatusSchema>;

export const listPayslipsSchema = z.object({
  runId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  mine: z.coerce.boolean().optional(),
});
export type ListPayslipsInput = z.infer<typeof listPayslipsSchema>;
