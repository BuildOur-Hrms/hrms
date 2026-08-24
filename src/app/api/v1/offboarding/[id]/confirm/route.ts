import { withApi } from "@/lib/api";
import { confirmResignation } from "@/modules/checklists/offboarding";
import {
  confirmExitSchema,
  idParamSchema,
  type ConfirmExitInput,
} from "@/modules/checklists/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** HR settles the last working day and the exit checklist begins. */
export const POST = withApi<ConfirmExitInput, Record<string, never>, Params>(
  {
    permission: "offboarding.manage",
    params: idParamSchema,
    body: confirmExitSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => confirmResignation(ctx, params.id, body),
);
