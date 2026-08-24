import { withApi } from "@/lib/api";
import { updateCandidate } from "@/modules/recruitment/service";
import {
  idParamSchema,
  updateCandidateSchema,
  type UpdateCandidateInput,
} from "@/modules/recruitment/validators";

export const runtime = "nodejs";

type Params = { id: string };

export const PATCH = withApi<UpdateCandidateInput, Record<string, never>, Params>(
  {
    permission: "recruitment.edit",
    body: updateCandidateSchema,
    params: idParamSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => updateCandidate(ctx, params.id, body),
);
