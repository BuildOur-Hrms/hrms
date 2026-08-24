import { withApi } from "@/lib/api";
import { cancelExit } from "@/modules/checklists/offboarding";
import {
  cancelExitSchema,
  idParamSchema,
  type CancelExitInput,
} from "@/modules/checklists/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** Withdrawing a resignation, up until the settlement is recorded. */
export const POST = withApi<CancelExitInput, Record<string, never>, Params>(
  {
    permission: "offboarding.manage",
    params: idParamSchema,
    body: cancelExitSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => cancelExit(ctx, params.id, body),
);
