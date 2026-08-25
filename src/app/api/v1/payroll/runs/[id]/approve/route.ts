import { withApi } from "@/lib/api";
import { approveRun } from "@/modules/payroll/service";
import { idParamSchema } from "@/modules/payroll/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * Approve a run, which writes the payslips.
 *
 * `payroll.approve` rather than `payroll.manage`: preparing a run and signing
 * it off are different acts, and a company that wants two people involved can
 * have that by granting them separately.
 */
export const POST = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "payroll.approve", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => approveRun(ctx, params.id),
);
