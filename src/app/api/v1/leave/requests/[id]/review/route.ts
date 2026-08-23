import { withApi } from "@/lib/api";
import { reviewLeaveRequest } from "@/modules/leave/requests";
import {
  idParamSchema,
  leaveReviewSchema,
  type LeaveReviewInput,
} from "@/modules/leave/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * The coarse permission is checked here; whether this caller may act on this
 * particular employee — their own report, never themselves — depends on the
 * row and is decided in the service.
 */
export const POST = withApi<LeaveReviewInput, Record<string, never>, Params>(
  {
    permission: "leave.approve",
    body: leaveReviewSchema,
    params: idParamSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => reviewLeaveRequest(ctx, params.id, body),
);
