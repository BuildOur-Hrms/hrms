import { withApi } from "@/lib/api";
import { getDay } from "@/modules/attendance/service";
import { dayQuerySchema, type DayQueryInput } from "@/modules/attendance/validators";
import { ConflictError } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * One work day for the signed-in employee: the shift it is measured against,
 * the punches, and the computed record. Defaults to today, where "today" is
 * the current work date rather than the calendar date — they differ for an
 * overnight shift.
 */
export const GET = withApi<Record<string, never>, DayQueryInput>(
  { query: dayQuerySchema },
  async ({ ctx, query }) => {
    if (!ctx.employeeId) {
      throw new ConflictError(
        "This account has no employee record, so there is no attendance to show.",
      );
    }
    return getDay(ctx, ctx.employeeId, query.date);
  },
);
