import { withApi } from "@/lib/api";
import { createApplication, listApplications } from "@/modules/recruitment/service";
import {
  createApplicationSchema,
  listApplicationsSchema,
  type CreateApplicationInput,
  type ListApplicationsInput,
} from "@/modules/recruitment/validators";

export const runtime = "nodejs";

/** The board: everything on a job, or everything for a candidate. */
export const GET = withApi<Record<string, never>, ListApplicationsInput>(
  { query: listApplicationsSchema },
  async ({ ctx, query }) => listApplications(ctx, query),
);

export const POST = withApi<CreateApplicationInput>(
  {
    permission: "recruitment.edit",
    body: createApplicationSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => createApplication(ctx, body),
);
