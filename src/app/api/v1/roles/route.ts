import { withApi } from "@/lib/api";
import { createRole, listRoles } from "@/modules/rbac/service";
import { createRoleSchema, type CreateRoleInput } from "@/modules/rbac/validators";

export const runtime = "nodejs";

export const GET = withApi({ permission: "roles.view_all" }, async ({ ctx }) => listRoles(ctx));

/**
 * Create a role of the company's own.
 *
 * `roles.manage` gets you here; what you may put *in* the role is decided in
 * the service, which refuses any permission the caller does not hold. Without
 * that, this endpoint is a way for anybody who can manage roles to grant
 * themselves everything.
 */
export const POST = withApi<CreateRoleInput>(
  { permission: "roles.manage", body: createRoleSchema, rateLimit: "mutation", status: 201 },
  async ({ ctx, body }) => createRole(ctx, body),
);
