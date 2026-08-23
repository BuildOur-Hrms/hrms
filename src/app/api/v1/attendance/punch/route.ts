import { withApi } from "@/lib/api";
import { punch } from "@/modules/attendance/service";
import { punchSchema, type PunchInput } from "@/modules/attendance/validators";

export const runtime = "nodejs";

/**
 * Check in or out, always for the signed-in employee.
 *
 * There is deliberately no `employeeId` in the body. Punching on someone
 * else's behalf is manual entry — a different action, with its own permission
 * and its own `manual` source so it is never mistaken for a real one.
 */
export const POST = withApi<PunchInput>(
  {
    permission: "attendance.create",
    body: punchSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => punch(ctx, body),
);
