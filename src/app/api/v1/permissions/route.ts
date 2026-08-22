import { withApi } from "@/lib/api";
import { listPermissions } from "@/modules/rbac/service";

export const runtime = "nodejs";

/** The global permission catalog, grouped by module. */
export const GET = withApi({ permission: "roles.view_all" }, async () => listPermissions());
