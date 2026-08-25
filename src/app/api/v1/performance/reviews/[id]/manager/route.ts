import { withApi } from "@/lib/api";
import { submitManagerReview } from "@/modules/performance/service";
import {
  idParamSchema,
  managerReviewSchema,
  type ManagerReviewInput,
} from "@/modules/performance/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** The manager's half, written by the manager the review was opened against. */
export const POST = withApi<ManagerReviewInput, Record<string, never>, Params>(
  {
    permission: "performance.view_team",
    params: idParamSchema,
    body: managerReviewSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => submitManagerReview(ctx, params.id, body),
);
