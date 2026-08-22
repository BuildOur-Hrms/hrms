import { withApi } from "@/lib/api";
import { changeStatus } from "@/modules/employees/service";
import {
  changeStatusSchema,
  idParamSchema,
  type ChangeStatusInput,
} from "@/modules/employees/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** POST /api/v1/employees/:id/status — guarded state machine, not a field edit. */
export const POST = withApi<ChangeStatusInput, Record<string, never>, Params>(
  {
    permission: "employee.edit",
    body: changeStatusSchema,
    params: idParamSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => changeStatus(ctx, params.id, body),
);
