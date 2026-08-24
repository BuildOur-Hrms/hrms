import { withApi } from "@/lib/api";
import { moveStage } from "@/modules/recruitment/service";
import {
  idParamSchema,
  moveStageSchema,
  type MoveStageInput,
} from "@/modules/recruitment/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * Move an application along, or reject it.
 *
 * A rejection carries its reason in this same request — the schema refuses
 * one without it, because "why did we say no" is the field everyone skips
 * when it is a follow-up edit.
 */
export const POST = withApi<MoveStageInput, Record<string, never>, Params>(
  {
    permission: "recruitment.edit",
    body: moveStageSchema,
    params: idParamSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => moveStage(ctx, params.id, body),
);
