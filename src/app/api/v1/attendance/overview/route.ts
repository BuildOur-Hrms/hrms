import { withApi } from "@/lib/api";
import { listDayForScope } from "@/modules/attendance/service";
import { overviewQuerySchema, type OverviewQueryInput } from "@/modules/attendance/validators";

export const runtime = "nodejs";

/**
 * One day across a team or the whole company. The scope decides which
 * permission is required, so it is checked in the service rather than
 * declared here — a single static permission cannot express "team or all".
 */
export const GET = withApi<Record<string, never>, OverviewQueryInput>(
  { query: overviewQuerySchema },
  async ({ ctx, query }) => listDayForScope(ctx, query.date, query.scope),
);
