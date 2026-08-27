import { withApi } from "@/lib/api";
import { setRolePermissions } from "@/modules/rbac/service";
import {
  idParamSchema,
  setPermissionsSchema,
  type SetPermissionsInput,
} from "@/modules/rbac/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * The whole set, not one at a time.
 *
 * PUT because it replaces: the screen shows every permission with a tick, and
 * sending a partial change would leave the role holding something nobody on
 * that screen chose.
 */
export const PUT = withApi<SetPermissionsInput, Record<string, never>, Params>(
  {
    permission: "roles.manage",
    params: idParamSchema,
    body: setPermissionsSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => setRolePermissions(ctx, params.id, body),
);
