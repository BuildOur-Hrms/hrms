import { z } from "zod";

/**
 * Shared by the API and the forms, like every other module: a field absent
 * from the schema cannot reach the database whatever the client sends
 * (docs/09-security.md §3).
 */

export const punchDirectionSchema = z.enum(["in", "out"]);

/**
 * `source` is deliberately not accepted from the client. A web caller can only
 * ever create a `web` punch — letting the body choose would let anyone label
 * their own punch `biometric` and make it look like it came from a device.
 * Manual entry by HR is a separate endpoint with its own permission.
 */
export const punchSchema = z.object({
  direction: punchDirectionSchema,
  note: z.string().trim().max(255).nullish(),
});
export type PunchInput = z.infer<typeof punchSchema>;

/** `YYYY-MM-DD`, the calendar date in the employee's own timezone. */
export const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const dayQuerySchema = z.object({
  date: dateOnlySchema.optional(),
});
export type DayQueryInput = z.infer<typeof dayQuerySchema>;

/**
 * A calendar month. The year floor is not arbitrary — it rejects the `0` that
 * arrives when a client sends an empty string, which would otherwise query
 * two thousand years of empty days.
 */
export const monthQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});
export type MonthQueryInput = z.infer<typeof monthQuerySchema>;

export const idParamSchema = z.object({ id: z.string().uuid() });

/** ISO-8601 instant, e.g. `2026-08-20T09:00:00.000Z`. */
const instantSchema = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Not a valid date and time");

/**
 * A correction has to ask for something. The database enforces this too; the
 * check here is what turns it into a 422 with a readable message rather than a
 * constraint violation.
 */
export const correctionRequestSchema = z
  .object({
    workDate: dateOnlySchema,
    requestedIn: instantSchema.nullish(),
    requestedOut: instantSchema.nullish(),
    requestedStatus: z
      .enum(["present", "absent", "half_day", "on_leave", "holiday", "week_off"])
      .nullish(),
    reason: z.string().trim().min(5, "Say what needs correcting").max(1000),
  })
  .refine((v) => v.requestedIn != null || v.requestedOut != null || v.requestedStatus != null, {
    message: "Ask for a time or a status",
    path: ["requestedIn"],
  })
  .refine(
    (v) =>
      v.requestedIn == null ||
      v.requestedOut == null ||
      Date.parse(v.requestedOut) >= Date.parse(v.requestedIn),
    { message: "Check-out cannot be before check-in", path: ["requestedOut"] },
  );
export type CorrectionRequestInput = z.infer<typeof correctionRequestSchema>;

export const correctionReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().max(1000).nullish(),
});
export type CorrectionReviewInput = z.infer<typeof correctionReviewSchema>;

/**
 * HR entering a day on somebody's behalf.
 *
 * Deliberately the same shape as a correction request plus the employee: a
 * manual entry *is* a correction, it just skips the asking. Keeping the shapes
 * aligned is what lets both end up in the same table and be read back the same
 * way.
 */
export const manualEntrySchema = z
  .object({
    employeeId: z.string().uuid(),
    workDate: dateOnlySchema,
    checkIn: instantSchema.nullish(),
    checkOut: instantSchema.nullish(),
    status: z.enum(["present", "absent", "half_day", "on_leave", "holiday", "week_off"]).nullish(),
    reason: z.string().trim().min(5, "Say why this day is being entered by hand").max(1000),
  })
  .refine((v) => v.checkIn != null || v.checkOut != null || v.status != null, {
    message: "Enter a time or a status",
    path: ["checkIn"],
  })
  .refine(
    (v) =>
      v.checkIn == null || v.checkOut == null || Date.parse(v.checkOut) >= Date.parse(v.checkIn),
    { message: "Check-out cannot be before check-in", path: ["checkOut"] },
  );
export type ManualEntryInput = z.infer<typeof manualEntrySchema>;

export const correctionListSchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
  /** `mine` is own requests; `team` is what this caller can act on. */
  scope: z.enum(["mine", "team"]).default("mine"),
});
export type CorrectionListInput = z.infer<typeof correctionListSchema>;

export const lockListSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});
export type LockListInput = z.infer<typeof lockListSchema>;

export const lockActionSchema = z.object({
  action: z.enum(["lock", "reopen"]),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  note: z.string().trim().max(500).nullish(),
});
export type LockActionInput = z.infer<typeof lockActionSchema>;

export const overviewQuerySchema = z.object({
  date: dateOnlySchema,
  scope: z.enum(["team", "all"]).default("team"),
});
export type OverviewQueryInput = z.infer<typeof overviewQuerySchema>;
