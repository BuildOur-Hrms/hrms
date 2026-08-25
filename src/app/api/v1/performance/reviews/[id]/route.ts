import { withApi } from "@/lib/api";
import { getReview } from "@/modules/performance/service";
import { idParamSchema } from "@/modules/performance/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** One review, with the goals it is judged against. */
export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "performance.view_own", params: idParamSchema },
  async ({ ctx, params }) => getReview(ctx, params.id),
);
