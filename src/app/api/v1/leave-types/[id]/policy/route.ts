import { withApi } from "@/lib/api";
import { upsertPolicy } from "@/modules/leave/types";
import {
  idParamSchema,
  upsertPolicySchema,
  type UpsertPolicyInput,
} from "@/modules/leave/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * PUT rather than POST: there is exactly one policy per type, so setting it
 * twice is a revision, not a duplicate.
 */
export const PUT = withApi<UpsertPolicyInput, Record<string, never>, Params>(
  {
    permission: "leave.manage",
    body: upsertPolicySchema,
    params: idParamSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => upsertPolicy(ctx, params.id, body),
);
