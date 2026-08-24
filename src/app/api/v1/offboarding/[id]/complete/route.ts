import { withApi } from "@/lib/api";
import { completeExit } from "@/modules/checklists/offboarding";
import { idParamSchema } from "@/modules/checklists/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** The last step: the person leaves and their account is closed. */
export const POST = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "offboarding.manage", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => completeExit(ctx, params.id),
);
