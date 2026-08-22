import { withApi } from "@/lib/api";
import { deleteLocation, updateLocation } from "@/modules/org/service";
import {
  idParamSchema,
  updateLocationSchema,
  type UpdateLocationInput,
} from "@/modules/org/validators";

export const runtime = "nodejs";

type Params = { id: string };

export const PATCH = withApi<UpdateLocationInput, Record<string, never>, Params>(
  {
    permission: "company.manage",
    body: updateLocationSchema,
    params: idParamSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => updateLocation(ctx, params.id, body),
);

export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "company.manage", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => {
    await deleteLocation(ctx, params.id);
    return { ok: true };
  },
);
