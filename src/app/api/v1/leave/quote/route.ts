import { z } from "zod";

import { withApi } from "@/lib/api";
import { quoteRequest } from "@/modules/leave/requests";
import { dateOnlySchema } from "@/modules/leave/validators";

export const runtime = "nodejs";

/**
 * What a span would cost, before committing to it.
 *
 * The apply form shows this live, so somebody sees a weekend being charged by
 * the sandwich rule *before* they submit rather than discovering it from their
 * balance afterwards.
 */
const querySchema = z.object({
  leaveTypeId: z.string().uuid(),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  halfDay: z.enum(["none", "first_half", "second_half"]).default("none"),
});
type QuoteQuery = z.infer<typeof querySchema>;

export const GET = withApi<Record<string, never>, QuoteQuery>(
  { query: querySchema },
  async ({ ctx, query }) =>
    quoteRequest(ctx, query.leaveTypeId, {
      startDate: query.startDate,
      endDate: query.endDate,
      halfDay: query.halfDay,
    }),
);
