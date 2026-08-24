import { withApi } from "@/lib/api";
import { unlinkedEmployeeOptions } from "@/modules/employees/service";

export const runtime = "nodejs";

/** Employee records with no account, for the invite form. */
export const GET = withApi({ permission: "users.manage" }, async ({ ctx }) =>
  unlinkedEmployeeOptions(ctx),
);
