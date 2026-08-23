import { withApi } from "@/lib/api";
import { cancelLeaveRequest } from "@/modules/leave/requests";
import { idParamSchema } from "@/modules/leave/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * Withdraw a request. A DELETE that sets a status rather than removing the
 * row — that somebody asked and then changed their mind is part of the record,
 * and an approved-then-cancelled request is why a balance moved twice.
 */
export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => cancelLeaveRequest(ctx, params.id),
);
