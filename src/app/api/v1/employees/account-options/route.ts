import { withApi } from "@/lib/api";
import { accountOptions } from "@/modules/employees/service";

export const runtime = "nodejs";

/** Accounts with no employee record, for the link picker. */
export const GET = withApi({ permission: "users.manage" }, async ({ ctx }) => accountOptions(ctx));
