import { withApi } from "@/lib/api";
import { setJobStatus } from "@/modules/recruitment/service";
import {
  idParamSchema,
  jobStatusSchema,
  type JobStatusInput,
} from "@/modules/recruitment/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** Publish, hold, or close a posting. */
export const POST = withApi<JobStatusInput, Record<string, never>, Params>(
  {
    permission: "recruitment.edit",
    body: jobStatusSchema,
    params: idParamSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => setJobStatus(ctx, params.id, body),
);
