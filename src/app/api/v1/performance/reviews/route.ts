import { withApi } from "@/lib/api";
import { listReviews } from "@/modules/performance/service";
import { listReviewsSchema, type ListReviewsInput } from "@/modules/performance/validators";

export const runtime = "nodejs";

/** Reviews, scoped to the caller unless they hold more. */
export const GET = withApi<Record<string, never>, ListReviewsInput>(
  { permission: "performance.view_own", query: listReviewsSchema },
  async ({ ctx, query }) => listReviews(ctx, query),
);
