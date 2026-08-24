import { withApi } from "@/lib/api";
import { listInterviews, scheduleInterview } from "@/modules/recruitment/service";
import {
  listInterviewsSchema,
  scheduleInterviewSchema,
  type ListInterviewsInput,
  type ScheduleInterviewInput,
} from "@/modules/recruitment/validators";

export const runtime = "nodejs";

/**
 * GET /api/v1/recruitment/interviews
 *
 * `scope=mine` needs no recruiting permission: being asked to sit on a round
 * is what entitles somebody to see it. `scope=all` is checked in the service.
 */
export const GET = withApi<Record<string, never>, ListInterviewsInput>(
  { query: listInterviewsSchema },
  async ({ ctx, query }) => listInterviews(ctx, query),
);

export const POST = withApi<ScheduleInterviewInput>(
  {
    permission: "recruitment.edit",
    body: scheduleInterviewSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => scheduleInterview(ctx, body),
);
