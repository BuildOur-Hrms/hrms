import { withApi } from "@/lib/api";
import { deleteDepartment, updateDepartment } from "@/modules/org/service";
import {
  idParamSchema,
  updateDepartmentSchema,
  type UpdateDepartmentInput,
} from "@/modules/org/validators";

export const runtime = "nodejs";

type Params = { id: string };

export const PATCH = withApi<UpdateDepartmentInput, Record<string, never>, Params>(
  {
    permission: "department.manage",
    body: updateDepartmentSchema,
    params: idParamSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => updateDepartment(ctx, params.id, body),
);

export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "department.manage", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => {
    await deleteDepartment(ctx, params.id);
    return { ok: true };
  },
);
