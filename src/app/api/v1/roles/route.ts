import { withApi } from "@/lib/api";
import { listRoles } from "@/modules/rbac/service";

export const runtime = "nodejs";

export const GET = withApi({ permission: "roles.view_all" }, async ({ ctx }) => listRoles(ctx));
