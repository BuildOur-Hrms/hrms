import { withApi } from "@/lib/api";
import { createJob, listJobs } from "@/modules/recruitment/service";
import {
  createJobSchema,
  listJobsSchema,
  type CreateJobInput,
  type ListJobsInput,
} from "@/modules/recruitment/validators";

export const runtime = "nodejs";

/**
 * Job postings.
 *
 * No permission declared on the read: the service refuses anybody who is not
 * running hiring, and it refuses them the same way for every endpoint in the
 * module rather than each route restating the rule.
 */
export const GET = withApi<Record<string, never>, ListJobsInput>(
  { query: listJobsSchema },
  async ({ ctx, query }) => listJobs(ctx, query),
);

export const POST = withApi<CreateJobInput>(
  {
    permission: "recruitment.edit",
    body: createJobSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => createJob(ctx, body),
);
