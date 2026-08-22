import { z } from "zod";

import { withApi } from "@/lib/api";
import { removeRole } from "@/modules/rbac/service";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid(), roleId: z.string().uuid() });
type Params = z.infer<typeof paramsSchema>;

export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "roles.manage", params: paramsSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => {
    await removeRole(ctx, params.id, params.roleId);
    return { ok: true };
  },
);
