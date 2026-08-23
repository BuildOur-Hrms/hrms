import { withApi } from "@/lib/api";
import { assignShift, listAssignments } from "@/modules/shifts/service";
import {
  assignShiftSchema,
  idParamSchema,
  type AssignShiftInput,
} from "@/modules/shifts/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * Visibility is resolved in the service against the employee scope — own
 * record, direct reports, or everyone — because "your own" is not something a
 * static permission can express.
 */
export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { params: idParamSchema },
  async ({ ctx, params }) => listAssignments(ctx, params.id),
);

export const POST = withApi<AssignShiftInput, Record<string, never>, Params>(
  {
    permission: "shifts.manage",
    body: assignShiftSchema,
    params: idParamSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body, params }) => assignShift(ctx, params.id, body),
);
