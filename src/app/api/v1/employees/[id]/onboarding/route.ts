import { withApi } from "@/lib/api";
import { checklistFor, startOnboarding } from "@/modules/checklists/service";
import {
  idParamSchema,
  startChecklistSchema,
  type StartChecklistInput,
} from "@/modules/checklists/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** One person's onboarding checklist, and how far along it is. */
export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "onboarding.view_team", params: idParamSchema },
  async ({ ctx, params }) => checklistFor(ctx, params.id, "onboarding"),
);

export const POST = withApi<StartChecklistInput, Record<string, never>, Params>(
  {
    permission: "onboarding.create",
    params: idParamSchema,
    body: startChecklistSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, params, body }) => startOnboarding(ctx, params.id, body),
);
