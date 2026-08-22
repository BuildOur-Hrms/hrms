import { withApi } from "@/lib/api";
import { deleteEmployee, getEmployee, updateEmployee } from "@/modules/employees/service";
import {
  idParamSchema,
  updateEmployeeSchema,
  type UpdateEmployeeInput,
} from "@/modules/employees/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** Scope and field-level visibility are resolved inside the service. */
export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { params: idParamSchema },
  async ({ ctx, params }) => getEmployee(ctx, params.id),
);

export const PATCH = withApi<UpdateEmployeeInput, Record<string, never>, Params>(
  {
    permission: "employee.edit",
    body: updateEmployeeSchema,
    params: idParamSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => updateEmployee(ctx, params.id, body),
);

export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "employee.delete", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => {
    await deleteEmployee(ctx, params.id);
    return { ok: true };
  },
);
