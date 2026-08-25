import { withApi } from "@/lib/api";
import { markRunPaid } from "@/modules/payroll/service";
import { idParamSchema, runStatusSchema, type RunStatusInput } from "@/modules/payroll/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** Mark a run paid, once the finance system has actually paid it. */
export const POST = withApi<RunStatusInput, Record<string, never>, Params>(
  {
    permission: "payroll.manage",
    params: idParamSchema,
    body: runStatusSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => markRunPaid(ctx, params.id, body),
);
