import { withApi } from "@/lib/api";
import { linkAccount } from "@/modules/employees/service";
import {
  idParamSchema,
  linkAccountSchema,
  type LinkAccountInput,
} from "@/modules/employees/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * Connect an existing login to this employee.
 *
 * `users.manage` rather than `employee.edit`: this decides which person a
 * login speaks for, which is account management, and it is the permission
 * the invite endpoint beside it already asks for.
 */
export const POST = withApi<LinkAccountInput, Record<string, never>, Params>(
  {
    permission: "users.manage",
    params: idParamSchema,
    body: linkAccountSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => linkAccount(ctx, params.id, body.userId),
);
