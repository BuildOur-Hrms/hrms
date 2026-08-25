import { withApi } from "@/lib/api";
import { submitSelfReview } from "@/modules/performance/service";
import {
  idParamSchema,
  selfReviewSchema,
  type SelfReviewInput,
} from "@/modules/performance/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * The employee's half.
 *
 * `view_own` is the right gate: this is only ever written by the person the
 * review is about, and the service refuses anybody else regardless of what
 * else they hold.
 */
export const POST = withApi<SelfReviewInput, Record<string, never>, Params>(
  {
    permission: "performance.view_own",
    params: idParamSchema,
    body: selfReviewSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => submitSelfReview(ctx, params.id, body),
);
