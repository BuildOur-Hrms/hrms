import { z } from "zod";

import { codeSchema } from "@/modules/org/validators";

/**
 * Shared by the API and the forms, like every other module's validators: a
 * field absent from the schema cannot reach the database whatever the client
 * sends (docs/09-security.md §3).
 *
 * Shift rules are pay-relevant — attendance calculation reads them to decide
 * whether a day was present, late or half — so the bounds here are deliberate
 * rather than defensive, and they match the CHECK constraints in the
 * migration. Validation that disagrees with the database gives you a 500
 * where a 422 belonged.
 */

/** `HH:MM` in the location's wall clock, not a UTC instant. */
export const timeOfDaySchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Use HH:MM, 24-hour");

/** 0=Sunday … 6=Saturday, deduplicated so {0,0,6} cannot mean two days off. */
export const weekOffDaysSchema = z
  .array(z.coerce.number().int().min(0).max(6))
  .max(7)
  .transform((days) => [...new Set(days)].sort((a, b) => a - b))
  .refine((days) => days.length < 7, "A shift cannot have every day off");

export const createShiftSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(80),
  code: codeSchema,
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  graceMinutes: z.coerce.number().int().min(0).max(240).default(10),
  halfDayThresholdMinutes: z.coerce.number().int().min(1).max(1440),
  breakMinutes: z.coerce.number().int().min(0).max(480).default(0),
  weekOffDays: weekOffDaysSchema.default([0, 6]),
  isDefault: z.coerce.boolean().default(false),
});
export type CreateShiftInput = z.infer<typeof createShiftSchema>;

export const updateShiftSchema = createShiftSchema.partial();
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;

/**
 * Assignment carries a date, not a timestamp: a shift change takes effect on
 * a working day, and attaching a time to it would make "which shift was this
 * person on" depend on the hour.
 */
export const assignShiftSchema = z.object({
  shiftId: z.string().uuid(),
  /** Defaults to today at the service layer when omitted. */
  effectiveFrom: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional(),
});
export type AssignShiftInput = z.infer<typeof assignShiftSchema>;

export const idParamSchema = z.object({ id: z.string().uuid() });

/**
 * `18:00` → a Date carrying only that wall-clock time.
 *
 * Prisma maps `@db.Time` to Date, and the date part is discarded by Postgres.
 * The epoch is used deliberately: any other base date invites someone to read
 * meaning into it.
 */
export function timeToDate(value: string): Date {
  const [hours, minutes] = value.split(":").map(Number);
  return new Date(Date.UTC(1970, 0, 1, hours!, minutes!, 0, 0));
}

/** The inverse, for handing a stored shift back to a form. */
export function dateToTime(value: Date): string {
  const hours = String(value.getUTCHours()).padStart(2, "0");
  const minutes = String(value.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Minutes a shift spans, break excluded. Overnight shifts wrap, so a plain
 * subtraction would return a negative number for the 22:00–06:00 case that
 * exists precisely because someone works nights.
 */
export function shiftDurationMinutes(start: string, end: string, breakMinutes = 0): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMinutes = sh! * 60 + sm!;
  const endMinutes = eh! * 60 + em!;
  const span =
    endMinutes > startMinutes ? endMinutes - startMinutes : 1440 - startMinutes + endMinutes;
  return span - breakMinutes;
}
