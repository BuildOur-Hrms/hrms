import { withApi } from "@/lib/api";
import { cycleSummary } from "@/modules/performance/service";
import { idParamSchema } from "@/modules/performance/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** Completion and the spread of ratings across a cycle. */
export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "performance.view_all", params: idParamSchema },
  async ({ ctx, params }) => cycleSummary(ctx, params.id),
);
