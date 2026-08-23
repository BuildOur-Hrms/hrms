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
