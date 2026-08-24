import { z } from "zod";

import { withApi } from "@/lib/api";
import { inviteWithRoles } from "@/modules/rbac/service";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  /** At least one: an account with no roles can sign in and see nothing. */
  roleIds: z.array(z.string().uuid()).min(1, "Choose at least one role"),
  /** Optional: an administrator has no employee record, a new hire does. */
  employeeId: z.string().uuid().nullish(),
});
type Body = z.infer<typeof bodySchema>;

/**
 * Invite somebody straight to an account with roles, without an employee
 * record behind it — the path for creating an administrator.
 */
export const POST = withApi<Body>(
  { permission: "users.manage", body: bodySchema, rateLimit: "mutation", status: 201 },
  async ({ ctx, body }) => inviteWithRoles(ctx, body),
);
