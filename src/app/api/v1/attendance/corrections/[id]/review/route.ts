import { withApi } from "@/lib/api";
import { reviewCorrection } from "@/modules/attendance/corrections";
import {
  correctionReviewSchema,
  idParamSchema,
  type CorrectionReviewInput,
} from "@/modules/attendance/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * Approve or reject someone else's request. The permission gate here is the
 * coarse one; whether this particular caller may act on this particular
 * employee — their own report, not themselves — is decided in the service,
 * because it depends on the row.
 */
export const POST = withApi<CorrectionReviewInput, Record<string, never>, Params>(
  {
    permission: "attendance.approve",
    body: correctionReviewSchema,
    params: idParamSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => reviewCorrection(ctx, params.id, body),
);
