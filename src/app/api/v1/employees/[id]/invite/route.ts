import { withApi } from "@/lib/api";
import { invite } from "@/modules/employees/service";
import { idParamSchema } from "@/modules/employees/validators";

export const runtime = "nodejs";

type Params = { id: string };

export const POST = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "users.manage", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => invite(ctx, params.id),
);
