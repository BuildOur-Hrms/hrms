import { withApi } from "@/lib/api";
import { deleteLeaveType, updateLeaveType } from "@/modules/leave/types";
import {
  idParamSchema,
  updateLeaveTypeSchema,
  type UpdateLeaveTypeInput,
} from "@/modules/leave/validators";

export const runtime = "nodejs";

type Params = { id: string };

export const PATCH = withApi<UpdateLeaveTypeInput, Record<string, never>, Params>(
  {
    permission: "leave.manage",
    body: updateLeaveTypeSchema,
    params: idParamSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => updateLeaveType(ctx, params.id, body),
);

export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "leave.manage", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => {
    await deleteLeaveType(ctx, params.id);
    return { ok: true };
  },
);
