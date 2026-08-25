import { withApi } from "@/lib/api";
import { setCycleStatus } from "@/modules/performance/service";
import {
  cycleStatusSchema,
  idParamSchema,
  type CycleStatusInput,
} from "@/modules/performance/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** Move a cycle along. Opening reviews is what creates them. */
export const POST = withApi<CycleStatusInput, Record<string, never>, Params>(
  {
    permission: "performance.manage",
    params: idParamSchema,
    body: cycleStatusSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => setCycleStatus(ctx, params.id, body),
);
