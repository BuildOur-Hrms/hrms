import { withApi } from "@/lib/api";
import { createShift, listShifts } from "@/modules/shifts/service";
import { createShiftSchema, type CreateShiftInput } from "@/modules/shifts/validators";

export const runtime = "nodejs";

// Readable by anyone signed in: an employee sees which shift they are on, and
// the manager and HR views both build on the same list.
export const GET = withApi({}, async ({ ctx }) => listShifts(ctx));

export const POST = withApi<CreateShiftInput>(
  {
    permission: "shifts.manage",
    body: createShiftSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => createShift(ctx, body),
);
