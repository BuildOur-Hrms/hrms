import { withApi } from "@/lib/api";
import { ConflictError } from "@/lib/errors";
import { getMonth } from "@/modules/attendance/service";
import { monthQuerySchema, type MonthQueryInput } from "@/modules/attendance/validators";

export const runtime = "nodejs";

/** A month of attendance for the signed-in employee, for the calendar view. */
export const GET = withApi<Record<string, never>, MonthQueryInput>(
  { query: monthQuerySchema },
  async ({ ctx, query }) => {
    if (!ctx.employeeId) {
      throw new ConflictError(
        "This account has no employee record, so there is no attendance to show.",
      );
    }
    return getMonth(ctx, ctx.employeeId, query.year, query.month);
  },
);
