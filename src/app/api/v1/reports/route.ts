import { withApi } from "@/lib/api";
import { listReports } from "@/modules/reports/service";

export const runtime = "nodejs";

/**
 * The catalog. No static permission: which reports exist for you depends on
 * whether you hold `view_all` or only `view_team`, which one code cannot say.
 */
export const GET = withApi({}, async ({ ctx }) => ({ reports: listReports(ctx) }));
