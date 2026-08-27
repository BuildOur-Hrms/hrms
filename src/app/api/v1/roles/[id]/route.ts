import { withApi } from "@/lib/api";
import { deleteRole, updateRole } from "@/modules/rbac/service";
import { idParamSchema, updateRoleSchema, type UpdateRoleInput } from "@/modules/rbac/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** Only the description. A role's name is what everything else refers to it by. */
export const PATCH = withApi<UpdateRoleInput, Record<string, never>, Params>(
  {
    permission: "roles.manage",
    params: idParamSchema,
    body: updateRoleSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => updateRole(ctx, params.id, body),
);

/** Refused while anybody still holds it, and always for the seeded four. */
export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "roles.manage", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => deleteRole(ctx, params.id),
);
