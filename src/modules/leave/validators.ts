import { z } from "zod";

/**
 * Shared by the API and the forms, like every other module: a field absent
 * from the schema cannot reach the database whatever the client sends
 * (docs/09-security.md §3).
 */

export const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const yearSchema = z.coerce.number().int().min(2000).max(2100);

export const idParamSchema = z.object({ id: z.string().uuid() });

// ─────────────────────────────────────────────── holidays

export const createHolidaySchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(120),
  holidayDate: dateOnlySchema,
  /** Null means company-wide, which is the common case. */
  locationId: z.string().uuid().nullish(),
  isOptional: z.coerce.boolean().default(false),
});
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

export const updateHolidaySchema = createHolidaySchema.partial();
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;

export const holidayListSchema = z.object({
  year: yearSchema,
  locationId: z.string().uuid().optional(),
});
export type HolidayListInput = z.infer<typeof holidayListSchema>;

// ─────────────────────────────────────────────── leave types

/** Codes reach reports and exports, so keep them boring. */
export const leaveCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, "At least 2 characters")
  .max(20)
  .regex(/^[A-Z0-9_-]+$/, "Letters, numbers, hyphen and underscore only");

export const createLeaveTypeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: leaveCodeSchema,
  isPaid: z.coerce.boolean().default(true),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #C95A12")
    .nullish(),
  requiresAttachment: z.coerce.boolean().default(false),
});
export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;

export const updateLeaveTypeSchema = createLeaveTypeSchema.partial();
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;

// ─────────────────────────────────────────────── policies

/**
 * Bounds mirror the CHECK constraints in the migration. Validation looser than
 * the constraint turns a 422 into a 500.
 */
export const upsertPolicySchema = z
  .object({
    accrualFrequency: z.enum(["monthly", "yearly", "none"]).default("none"),
    accrualAmount: z.coerce.number().min(0).max(999.99).default(0),
    maxCarryForward: z.coerce.number().min(0).max(999.99).default(0),
    maxNegative: z.coerce.number().min(0).max(999.99).default(0),
    minNoticeDays: z.coerce.number().int().min(0).max(365).default(0),
    maxConsecutiveDays: z.coerce.number().int().min(1).max(365).nullish(),
    applicableAfterProbation: z.coerce.boolean().default(false),
    sandwichRule: z.coerce.boolean().default(false),
  })
  .refine((v) => v.accrualFrequency === "none" || v.accrualAmount > 0, {
    message: "An accruing policy has to accrue something",
    path: ["accrualAmount"],
  });
export type UpsertPolicyInput = z.infer<typeof upsertPolicySchema>;

// ─────────────────────────────────────────────── requests

export const createLeaveRequestSchema = z
  .object({
    leaveTypeId: z.string().uuid(),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    halfDay: z.enum(["none", "first_half", "second_half"]).default("none"),
    reason: z.string().trim().min(5, "Say why").max(1000),
    attachmentKey: z.string().trim().max(255).nullish(),
  })
  .refine((v) => Date.parse(v.endDate) >= Date.parse(v.startDate), {
    message: "The end date cannot be before the start date",
    path: ["endDate"],
  })
  .refine((v) => v.halfDay === "none" || v.startDate === v.endDate, {
    message: "Half a day only applies to a single-day request",
    path: ["halfDay"],
  });
export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>;

export const leaveReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().max(1000).nullish(),
});
export type LeaveReviewInput = z.infer<typeof leaveReviewSchema>;

export const leaveListSchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
  scope: z.enum(["mine", "team", "all"]).default("mine"),
  year: yearSchema.optional(),
});
export type LeaveListInput = z.infer<typeof leaveListSchema>;

export const balanceQuerySchema = z.object({
  year: yearSchema,
  employeeId: z.string().uuid().optional(),
});
export type BalanceQueryInput = z.infer<typeof balanceQuerySchema>;

/** HR credit or debit. The reason is not optional — an unexplained
 *  adjustment is indistinguishable from a mistake six months later. */
export const adjustBalanceSchema = z.object({
  employeeId: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  year: yearSchema,
  /** Positive credits, negative debits. */
  days: z.coerce
    .number()
    .min(-999)
    .max(999)
    .refine((v) => v !== 0, "Adjust by something"),
  reason: z.string().trim().min(5, "Say why").max(500),
});
export type AdjustBalanceInput = z.infer<typeof adjustBalanceSchema>;
