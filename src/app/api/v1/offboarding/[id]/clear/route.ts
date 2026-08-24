import { withApi } from "@/lib/api";
import { markCleared } from "@/modules/checklists/offboarding";
import { idParamSchema } from "@/modules/checklists/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** Everything handed back and handed over. Gated on the exit checklist. */
export const POST = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "offboarding.manage", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => markCleared(ctx, params.id),
);
