import { withApi } from "@/lib/api";
import { setFinalRating } from "@/modules/performance/service";
import {
  finalRatingSchema,
  idParamSchema,
  type FinalRatingInput,
} from "@/modules/performance/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** HR settling the number that goes on the record. */
export const POST = withApi<FinalRatingInput, Record<string, never>, Params>(
  {
    permission: "performance.manage",
    params: idParamSchema,
    body: finalRatingSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => setFinalRating(ctx, params.id, body),
);
