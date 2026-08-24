import { withApi } from "@/lib/api";
import { getJob, updateJob } from "@/modules/recruitment/service";
import {
  idParamSchema,
  updateJobSchema,
  type UpdateJobInput,
} from "@/modules/recruitment/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** One posting, with the funnel across its applications. */
export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { params: idParamSchema },
  async ({ ctx, params }) => getJob(ctx, params.id),
);

export const PATCH = withApi<UpdateJobInput, Record<string, never>, Params>(
  {
    permission: "recruitment.edit",
    body: updateJobSchema,
    params: idParamSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => updateJob(ctx, params.id, body),
);
