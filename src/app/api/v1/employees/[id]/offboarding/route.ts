import { withApi } from "@/lib/api";
import { checklistFor } from "@/modules/checklists/service";
import { exitForEmployee } from "@/modules/checklists/offboarding";
import { idParamSchema } from "@/modules/checklists/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** One person's exit, with the checklist that goes with it. */
export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "offboarding.view_own", params: idParamSchema },
  async ({ ctx, params }) => {
    const request = await exitForEmployee(ctx, params.id);
    const checklist = await checklistFor(ctx, params.id, "offboarding");
    return { request, ...checklist };
  },
);
