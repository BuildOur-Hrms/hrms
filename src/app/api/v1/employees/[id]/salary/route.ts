import { withApi } from "@/lib/api";
import { assignSalary, salaryHistory } from "@/modules/payroll/service";
import {
  assignSalarySchema,
  idParamSchema,
  type AssignSalaryInput,
} from "@/modules/payroll/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * What somebody is paid, and what they were paid before.
 *
 * `payroll.view_own` is the floor because a person may read their own. That
 * this record is theirs is checked in the service — a manager holding
 * `view_own` gets nothing here, which is the point: salary is never
 * team-visible.
 */
export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "payroll.view_own", params: idParamSchema },
  async ({ ctx, params }) => salaryHistory(ctx, params.id),
);

export const POST = withApi<AssignSalaryInput, Record<string, never>, Params>(
  {
    permission: "payroll.manage",
    params: idParamSchema,
    body: assignSalarySchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, params, body }) => assignSalary(ctx, params.id, body),
);
