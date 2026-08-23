import { withApi } from "@/lib/api";
import { createLeaveType, listLeaveTypes } from "@/modules/leave/types";
import { createLeaveTypeSchema, type CreateLeaveTypeInput } from "@/modules/leave/validators";

export const runtime = "nodejs";

/** Readable by anyone signed in — the apply form needs the list. */
export const GET = withApi({}, async ({ ctx }) => listLeaveTypes(ctx));

export const POST = withApi<CreateLeaveTypeInput>(
  { permission: "leave.manage", body: createLeaveTypeSchema, rateLimit: "mutation", status: 201 },
  async ({ ctx, body }) => createLeaveType(ctx, body),
);
