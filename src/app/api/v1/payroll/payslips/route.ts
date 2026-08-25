import { withApi } from "@/lib/api";
import { listPayslips } from "@/modules/payroll/service";
import { listPayslipsSchema, type ListPayslipsInput } from "@/modules/payroll/validators";

export const runtime = "nodejs";

/**
 * Payslips, scoped to the caller.
 *
 * No team scope anywhere in this module: a manager sees their reports'
 * attendance and their goals, and never their pay.
 */
export const GET = withApi<Record<string, never>, ListPayslipsInput>(
  { permission: "payroll.view_own", query: listPayslipsSchema },
  async ({ ctx, query }) => listPayslips(ctx, query),
);
