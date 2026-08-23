import { withApi } from "@/lib/api";
import { deleteHoliday, updateHoliday } from "@/modules/leave/holidays";
import {
  idParamSchema,
  updateHolidaySchema,
  type UpdateHolidayInput,
} from "@/modules/leave/validators";

export const runtime = "nodejs";

type Params = { id: string };

export const PATCH = withApi<UpdateHolidayInput, Record<string, never>, Params>(
  {
    permission: "holidays.manage",
    body: updateHolidaySchema,
    params: idParamSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => updateHoliday(ctx, params.id, body),
);

export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "holidays.manage", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => {
    await deleteHoliday(ctx, params.id);
    return { ok: true };
  },
);
