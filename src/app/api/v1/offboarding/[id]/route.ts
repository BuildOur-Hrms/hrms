import { withApi } from "@/lib/api";
import { getExit } from "@/modules/checklists/offboarding";
import { idParamSchema } from "@/modules/checklists/validators";

export const runtime = "nodejs";

type Params = { id: string };

export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "offboarding.view_own", params: idParamSchema },
  async ({ ctx, params }) => getExit(ctx, params.id),
);
