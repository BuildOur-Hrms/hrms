import { z } from "zod";

import { withApi } from "@/lib/api";
import { deleteUnusedAccount } from "@/modules/rbac/service";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });
type Params = { id: string };

/**
 * Remove an account that was never used — a mistyped invite, essentially.
 *
 * The service refuses anything that has signed in, is linked to an employee,
 * or is the caller's own, because deleting those would strip an actor from
 * its own audit trail. Those get disabled instead.
 */
export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "users.manage", params: paramsSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => {
    await deleteUnusedAccount(ctx, params.id);
    return { ok: true };
  },
);
