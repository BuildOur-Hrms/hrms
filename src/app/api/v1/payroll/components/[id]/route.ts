import { withApi } from "@/lib/api";
import { deleteComponent } from "@/modules/payroll/service";
import { idParamSchema } from "@/modules/payroll/validators";

export const runtime = "nodejs";

type Params = { id: string };

export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "payroll.manage", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => deleteComponent(ctx, params.id),
);
