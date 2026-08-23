import { withApi } from "@/lib/api";
import { enterDayManually } from "@/modules/attendance/corrections";
import { manualEntrySchema, type ManualEntryInput } from "@/modules/attendance/validators";

export const runtime = "nodejs";

/**
 * POST /api/v1/attendance/manual
 *
 * HR entering a day for somebody else. Separate from `/attendance/punch`,
 * which only ever records the caller's own clock: letting one endpoint do both
 * would mean the difference between "I arrived" and "HR says you arrived" came
 * down to a field in the body.
 */
export const POST = withApi<ManualEntryInput>(
  {
    permission: "attendance.edit",
    body: manualEntrySchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => enterDayManually(ctx, body),
);
