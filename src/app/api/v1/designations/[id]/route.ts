import { withApi } from "@/lib/api";
import { deleteDesignation, updateDesignation } from "@/modules/org/service";
import {
  idParamSchema,
  updateDesignationSchema,
  type UpdateDesignationInput,
} from "@/modules/org/validators";

export const runtime = "nodejs";

type Params = { id: string };

export const PATCH = withApi<UpdateDesignationInput, Record<string, never>, Params>(
  {
    permission: "designation.manage",
    body: updateDesignationSchema,
    params: idParamSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => updateDesignation(ctx, params.id, body),
);

export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "designation.manage", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => {
    await deleteDesignation(ctx, params.id);
    return { ok: true };
  },
);
