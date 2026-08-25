import { withApi } from "@/lib/api";
import { getPayslip } from "@/modules/payroll/service";
import { idParamSchema } from "@/modules/payroll/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** One payslip, line by line. */
export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "payroll.view_own", params: idParamSchema },
  async ({ ctx, params }) => getPayslip(ctx, params.id),
);
