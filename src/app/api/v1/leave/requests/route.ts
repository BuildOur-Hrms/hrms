import { withApi } from "@/lib/api";
import { createLeaveRequest, listLeaveRequests } from "@/modules/leave/requests";
import {
  createLeaveRequestSchema,
  leaveListSchema,
  type CreateLeaveRequestInput,
  type LeaveListInput,
} from "@/modules/leave/validators";

export const runtime = "nodejs";

/** `scope` decides which permission applies, so it is checked in the service. */
export const GET = withApi<Record<string, never>, LeaveListInput>(
  { query: leaveListSchema },
  async ({ ctx, query }) => listLeaveRequests(ctx, query),
);

export const POST = withApi<CreateLeaveRequestInput>(
  {
    permission: "leave.create",
    body: createLeaveRequestSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => createLeaveRequest(ctx, body),
);
