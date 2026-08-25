import { withApi } from "@/lib/api";
import { reopenReview } from "@/modules/performance/service";
import {
  idParamSchema,
  reopenReviewSchema,
  type ReopenReviewInput,
} from "@/modules/performance/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** Sending a review back to whoever needs to write it again. */
export const POST = withApi<ReopenReviewInput, Record<string, never>, Params>(
  {
    permission: "performance.manage",
    params: idParamSchema,
    body: reopenReviewSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => reopenReview(ctx, params.id, body),
);
