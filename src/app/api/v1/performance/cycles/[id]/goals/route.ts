import { NOBODY } from "@/lib/context";
import { withApi } from "@/lib/api";
import { addGoal, goalsFor } from "@/modules/performance/service";
import { addGoalSchema, idParamSchema, type AddGoalInput } from "@/modules/performance/validators";
import { z } from "zod";

export const runtime = "nodejs";

type Params = { id: string };

const querySchema = z.object({ employeeId: z.string().uuid().optional() });
type Query = z.infer<typeof querySchema>;

/** One person's goals for this cycle. Defaults to the caller's own. */
export const GET = withApi<Record<string, never>, Query, Params>(
  { permission: "performance.view_own", params: idParamSchema, query: querySchema },
  async ({ ctx, params, query }) =>
    goalsFor(ctx, params.id, query.employeeId ?? ctx.employeeId ?? NOBODY),
);

/**
 * Propose a goal.
 *
 * `performance.create` is held by every employee — setting your own goals is
 * the point. Setting somebody else's is checked in the service.
 */
export const POST = withApi<AddGoalInput, Record<string, never>, Params>(
  {
    permission: "performance.create",
    params: idParamSchema,
    body: addGoalSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, params, body }) => addGoal(ctx, params.id, body),
);
