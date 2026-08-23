import { withApi } from "@/lib/api";
import { deleteShift, getShift, updateShift } from "@/modules/shifts/service";
import {
  idParamSchema,
  updateShiftSchema,
  type UpdateShiftInput,
} from "@/modules/shifts/validators";

export const runtime = "nodejs";

type Params = { id: string };

export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { params: idParamSchema },
  async ({ ctx, params }) => getShift(ctx, params.id),
);

export const PATCH = withApi<UpdateShiftInput, Record<string, never>, Params>(
  {
    permission: "shifts.manage",
    body: updateShiftSchema,
    params: idParamSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => updateShift(ctx, params.id, body),
);

export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "shifts.manage", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => {
    await deleteShift(ctx, params.id);
    return { ok: true };
  },
);
