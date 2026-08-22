import { withApi } from "@/lib/api";
import { orgOptions } from "@/modules/org/service";

export const runtime = "nodejs";

/** Departments, designations and locations for the employee form pickers. */
export const GET = withApi({}, async ({ ctx }) => orgOptions(ctx));
